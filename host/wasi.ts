/** The audited Preview 1 imports for one verifier instance. */

import { Errno, MAX_PATH_BYTES } from "./namespace.js";
import type { CallSnapshot, InputFile, Lookup } from "./namespace.js";

export const PREVIEW1 = "wasi_snapshot_preview1";
const U32_MAX = 0xffff_ffff;
const I64_MAX = (1n << 63n) - 1n;
const U64_MAX = (1n << 64n) - 1n;
const MAX_FDS = 1024;
const MAX_IOVECS = 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const FD_READ = 1n << 1n;
const FD_SEEK = 1n << 2n;
const FD_SET_FLAGS = 1n << 3n;
const FD_TELL = 1n << 5n;
const FD_WRITE = 1n << 6n;
const PATH_OPEN = 1n << 13n;
const PATH_STAT = 1n << 18n;
const FD_STAT = 1n << 21n;
const FILE_RIGHTS = FD_READ | FD_SEEK | FD_TELL | FD_SET_FLAGS | FD_STAT;
const DIR_RIGHTS = PATH_OPEN | PATH_STAT | FD_STAT;

export type StagePipe = { reader: number; writer: number; bytes?: Uint8Array; position: number };
export type WasiObservation = {
  span(bytes: Uint8Array): void;
  lookup(path: string, open: boolean, entry: Lookup): void;
};

type Descriptor = (
  | { kind: "stdin" }
  | { kind: "output"; stream: Capture }
  | { kind: "directory"; path: string }
  | { kind: "file"; file: InputFile; position: bigint }
  | { kind: "pipe-read" | "pipe-write"; pipe: StagePipe }
) & { rights: bigint; inheriting?: bigint };

export class WasiFault extends Error {
  constructor(message: string, readonly code: "abi" | "output-limit" = "abi") {
    super(message);
  }
}

export class GuestExit extends Error {
  constructor(readonly status: number) {
    super("guest exit");
  }
}

class Memory {
  constructor(readonly buffer: ArrayBuffer, private readonly observe?: WasiObservation) {}

  view(pointer: number, length: number): Uint8Array<ArrayBuffer> {
    const start = pointer >>> 0;
    if (length < 0 || length > this.buffer.byteLength - start) throw new WasiFault("guest memory range");
    const span = new Uint8Array(this.buffer, start, length);
    this.observe?.span(span);
    return span;
  }

  data(pointer: number, length: number): DataView<ArrayBuffer> {
    const span = this.view(pointer, length);
    return new DataView(span.buffer, span.byteOffset, span.byteLength);
  }

  iovecs(pointer: number, count: number): Uint8Array<ArrayBuffer>[] {
    if (count < 0 || count > MAX_IOVECS) throw new WasiFault("guest iovec count");
    const table = this.data(pointer, count * 8);
    const spans: Uint8Array<ArrayBuffer>[] = [];
    let bytes = 0;
    for (let index = 0; index < count; index++) {
      const span = this.view(table.getUint32(index * 8, true), table.getUint32(index * 8 + 4, true));
      bytes += span.length;
      if (bytes > U32_MAX) throw new WasiFault("guest iovec length");
      spans.push(span);
    }
    return spans;
  }
}

class Capture {
  #bytes = new Uint8Array(0);
  length = 0;

  append(spans: Uint8Array[], count: number, maximum: number) {
    const size = this.length + count;
    if (size > this.#bytes.length) {
      const bytes = new Uint8Array(Math.max(size, Math.min(this.#bytes.length * 2, maximum)));
      bytes.set(this.#bytes);
      this.#bytes = bytes;
    }
    for (const span of spans) {
      this.#bytes.set(span, this.length);
      this.length += span.length;
    }
  }

  bytes(): Uint8Array<ArrayBuffer> {
    return this.#bytes.slice(0, this.length);
  }

  clear() {
    this.#bytes = new Uint8Array(0);
    this.length = 0;
  }
}

function fileType(kind: Descriptor["kind"]): number {
  if (kind === "pipe-read" || kind === "pipe-write") return 0;
  return kind === "directory" ? 3 : kind === "file" ? 4 : 2;
}

function filestat(memory: Memory, pointer: number, type: number, size: bigint): number {
  memory.view(pointer, 64).fill(0);
  const out = memory.data(pointer, 64);
  out.setUint8(16, type);
  out.setBigUint64(24, 1n, true);
  out.setBigUint64(32, size, true);
  return Errno.success;
}

export class WasiPreview1 {
  readonly #stdout = new Capture();
  readonly #stderr = new Capture();
  readonly #fds = new Map<number, Descriptor>([
    [0, { kind: "stdin", rights: FD_READ | FD_STAT }],
    [1, { kind: "output", stream: this.#stdout, rights: FD_WRITE | FD_STAT | FD_SET_FLAGS }],
    [2, { kind: "output", stream: this.#stderr, rights: FD_WRITE | FD_STAT | FD_SET_FLAGS }],
    [3, { kind: "directory", path: "/", rights: DIR_RIGHTS, inheriting: FILE_RIGHTS | DIR_RIGHTS }],
  ]);
  readonly #argv: Uint8Array<ArrayBuffer>[];
  readonly #argSize: number;
  readonly #clock: () => bigint;
  readonly #outputLimit: number;
  #lastTime = 0n;

  constructor(
    private readonly snapshot: CallSnapshot,
    private readonly memory: () => WebAssembly.Memory,
    private readonly options: { clock?: () => bigint; outputLimit?: number; observe?: WasiObservation } = {},
  ) {
    this.#argv = snapshot.argv.map(arg => encoder.encode(arg));
    this.#argSize = this.#argv.reduce((size, arg) => size + arg.length + 1, 0);
    this.#clock = options.clock ?? (() => BigInt(Math.floor(performance.now() * 1e6)));
    this.#outputLimit = options.outputLimit ?? 8 * 2 ** 20;
    if (!Number.isSafeInteger(this.#outputLimit) || this.#outputLimit < 0 || this.#outputLimit > U32_MAX) {
      throw new RangeError("invalid output limit");
    }
  }

  get #memory(): Memory {
    return new Memory(this.memory().buffer, this.options.observe);
  }

  #available(from = 4): number {
    for (let fd = from; fd < MAX_FDS; fd++) if (!this.#fds.has(fd)) return fd;
    return -1;
  }

  makePipe(pointer: number): StagePipe {
    const out = this.#memory.data(pointer, 8);
    const reader = this.#available();
    const writer = reader === -1 ? -1 : this.#available(reader + 1);
    if (writer === -1) throw new WasiFault("guest descriptor limit");
    const pipe = { reader, writer, position: 0 };
    this.#fds.set(reader, { kind: "pipe-read", pipe, rights: FD_READ });
    this.#fds.set(writer, { kind: "pipe-write", pipe, rights: FD_WRITE });
    out.setUint32(0, reader, true);
    out.setUint32(4, writer, true);
    return pipe;
  }

  hasPipe(pipe: StagePipe): boolean {
    const reader = this.#fds.get(pipe.reader);
    const writer = this.#fds.get(pipe.writer);
    return reader?.kind === "pipe-read" && reader.pipe === pipe && writer?.kind === "pipe-write" && writer.pipe === pipe;
  }

  beginChild() {
    this.#stdout.clear();
    this.#stderr.clear();
  }

  redirectChild(pipe: StagePipe, oldFd: number, newFd: number): number {
    const old = this.#fds.get(oldFd);
    if (newFd !== 1 || oldFd !== pipe.writer || old?.kind !== "pipe-write" || old.pipe !== pipe) {
      throw new WasiFault("unexpected child stdout redirect");
    }
    this.#fds.set(newFd, { kind: "output", stream: this.#stdout, rights: FD_WRITE });
    return newFd;
  }

  writeWaitWord(pointer: number, word: number) {
    this.#memory.data(pointer, 4).setUint32(0, word, true);
  }

  appendChildStderr(bytes: Uint8Array) {
    const maximum = this.#outputLimit - this.#stdout.length;
    if (bytes.length > maximum - this.#stderr.length) throw new WasiFault("guest output limit", "output-limit");
    this.#stderr.append([bytes], bytes.length, maximum);
  }

  streams() {
    return { stdout: this.#stdout.bytes(), stderr: this.#stderr.bytes() };
  }

  readonly imports = Object.freeze({
    args_get: (pointers: number, buffer: number) => {
      const memory = this.#memory;
      const table = memory.data(pointers, this.#argv.length * 4);
      const bytes = memory.view(buffer, this.#argSize);
      let offset = 0;
      for (const [index, arg] of this.#argv.entries()) {
        table.setUint32(index * 4, bytes.byteOffset + offset, true);
        bytes.set(arg, offset);
        offset += arg.length;
        bytes[offset++] = 0;
      }
      return Errno.success;
    },
    args_sizes_get: (count: number, size: number) => this.#pair(count, size, this.#argv.length, this.#argSize),
    environ_get: (pointers: number, buffer: number) => {
      const memory = this.#memory;
      memory.view(pointers, 0);
      memory.view(buffer, 0);
      return Errno.success;
    },
    environ_sizes_get: (count: number, size: number) => this.#pair(count, size, 0, 0),
    random_get: (_pointer: number, _size: number) => Errno.notcapable,
    clock_time_get: (id: number, _precision: bigint, pointer: number) => {
      if (id !== 1) return Errno.notsup;
      const out = this.#memory.data(pointer, 8);
      const value = this.#clock();
      if (value < this.#lastTime || value > U64_MAX) throw new WasiFault("invalid monotonic clock");
      out.setBigUint64(0, value, true);
      this.#lastTime = value;
      return Errno.success;
    },
    fd_prestat_get: (fd: number, pointer: number) => {
      if (fd !== 3 || !this.#fds.has(fd)) return Errno.badf;
      const out = this.#memory.data(pointer, 8);
      out.setUint32(0, 0, true);
      out.setUint32(4, 1, true);
      return Errno.success;
    },
    fd_prestat_dir_name: (fd: number, pointer: number, length: number) => {
      if (fd !== 3 || !this.#fds.has(fd)) return Errno.badf;
      if ((length >>> 0) < 1) return Errno.inval;
      this.#memory.view(pointer, length >>> 0)[0] = 47;
      return Errno.success;
    },
    path_open: (fd: number, flags: number, pointer: number, length: number, oflags: number,
                base: bigint, inheriting: bigint, fdflags: number, output: number) => {
      if ((oflags !== 0 && oflags !== 2) || fdflags !== 0) return Errno.notcapable;
      const resolved = this.#resolve(fd, flags, pointer, length, PATH_OPEN, base | inheriting);
      if (resolved.kind === "error") return resolved.errno;
      if (oflags === 2 && resolved.kind === "file") return Errno.notdir;
      const out = this.#memory.data(output, 4);
      const index = this.#available();
      if (index === -1) return Errno.mfile;
      this.#fds.set(index, resolved.kind === "directory"
        ? { kind: "directory", path: resolved.path, rights: base & DIR_RIGHTS, inheriting }
        : { kind: "file", file: resolved, rights: base & FILE_RIGHTS, position: 0n });
      out.setUint32(0, index, true);
      return Errno.success;
    },
    path_filestat_get: (fd: number, flags: number, pointer: number, length: number, output: number) => {
      const resolved = this.#resolve(fd, flags, pointer, length, PATH_STAT);
      if (resolved.kind === "error") return resolved.errno;
      return filestat(this.#memory, output, fileType(resolved.kind), resolved.kind === "file" ? resolved.size : 0n);
    },
    fd_filestat_get: (fd: number, pointer: number) => {
      const entry = this.#fds.get(fd);
      if (!entry) return Errno.badf;
      if (!(entry.rights & FD_STAT)) return Errno.notcapable;
      return filestat(this.#memory, pointer, fileType(entry.kind), entry.kind === "file" ? entry.file.size : 0n);
    },
    fd_fdstat_get: (fd: number, pointer: number) => {
      const entry = this.#fds.get(fd);
      if (!entry) return Errno.badf;
      const memory = this.#memory;
      memory.view(pointer, 24).fill(0);
      const out = memory.data(pointer, 24);
      out.setUint8(0, fileType(entry.kind));
      out.setBigUint64(8, entry.rights, true);
      out.setBigUint64(16, entry.inheriting ?? 0n, true);
      return Errno.success;
    },
    fd_fdstat_set_flags: (fd: number, flags: number) => {
      const entry = this.#fds.get(fd);
      if (!entry) return Errno.badf;
      return flags === 0 && (entry.rights & FD_SET_FLAGS) ? Errno.success : Errno.notcapable;
    },
    fd_close: (fd: number) => {
      const entry = this.#fds.get(fd);
      if (!entry) return Errno.badf;
      if (entry.kind === "pipe-read") entry.pipe.bytes = undefined;
      this.#fds.delete(fd);
      return Errno.success;
    },
    fd_seek: (fd: number, offset: bigint, whence: number, pointer: number) => {
      const entry = this.#fds.get(fd);
      if (!entry) return Errno.badf;
      if (entry.kind !== "file") return Errno.spipe;
      if (!(entry.rights & FD_SEEK)) return Errno.notcapable;
      if (whence !== 0 && whence !== 1 && whence !== 2) return Errno.inval;
      const base = whence === 0 ? 0n : whence === 1 ? entry.position : entry.file.size;
      const position = base + offset;
      if (position < 0n || position > I64_MAX) return Errno.inval;
      this.#memory.data(pointer, 8).setBigUint64(0, position, true);
      entry.position = position;
      return Errno.success;
    },
    fd_read: (fd: number, vectors: number, count: number, pointer: number) =>
      this.#read(fd, vectors, count, pointer),
    fd_pread: (fd: number, vectors: number, count: number, offset: bigint, pointer: number) =>
      this.#read(fd, vectors, count, pointer, offset),
    fd_write: (fd: number, vectors: number, count: number, pointer: number) => {
      const entry = this.#fds.get(fd);
      if (!entry) return Errno.badf;
      if (entry.kind !== "output" || !(entry.rights & FD_WRITE)) return Errno.notcapable;
      const memory = this.#memory;
      const result = memory.data(pointer, 4);
      const spans = memory.iovecs(vectors, count);
      const size = spans.reduce((bytes, span) => bytes + span.length, 0);
      const other = entry.stream === this.#stdout ? this.#stderr : this.#stdout;
      const maximum = this.#outputLimit - other.length;
      if (size > maximum - entry.stream.length) throw new WasiFault("guest output limit", "output-limit");
      entry.stream.append(spans, size, maximum);
      result.setUint32(0, size, true);
      return Errno.success;
    },
    proc_exit: (status: number): never => {
      if (status < 0 || status > 255) throw new WasiFault("invalid guest exit");
      throw new GuestExit(status);
    },
  });

  #pair(first: number, second: number, a: number, b: number): number {
    const memory = this.#memory;
    const firstOut = memory.data(first, 4);
    const secondOut = memory.data(second, 4);
    firstOut.setUint32(0, a, true);
    secondOut.setUint32(0, b, true);
    return Errno.success;
  }

  #resolve(fd: number, flags: number, pointer: number, length: number, right: bigint, requested = 0n):
    InputFile | { kind: "directory"; path: string } | { kind: "error"; errno: number } {
    const directory = this.#fds.get(fd);
    if (!directory) return { kind: "error", errno: Errno.badf };
    if (directory.kind !== "directory") return { kind: "error", errno: Errno.notdir };
    if (!(directory.rights & right) || (requested & ~(directory.inheriting ?? 0n))) {
      return { kind: "error", errno: Errno.notcapable };
    }
    const size = length >>> 0;
    if ((flags !== 0 && flags !== 1) || size > MAX_PATH_BYTES) return { kind: "error", errno: Errno.inval };
    const bytes = this.#memory.view(pointer, size);
    let path: string;
    try {
      path = decoder.decode(bytes);
    } catch {
      return { kind: "error", errno: Errno.inval };
    }
    if (!path) return { kind: "error", errno: Errno.noent };
    if (path.includes("\0")) return { kind: "error", errno: Errno.inval };
    if (path.startsWith("/")) return { kind: "error", errno: Errno.notcapable };
    if (fd === 3 && this.snapshot.namespace.lookupOperand) {
      const open = right === PATH_OPEN;
      const entry = this.snapshot.namespace.lookupOperand(path, open);
      this.options.observe?.lookup(path, open, entry);
      return entry.kind === "directory" ? { kind: "directory", path: "/" } : entry;
    }

    const root = directory.path === "/" ? [] : directory.path.slice(1).split("/");
    const parts = root.slice();
    let current: Lookup = { kind: "directory" };
    const components = path.split("/");
    for (const [index, part] of components.entries()) {
      if (current.kind === "file") return { kind: "error", errno: Errno.notdir };
      if (part === "" || part === ".") continue;
      if (part === "..") {
        if (parts.length <= root.length) return { kind: "error", errno: Errno.notcapable };
        parts.pop();
        continue;
      }
      parts.push(part);
      const canonical = "/" + parts.join("/");
      if (canonical.length > MAX_PATH_BYTES || encoder.encode(canonical).length > MAX_PATH_BYTES) {
        return { kind: "error", errno: Errno.inval };
      }
      current = this.snapshot.namespace.lookup(canonical);
      this.options.observe?.lookup(canonical, right === PATH_OPEN && index === components.length - 1, current);
      if (current.kind === "error") return current;
    }
    return current.kind === "directory" ? { kind: "directory", path: "/" + parts.join("/") } : current;
  }

  #read(fd: number, vectors: number, count: number, pointer: number, offset?: bigint): number {
    const entry = this.#fds.get(fd);
    if (!entry) return Errno.badf;
    if (entry.kind === "directory") return Errno.isdir;
    if (!(entry.rights & FD_READ)) return Errno.notcapable;
    if (offset !== undefined && (offset < 0n || offset > I64_MAX)) return Errno.inval;
    if (entry.kind !== "file" && offset !== undefined) return Errno.spipe;
    const memory = this.#memory;
    const result = memory.data(pointer, 4);
    const spans = memory.iovecs(vectors, count);
    let bytes = 0;
    if (entry.kind === "file") {
      const start = offset ?? entry.position;
      for (const span of spans) {
        const copied = entry.file.readInto(span, start + BigInt(bytes));
        if (!Number.isInteger(copied) || copied < 0 || copied > span.length) throw new WasiFault("invalid file read");
        bytes += copied;
        if (copied < span.length) break;
      }
      if (offset === undefined) entry.position += BigInt(bytes);
    } else if (entry.kind === "pipe-read") {
      const pipe = entry.pipe;
      if (pipe.bytes === undefined) throw new WasiFault("stage pipe before completion");
      for (const span of spans) {
        const count = Math.min(span.length, pipe.bytes.length - pipe.position);
        span.set(pipe.bytes.subarray(pipe.position, pipe.position + count));
        pipe.position += count;
        bytes += count;
        if (count < span.length) break;
      }
    }
    result.setUint32(0, bytes, true);
    return Errno.success;
  }
}
