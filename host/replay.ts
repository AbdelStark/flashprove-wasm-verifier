/** Fresh instances and deterministic replay of the verifier's process calls. */

import type { CallSnapshot, InputFile, Lookup } from "./namespace.js";
import { elapsedNs } from "./diagnostics.js";
import type { DiagnosticStage, Failure, InstanceDiagnostic } from "./diagnostics.js";
import { BASELINE_LIMITS, lowerLimits, PAGE_BYTES } from "./limits.js";
import type { RunLimits } from "./limits.js";
import { GuestExit, OutputBudget, PREVIEW1, WasiFault, WasiPreview1 } from "./wasi.js";
import type { StagePipe } from "./wasi.js";

const PORT = "fpv_port";
const MAX_EVENTS = 65536;
const wholeStages = ["key", "leaf", "request"] as const;
const encoder = new TextEncoder();
const failed = encoder.encode("NOT CHECKED: internal-stage\n");
let activeCalls = 0;

export type Hasher = { update(bytes: Uint8Array): void; digest(): string };
export type CreateSha256 = () => Hasher;
type Word = number | bigint;
type Field = string | Word | Uint8Array;
export type { Failure } from "./diagnostics.js";

export type GuestResult = Readonly<{
  status: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  failure: Failure | null;
}>;

class ReplayMismatch extends Error {}

class MemoryFault extends Error {
  constructor(readonly code: "memory-limit" | "runtime-oom") {
    super(code);
  }
}

function classify(error: unknown): Failure {
  if (error instanceof ReplayMismatch) return "replay-mismatch";
  if (error instanceof WasiFault) return error.code;
  if (error instanceof MemoryFault) return error.code;
  if (error instanceof WebAssembly.RuntimeError) return "trap";
  if (error instanceof WebAssembly.LinkError) return "abi";
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "invalid-input" || code === "input-limit" || code === "output-limit" || code === "host-io") return code;
  return "host-internal";
}

function digest(create: CreateSha256, fields: Iterable<Field>): string {
  const hash = create();
  const header = new Uint8Array(9);
  const view = new DataView(header.buffer);
  for (const field of fields) {
    if (typeof field === "number" || typeof field === "bigint") {
      header[0] = 0;
      view.setBigUint64(1, BigInt.asUintN(64, BigInt(field)), true);
      hash.update(header);
    } else {
      const data = typeof field === "string" ? encoder.encode(field) : field;
      header[0] = typeof field === "string" ? 1 : 2;
      view.setBigUint64(1, BigInt(data.length), true);
      hash.update(header);
      hash.update(data);
    }
  }
  return hash.digest();
}

function fileDigest(create: CreateSha256, file: InputFile): string {
  if (file.size < 0n || file.size > 0xffff_ffffn) throw new WasiFault("invalid input file size");
  const hash = create();
  const buffer = new Uint8Array(Math.min(Number(file.size), 65536));
  let offset = 0n;
  while (offset < file.size) {
    const chunk = buffer.subarray(0, Math.min(buffer.length, Number(file.size - offset)));
    if (file.readInto(chunk, offset) !== chunk.length) throw new WasiFault("incomplete input snapshot");
    hash.update(chunk);
    offset += BigInt(chunk.length);
  }
  return hash.digest();
}

type Event = Readonly<{ hash: string; file: boolean }>;
type ForkRecord = Readonly<{
  ordinal: number;
  argvDigest: string;
  observationDigest: string;
  fileViewDigest: string;
  eventCount: number;
  clockCount: number;
}>;
type Prefix = { record: ForkRecord; events: readonly Event[]; clock: readonly bigint[] };

class Journal {
  readonly events: Event[] = [];
  #count = 0;
  active = true;

  constructor(private readonly create: CreateSha256, private readonly expected?: Prefix) {}

  add(tag: string, ...fields: Field[]) {
    if (!this.active) return;
    const hash = digest(this.create, [tag, ...fields]);
    if (this.expected) {
      const { events, record } = this.expected;
      if (this.#count >= record.eventCount || events[this.#count].hash !== hash) {
        throw new ReplayMismatch("changed fork observation");
      }
    } else {
      if (this.#count >= MAX_EVENTS) throw new WasiFault("stage observation limit", "output-limit");
      this.events.push({ hash, file: tag === "file" });
    }
    this.#count++;
  }

  record(ordinal: number, argvDigest: string, clockCount: number): ForkRecord {
    const events = (this.expected?.events ?? this.events).slice(0, this.#count);
    return {
      ordinal, argvDigest, clockCount, eventCount: this.#count,
      observationDigest: digest(this.create, events.map(event => event.hash)),
      fileViewDigest: digest(this.create, events.filter(event => event.file).map(event => event.hash)),
    };
  }
}

class InstanceRun {
  readonly #journal: Journal;
  readonly #argvDigest: string;
  readonly #wasi: WasiPreview1;
  readonly #times: bigint[] = [];
  readonly #wait = new Map<number, number>();
  readonly #spans: Uint8Array[] = [];
  readonly #stage: DiagnosticStage;
  #instance?: WebAssembly.Instance;
  #instanceStarted?: number;
  #stageStarted?: number;
  #ordinal = 0;
  #nextTime = 0;
  #pending?: StagePipe;
  #childPipe?: StagePipe;
  #redirected = false;

  constructor(private readonly call: ReplayCall, private readonly prefix?: Prefix) {
    const mode = call.snapshot.argv[1];
    this.#stage = mode === "-plan" ? "plan" : "parent";
    if (prefix) this.#stage = mode === "-leaf" ? "leaf" : wholeStages[prefix.record.ordinal];
    this.#journal = new Journal(call.createSha256, prefix);
    this.#argvDigest = digest(call.createSha256, ["argv", ...call.snapshot.argv]);
    this.#journal.active = call.stages !== 0;
    this.#wasi = new WasiPreview1(call.snapshot, () => {
      const memory = this.#instance?.exports.memory;
      if (!(memory instanceof WebAssembly.Memory)) throw new WasiFault("missing guest memory");
      return memory;
    }, {
      clock: () => this.#clock(),
      output: call.output,
      discardPrefix: prefix !== undefined,
      observe: {
        span: bytes => {
          if (!this.#journal.active) return;
          this.#journal.add("span", bytes.byteOffset, bytes);
          this.#spans.push(bytes);
        },
        lookup: (path, open, entry) => this.#lookup(path, open, entry),
      },
    });
  }

  run(): { status: number; stdout: Uint8Array; stderr: Uint8Array } {
    const imports: WebAssembly.Imports = {
      [PREVIEW1]: this.#observe(PREVIEW1, this.#wasi.imports),
      [PORT]: this.#observe(PORT, {
        abi_version: () => 1,
        pipe: (pointer: number) => this.#pipe(pointer),
        fork: () => this.#fork(),
        dup2: (oldFd: number, newFd: number) => this.#dup2(oldFd, newFd),
        waitpid: (pid: number, pointer: number, flags: number) => this.#waitpid(pid, pointer, flags),
      }),
    };
    for (const entry of WebAssembly.Module.imports(this.call.module)) {
      if (entry.kind !== "function" || !Object.hasOwn(imports, entry.module)
        || !Object.hasOwn(imports[entry.module], entry.name)) throw new WasiFault("unaudited guest import");
    }
    try {
      try {
        this.#instance = new WebAssembly.Instance(this.call.module, imports);
      } catch (error) {
        if (error instanceof RangeError) throw new MemoryFault("runtime-oom");
        throw error;
      }
      const { memory, fpv_set_memory_limit: configure, fpv_memory_failure: memoryFailure } = this.#instance.exports;
      if (!(memory instanceof WebAssembly.Memory) || typeof configure !== "function"
        || typeof memoryFailure !== "function") throw new WasiFault("missing guest memory boundary");
      const stagesRunHere = this.prefix || this.call.stages === 0;
      const pages = stagesRunHere ? this.call.limits.childPages : this.call.limits.parentPages;
      if (memory.buffer.byteLength > pages * PAGE_BYTES) throw new MemoryFault("memory-limit");
      if (configure(pages) !== 0) throw new WasiFault("guest memory limit setup failed");
      const start = this.#instance.exports._start;
      if (typeof start !== "function") throw new WasiFault("missing guest entry point");
      if (this.call.diagnostics) {
        this.#instanceStarted = performance.now();
        if (this.#stage === "plan") this.#stageStarted = this.#instanceStarted;
        this.call.record({ schema: 1, phase: "instance", code: "start", stage: this.#stage });
      }
      let status = 0;
      try {
        start();
      } catch (error) {
        if (error instanceof GuestExit) {
          status = error.status;
        } else {
          if (error instanceof WebAssembly.RuntimeError) {
            const reason = memoryFailure();
            if (reason === 1) throw new MemoryFault("memory-limit");
            if (reason === 2) throw new MemoryFault("runtime-oom");
          }
          throw error;
        }
      }
      if (this.prefix && (!this.#childPipe || !this.#redirected)) {
        throw new ReplayMismatch("child ended before the selected branch");
      }
      if (!this.prefix && (status === 0 || status === 3 || status === 14)
        && (this.#ordinal !== this.call.stages || this.#pending || this.#wait.size)) {
        throw new WasiFault("parent ended before stage completion");
      }
      return { status, ...this.#wasi.takeStreams() };
    } finally {
      const memory = this.#instanceStarted === undefined ? undefined : this.#instance?.exports.memory;
      this.#instance = undefined;
      this.#wasi.discardStreams();
      if (this.#instanceStarted !== undefined && memory instanceof WebAssembly.Memory) {
        this.#completeDiagnostics(memory);
      }
    }
  }

  #completeDiagnostics(memory: WebAssembly.Memory) {
    try {
      if (this.#stageStarted !== undefined) {
        this.call.record({ schema: 1, phase: "stage", code: "elapsed", stage: this.#stage,
          elapsedNs: elapsedNs(this.#stageStarted) });
      } else if (this.prefix && this.#instanceStarted !== undefined) {
        this.call.record({ schema: 1, phase: "replay", code: "elapsed", stage: this.#stage,
          elapsedNs: elapsedNs(this.#instanceStarted) });
      }
      this.call.record({ schema: 1, phase: "instance", code: "end", stage: this.#stage,
        peakLinearBytes: memory.buffer.byteLength });
    } catch {
      // An observation can fail during teardown without affecting the call.
    }
  }

  #observe(module: string, imports: WebAssembly.ModuleImports): WebAssembly.ModuleImports {
    return Object.fromEntries(Object.entries(imports).map(([name, handler]) => [name, (...args: Word[]) => {
      if (typeof handler !== "function") throw new WasiFault("non-function host import");
      if (!this.#journal.active) return Reflect.apply(handler, undefined, args);
      this.#journal.add("call", module, name, ...args);
      try {
        const result: number = Reflect.apply(handler, undefined, args);
        if (this.#journal.active) {
          for (const span of this.#spans) this.#journal.add("bytes", span.byteOffset, span);
          this.#journal.add("return", result);
        }
        return result;
      } finally {
        this.#spans.length = 0;
      }
    }]));
  }

  #lookup(path: string, open: boolean, entry: Lookup) {
    if (!this.#journal.active) return;
    if (entry.kind === "file") {
      this.#journal.add("file", path, open ? 1 : 0, entry.kind, entry.size,
        open ? fileDigest(this.call.createSha256, entry) : "");
    } else {
      this.#journal.add("file", path, open ? 1 : 0, entry.kind, entry.kind === "error" ? entry.errno : 0);
    }
  }

  #clock(): bigint {
    if (!this.#journal.active) return this.call.clock();
    if (this.prefix) {
      if (this.#nextTime >= this.prefix.record.clockCount) throw new ReplayMismatch("changed replay clock events");
      return this.prefix.clock[this.#nextTime++];
    }
    const tick = this.call.clock();
    this.#times.push(tick);
    return tick;
  }

  #pipe(pointer: number): number {
    if (!this.#journal.active || this.#pending) throw new WasiFault("unexpected stage pipe");
    this.#pending = this.#wasi.makePipe(pointer);
    return 0;
  }

  #fork(): number {
    const pipe = this.#pending;
    if (!this.#journal.active || !pipe || !this.#wasi.hasPipe(pipe)) throw new WasiFault("unexpected stage fork");
    this.#pending = undefined;
    const ordinal = this.#ordinal++;
    const pid = ordinal + 1;
    if (this.prefix) {
      const expected = this.prefix.record;
      if (ordinal < expected.ordinal) return pid;
      const record = this.#journal.record(ordinal, this.#argvDigest, this.#nextTime);
      for (const key of Object.keys(record) as (keyof ForkRecord)[]) {
        if (record[key] !== expected[key]) throw new ReplayMismatch("changed fork record");
      }
      this.#journal.active = false;
      this.#childPipe = pipe;
      this.#wasi.beginChild();
      if (this.#instanceStarted !== undefined) {
        this.#stageStarted = performance.now();
        this.call.record({ schema: 1, phase: "replay", code: "elapsed", stage: this.#stage,
          elapsedNs: elapsedNs(this.#instanceStarted, this.#stageStarted) });
      }
      return 0;
    }

    const record = this.#journal.record(ordinal, this.#argvDigest, this.#times.length);
    this.#journal.active = this.#ordinal < this.call.stages;
    try {
      const child = new InstanceRun(this.call, { record, events: this.#journal.events, clock: this.#times }).run();
      this.#wasi.appendChildStderr(child.stderr);
      pipe.bytes = child.stdout;
      this.#wait.set(pid, child.status << 8);
    } catch (error) {
      this.call.failure ??= classify(error);
      pipe.bytes = new Uint8Array(0);
      this.#wait.set(pid, 6);
    }
    return pid;
  }

  #dup2(oldFd: number, newFd: number): number {
    if (!this.#childPipe || this.#redirected) throw new WasiFault("unexpected stage redirect");
    const fd = this.#wasi.redirectChild(this.#childPipe, oldFd, newFd);
    this.#redirected = true;
    return fd;
  }

  #waitpid(pid: number, pointer: number, flags: number): number {
    const word = this.#wait.get(pid);
    if (this.prefix || flags !== 0 || word === undefined) throw new WasiFault("unexpected stage wait");
    this.#wasi.writeWaitWord(pointer, word);
    this.#wait.delete(pid);
    return pid;
  }
}

class ReplayCall {
  failure: Failure | null = null;
  readonly stages: number;
  readonly output: OutputBudget;

  constructor(readonly module: WebAssembly.Module, readonly snapshot: CallSnapshot,
              readonly createSha256: CreateSha256, readonly limits: RunLimits,
              readonly diagnostics?: (event: InstanceDiagnostic) => void) {
    const mode = snapshot.argv[1];
    this.stages = mode === "-plan" ? 0 : mode === "-key" || mode === "-leaf" ? 1 : 3;
    this.output = new OutputBudget(limits.outputBytes);
  }

  clock(): bigint {
    return BigInt(Math.floor(performance.now() * 1e6));
  }

  record(event: InstanceDiagnostic): void {
    try { this.diagnostics?.(event); } catch { /* Observations cannot change a result. */ }
  }
}

function run(module: WebAssembly.Module, snapshot: CallSnapshot, createSha256: CreateSha256,
             limits: RunLimits, diagnostics?: (event: InstanceDiagnostic) => void, setupStarted?: number): GuestResult {
  const call = new ReplayCall(module, snapshot, createSha256, limits, diagnostics);
  if (setupStarted !== undefined) call.record({ schema: 1, phase: "setup", code: "elapsed", elapsedNs: elapsedNs(setupStarted) });
  try {
    const result = new InstanceRun(call).run();
    if (!call.failure) return { ...result, failure: null };
  } catch (error) {
    call.failure ??= classify(error);
  }
  return refusal(call.failure ?? "host-internal");
}

export function refusal(failure: Failure): GuestResult {
  return { status: 5, stdout: failed.slice(), stderr: new Uint8Array(0), failure };
}

export function replayGuest(module: WebAssembly.Module, capture: () => CallSnapshot,
                            createSha256: CreateSha256, overrides: Partial<RunLimits> = {},
                            diagnostics?: (event: InstanceDiagnostic) => void): GuestResult {
  if (activeCalls >= BASELINE_LIMITS.concurrentCalls) return refusal("busy");
  activeCalls++;
  try {
    const setupStarted = diagnostics ? performance.now() : undefined;
    let limits: RunLimits;
    try {
      limits = lowerLimits(overrides);
    } catch {
      return refusal("invalid-input");
    }
    const snapshot = capture();
    let result: GuestResult;
    try {
      result = run(module, snapshot, createSha256, limits, diagnostics, setupStarted);
    } catch (error) {
      result = refusal(classify(error));
    }
    try {
      snapshot.namespace.close?.();
    } catch (error) {
      if (!result.failure) return refusal(classify(error));
    }
    return result;
  } catch (error) {
    return refusal(classify(error));
  } finally {
    activeCalls--;
  }
}
