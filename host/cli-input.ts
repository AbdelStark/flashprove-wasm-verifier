/** Acquire only the disk inputs selected by the caller and opened by the guest. */

import { closeSync, constants, fstatSync, openSync, readSync, statfsSync } from "node:fs";
import type { BigIntStats } from "node:fs";
import { arch, cwd as currentDirectory, platform } from "node:process";
import { captureCall, Errno, InputError, MAX_FILE_BYTES, MAX_INPUT_BYTES, ownedFile } from "./namespace.js";
import type { CallNamespace, CallSnapshot, Lookup } from "./namespace.js";

const O_PATH = 0o10000000;
const PROC_SUPER_MAGIC = 0x9fa0;
const MAX_OBSERVATIONS = 1024;
const procFd = (fd: number) => `/proc/self/fd/${fd}`;

type Failure = Extract<Lookup, { kind: "error" }>;
type Binding = { target: string; directory?: string; name?: string };
type AnchoredFile = { fd: number; stats: BigIntStats; opened?: Lookup };

export class DiskInputError extends Error {
  readonly code = "host-io";
  constructor() {
    super("host-io");
  }
}

function error(errno: number): Failure {
  return { kind: "error", errno };
}

function ordinaryFailure(value: unknown): Failure {
  const code = (value as { code?: unknown } | null)?.code;
  switch (code) {
    case "ENOENT": return error(Errno.noent);
    case "ENOTDIR": return error(Errno.notdir);
    case "EACCES":
    case "EPERM": return error(Errno.acces);
    case "ELOOP": return error(Errno.loop);
    case "ENAMETOOLONG": return error(Errno.inval);
    case "EISDIR": return error(Errno.isdir);
    case "EIO": return error(Errno.io);
    default: throw new DiskInputError();
  }
}

// wasi-libc strips leading slashes before calling the root preopen.
const operand = (value: string) => value.replace(/^\/+/, "") || ".";

function selectBindings(argv: readonly string[], workingDirectory: string) {
  const fixed = new Map<string, Binding[]>();
  const disk = (name: string) => name.startsWith("/") ? "/" + name.replace(/^\/+/, "")
    : `${workingDirectory.replace(/\/+$/, "")}/${name}`;
  const register = (value: string, binding: Binding) => {
    const key = operand(value);
    const bindings = fixed.get(key) ?? [];
    bindings.push(binding);
    fixed.set(key, bindings);
  };
  const explicit = (value: string | undefined) => {
    if (value) register(value, { target: disk(value) });
  };
  const confined = (root: string, name: string) => {
    const directory = disk(root);
    register(`${root}/${name}`, { target: `${directory}/${name}`, directory, name });
  };
  const config = (root: string | undefined) => {
    if (root) for (const name of ["policy.txt", "KL.bin", "layout.txt"]) confined(root, name);
  };
  let leafRoot: string | undefined;
  if (argv[1] === "-plan") {
    switch (argv[2]) {
      case "id":
        config(argv[3]);
        explicit(argv[4]);
        break;
      case "accounting":
      case "arrays":
        config(argv[3]);
        break;
      case "request":
        explicit(argv[3]);
        explicit(argv[4]);
        for (let index = 6; index < argv.length; index++) {
          const option = argv[index];
          if (option === "-layout" || option === "-prompt" || option === "-reply") explicit(argv[++index]);
          else if (option === "-j") index++;
        }
        break;
    }
  } else if (argv[1] === "-key" || argv[1] === "-leaf") {
    config(argv[2]);
    explicit(argv[3]);
    if (argv[1] === "-leaf") explicit(argv[4]);
  } else {
    config(argv[1]);
    if (argv[2]) {
      confined(argv[2], "key.bin");
      leafRoot = argv[2];
    }
    explicit(argv[3]);
    explicit(argv[4]);
    explicit(argv[5]);
  }
  return { fixed, leafRoot, disk };
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
    && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

class ScopedDiskNamespace implements CallNamespace {
  readonly #bindings;
  readonly #anchors = new Set<number>();
  readonly #directories = new Map<string, number | Failure>();
  readonly #files = new Map<string, AnchoredFile | Failure>();
  #retained = 0;
  #ready = false;
  #closed = false;

  constructor(argv: readonly string[], workingDirectory: string) {
    this.#bindings = selectBindings(argv, workingDirectory);
  }

  lookup(path: string): Lookup {
    return this.lookupOperand(operand(path), true);
  }

  lookupOperand(path: string, open: boolean): Lookup {
    if (this.#closed) throw new DiskInputError();
    const { fixed, leafRoot, disk } = this.#bindings;
    const bindings = [...(fixed.get(path) ?? [])];
    if (leafRoot) {
      const prefix = operand(`${leafRoot}/leaf/`);
      const name = path.startsWith(prefix) ? path.slice(prefix.length) : "";
      if (/^(?:0|[1-9][0-9]{0,9})\.bin$/.test(name) && Number(name.slice(0, -4)) <= 0xffff_ffff) {
        const directory = disk(leafRoot);
        bindings.push({ target: `${directory}/leaf/${name}`, directory, name: `leaf/${name}` });
      }
    }
    if (bindings.length === 0) return error(Errno.noent);
    const binding = bindings.find(item => item.directory !== undefined) ?? bindings[0];
    if (bindings.some(other => other.target !== binding.target)) throw new DiskInputError();
    let entry = this.#files.get(path);
    if (!entry) {
      if (this.#files.size >= MAX_OBSERVATIONS) throw new InputError("input-limit");
      this.#proveProcfs();
      entry = this.#anchorFile(binding);
      this.#files.set(path, entry);
    }
    if ("kind" in entry) return entry;
    if (open) {
      if (entry.opened === undefined) {
        entry.opened = this.#capture(entry);
        this.#anchors.delete(entry.fd);
        closeSync(entry.fd);
      }
      return entry.opened;
    }
    return { kind: "file", size: entry.stats.size, readInto() { throw new DiskInputError(); } };
  }

  close() {
    this.#closed = true;
    for (const fd of this.#anchors) closeSync(fd);
    this.#anchors.clear();
    this.#directories.clear();
    this.#files.clear();
  }

  #proveProcfs() {
    if (this.#ready) return;
    try {
      if (platform !== "linux" || (arch !== "x64" && arch !== "arm64")
        || statfsSync("/proc/self/fd").type !== PROC_SUPER_MAGIC) throw new DiskInputError();
    } catch {
      throw new DiskInputError();
    }
    this.#ready = true;
  }

  #anchorDirectory(path: string, confined: boolean): number | Failure {
    const key = `${confined ? "child" : "root"}\0${path}`;
    const cached = this.#directories.get(key);
    if (cached !== undefined) return cached;
    let result: number | Failure;
    try {
      result = openSync(path, O_PATH | constants.O_DIRECTORY | (confined ? constants.O_NOFOLLOW : 0));
      this.#anchors.add(result);
    } catch (value) {
      result = ordinaryFailure(value);
    }
    this.#directories.set(key, result);
    return result;
  }

  #anchorFile(binding: Binding): AnchoredFile | Failure {
    let path = binding.target;
    if (binding.directory !== undefined && binding.name !== undefined) {
      let root = this.#anchorDirectory(binding.directory, false);
      if (typeof root !== "number") return root;
      const [first, leaf] = binding.name.split("/");
      if (leaf !== undefined) {
        root = this.#anchorDirectory(`${procFd(root)}/${first}`, true);
        if (typeof root !== "number") return root;
      }
      path = `${procFd(root)}/${leaf ?? first}`;
    }
    let fd: number | undefined;
    try {
      fd = openSync(path, O_PATH | (binding.directory !== undefined ? constants.O_NOFOLLOW : 0));
      const stats = fstatSync(fd, { bigint: true });
      if (stats.isSymbolicLink()) return error(Errno.loop);
      if (!stats.isFile()) return error(stats.isDirectory() ? Errno.isdir : Errno.acces);
      this.#anchors.add(fd);
      return { fd, stats };
    } catch (value) {
      return ordinaryFailure(value);
    } finally {
      if (fd !== undefined && !this.#anchors.has(fd)) closeSync(fd);
    }
  }

  #capture(entry: AnchoredFile): Lookup {
    if (entry.stats.size > MAX_FILE_BYTES || entry.stats.size > MAX_INPUT_BYTES - this.#retained) {
      throw new InputError("input-limit");
    }
    let readable: number;
    try {
      readable = openSync(procFd(entry.fd), constants.O_RDONLY | constants.O_NONBLOCK);
    } catch (value) {
      return ordinaryFailure(value);
    }
    try {
      const before = fstatSync(readable, { bigint: true });
      if (!sameFile(entry.stats, before)) throw new DiskInputError();
      const size = Number(before.size);
      const bytes = new Uint8Array(size + 1);
      let total = 0;
      while (total < bytes.length) {
        const count = readSync(readable, bytes, total, bytes.length - total, null);
        if (!count) break;
        total += count;
      }
      if (total !== size || !sameFile(before, fstatSync(readable, { bigint: true }))) throw new DiskInputError();
      this.#retained += total;
      return ownedFile(bytes.subarray(0, total));
    } catch (value) {
      if (value instanceof DiskInputError) throw value;
      return ordinaryFailure(value);
    } finally {
      closeSync(readable);
    }
  }
}

export function captureCliInputs(args: readonly string[], workingDirectory = currentDirectory()):
  CallSnapshot & { namespace: ScopedDiskNamespace } {
  const { argv } = captureCall(new Map(), ["cp_verify", ...args]);
  return Object.freeze({ argv, namespace: new ScopedDiskNamespace(argv, workingDirectory) });
}
