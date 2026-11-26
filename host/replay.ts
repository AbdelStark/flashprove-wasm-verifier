/** Fresh instances and deterministic replay of the verifier's process calls. */

import type { CallSnapshot, InputFile, Lookup } from "./namespace.js";
import { GuestExit, PREVIEW1, WasiFault, WasiPreview1 } from "./wasi.js";
import type { StagePipe } from "./wasi.js";

const PORT = "fpv_port";
const MAX_EVENTS = 65536;
const encoder = new TextEncoder();
const failed = encoder.encode("NOT CHECKED: internal-stage\n");

export type Hasher = { update(bytes: Uint8Array): void; digest(): string };
export type CreateSha256 = () => Hasher;
type Word = number | bigint;
type Field = string | Word | Uint8Array;
type Failure = "abi" | "trap" | "replay-mismatch" | "input-limit" | "output-limit" | "host-io" | "host-internal";

export type GuestResult = Readonly<{
  status: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  failure: Failure | null;
}>;

class ReplayMismatch extends Error {}

function classify(error: unknown): Failure {
  if (error instanceof ReplayMismatch) return "replay-mismatch";
  if (error instanceof WasiFault) return error.code;
  if (error instanceof WebAssembly.RuntimeError) return "trap";
  if (error instanceof WebAssembly.LinkError) return "abi";
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "input-limit" || code === "output-limit" || code === "host-io") return code;
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
  #instance?: WebAssembly.Instance;
  #ordinal = 0;
  #nextTime = 0;
  #pending?: StagePipe;
  #childPipe?: StagePipe;
  #redirected = false;

  constructor(private readonly call: ReplayCall, private readonly prefix?: Prefix) {
    this.#journal = new Journal(call.createSha256, prefix);
    this.#argvDigest = digest(call.createSha256, ["argv", ...call.snapshot.argv]);
    this.#journal.active = call.stages !== 0;
    this.#wasi = new WasiPreview1(call.snapshot, () => {
      const memory = this.#instance?.exports.memory;
      if (!(memory instanceof WebAssembly.Memory)) throw new WasiFault("missing guest memory");
      return memory;
    }, {
      clock: () => this.#clock(),
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
      this.#instance = new WebAssembly.Instance(this.call.module, imports);
      const start = this.#instance.exports._start;
      if (typeof start !== "function") throw new WasiFault("missing guest entry point");
      let status = 0;
      try {
        start();
      } catch (error) {
        if (!(error instanceof GuestExit)) throw error;
        status = error.status;
      }
      if (this.prefix && (!this.#childPipe || !this.#redirected)) {
        throw new ReplayMismatch("child ended before the selected branch");
      }
      if (!this.prefix && (status === 0 || status === 3 || status === 14)
        && (this.#ordinal !== this.call.stages || this.#pending || this.#wait.size)) {
        throw new WasiFault("parent ended before stage completion");
      }
      return { status, ...this.#wasi.streams() };
    } finally {
      this.#instance = undefined;
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

  constructor(readonly module: WebAssembly.Module, readonly snapshot: CallSnapshot,
              readonly createSha256: CreateSha256) {
    const mode = snapshot.argv[1];
    this.stages = mode === "-plan" ? 0 : mode === "-key" || mode === "-leaf" ? 1 : 3;
  }

  clock(): bigint {
    return BigInt(Math.floor(performance.now() * 1e6));
  }
}

export function replayGuest(module: WebAssembly.Module, snapshot: CallSnapshot, createSha256: CreateSha256): GuestResult {
  const call = new ReplayCall(module, snapshot, createSha256);
  try {
    const result = new InstanceRun(call).run();
    if (!call.failure) return { ...result, failure: null };
  } catch (error) {
    call.failure ??= classify(error);
  }
  return { status: 5, stdout: failed.slice(), stderr: new Uint8Array(0), failure: call.failure };
}
