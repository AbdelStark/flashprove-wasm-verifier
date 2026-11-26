/** Synchronous admission of the files and arguments shared by a call. */

export const Errno = {
  success: 0,
  acces: 2,
  badf: 8,
  inval: 28,
  io: 29,
  isdir: 31,
  loop: 32,
  mfile: 33,
  noent: 44,
  notdir: 54,
  notsup: 58,
  spipe: 70,
  notcapable: 76,
} as const;

export const MAX_PATH_BYTES = 4096;
export const MAX_FILE_BYTES = 64 * 2 ** 20;
export const MAX_INPUT_BYTES = 128 * 2 ** 20;
const MAX_ARGUMENT_BYTES = 2 ** 20;
const MAX_ARGUMENTS = 4096;
const MAX_PATH_METADATA_BYTES = 2 ** 20;
const MAX_FILES = 4096;
const encoder = new TextEncoder();

export type InputFile = Readonly<{
  kind: "file";
  size: bigint;
  readInto(destination: Uint8Array, offset: bigint): number;
}>;
export type Lookup = InputFile | Readonly<{ kind: "directory" }> | Readonly<{ kind: "error"; errno: number }>;
export interface CallNamespace {
  lookup(path: string): Lookup;
  lookupOperand?(path: string, open: boolean): Lookup;
}
export type CallSnapshot = Readonly<{ argv: readonly string[]; namespace: CallNamespace }>;

export class InputError extends Error {
  constructor(readonly code: "invalid-input" | "input-limit") {
    super(code);
  }
}

type Directory = { kind: "directory"; children: Map<string, Entry> };
type Entry = Directory | InputFile;
const directory: Lookup = Object.freeze({ kind: "directory" });

function makeDirectory(): Directory {
  return { kind: "directory", children: new Map() };
}

function canonicalParts(path: string): string[] {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\0") || !path.isWellFormed()) {
    throw new InputError("invalid-input");
  }
  if (path.length > MAX_PATH_BYTES || encoder.encode(path).length > MAX_PATH_BYTES) {
    throw new InputError("input-limit");
  }
  const parts = path.slice(1).split("/");
  if (parts.some(part => part === "" || part === "." || part === "..")) {
    throw new InputError("invalid-input");
  }
  return parts;
}

// Intrinsic accessors also recognize typed arrays from another realm.
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const viewKind = Object.getOwnPropertyDescriptor(typedArray, Symbol.toStringTag)!.get!;
const viewBuffer = Object.getOwnPropertyDescriptor(typedArray, "buffer")!.get!;
const viewLength = Object.getOwnPropertyDescriptor(typedArray, "byteLength")!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;

function copyFile(value: Uint8Array, remaining: number): Uint8Array<ArrayBuffer> {
  try {
    if (viewKind.call(value) !== "Uint8Array") throw new InputError("invalid-input");
    bufferLength.call(viewBuffer.call(value));
    const length: number = viewLength.call(value);
    if (length > MAX_FILE_BYTES || length > remaining) {
      throw new InputError("input-limit");
    }
    return new Uint8Array(value);
  } catch (error) {
    if (error instanceof InputError) throw error;
    // This includes shared buffers and views invalidated by a detach or resize.
    if (error instanceof TypeError) throw new InputError("invalid-input");
    throw error;
  }
}

export function ownedFile(bytes: Uint8Array): InputFile {
  return Object.freeze({
    kind: "file",
    size: BigInt(bytes.length),
    readInto(destination: Uint8Array, offset: bigint) {
      if (offset < 0n) throw new RangeError("negative file offset");
      if (offset >= bytes.length) return 0;
      const start = Number(offset);
      const count = Math.min(destination.length, bytes.length - start);
      destination.set(bytes.subarray(start, start + count));
      return count;
    },
  });
}

class SnapshotNamespace implements CallNamespace {
  readonly #root = makeDirectory();

  constructor(files: ReadonlyMap<string, Uint8Array>) {
    let total = 0;
    let pathBytes = 0;
    let entries = 0;
    for (const [path, value] of files) {
      const parts = canonicalParts(path);
      pathBytes += encoder.encode(path).length;
      if (++entries > MAX_FILES || pathBytes > MAX_PATH_METADATA_BYTES) throw new InputError("input-limit");
      const name = parts.pop()!;
      let current = this.#root;
      for (const component of parts) {
        let entry = current.children.get(component);
        if (entry?.kind === "file") throw new InputError("invalid-input");
        if (!entry) {
          entry = makeDirectory();
          current.children.set(component, entry);
        }
        current = entry;
      }
      if (current.children.has(name)) throw new InputError("invalid-input");
      const bytes = copyFile(value, MAX_INPUT_BYTES - total);
      total += bytes.length;
      current.children.set(name, ownedFile(bytes));
    }
  }

  lookup(path: string): Lookup {
    if (path === "/") return directory;
    let current: Entry = this.#root;
    for (const component of canonicalParts(path)) {
      if (current.kind === "file") return { kind: "error", errno: Errno.notdir };
      const entry: Entry | undefined = current.children.get(component);
      if (!entry) return { kind: "error", errno: Errno.noent };
      current = entry;
    }
    return current.kind === "directory" ? directory : current;
  }
}

export function captureCall(files: ReadonlyMap<string, Uint8Array>, args: readonly string[]): CallSnapshot {
  if (args.length > MAX_ARGUMENTS) throw new InputError("input-limit");
  const argv: string[] = [];
  let bytes = 0;
  for (const arg of args) {
    if (typeof arg !== "string" || !arg.isWellFormed() || arg.includes("\0")) throw new InputError("invalid-input");
    if (arg.length >= MAX_ARGUMENT_BYTES) throw new InputError("input-limit");
    bytes += encoder.encode(arg).length + 1;
    if (bytes > MAX_ARGUMENT_BYTES || argv.length >= MAX_ARGUMENTS) throw new InputError("input-limit");
    argv.push(arg);
  }
  return Object.freeze({ argv: Object.freeze(argv), namespace: Object.freeze(new SnapshotNamespace(files)) });
}
