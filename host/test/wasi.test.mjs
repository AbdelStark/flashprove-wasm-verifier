import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { captureCall, Errno, InputError } from "../../build/ts/host/namespace.js";
import { GuestExit, PREVIEW1, WasiFault, WasiPreview1 } from "../../build/ts/host/wasi.js";

const FILE = (1n << 1n) | (1n << 2n) | (1n << 21n);
const DIR = (1n << 13n) | (1n << 18n) | (1n << 21n);
const WRITE = 1n << 6n;
const encode = (text) => new TextEncoder().encode(text);
const decode = (bytes) => new TextDecoder().decode(bytes);

function instance(snapshot, options) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const host = new WasiPreview1(snapshot, () => memory, options);
  const data = () => new DataView(memory.buffer);
  const view = (offset, length) => new Uint8Array(memory.buffer, offset, length);
  const { imports } = host;

  function open(path, fd = 3, base = FILE, inheriting = 0n, flags = 0) {
    const bytes = typeof path === "string" ? encode(path) : path;
    view(100, bytes.length).set(bytes);
    const status = imports.path_open(fd, 0, 100, bytes.length, flags, base, inheriting, 0, 4);
    return status === 0 ? data().getUint32(4, true) : -status;
  }

  function iovec(pointer, length, index = 0) {
    data().setUint32(40 + index * 8, pointer, true);
    data().setUint32(44 + index * 8, length, true);
  }

  function read(fd, length, offset) {
    iovec(500, length);
    const status = offset === undefined ? imports.fd_read(fd, 40, 1, 60)
      : imports.fd_pread(fd, 40, 1, offset, 60);
    assert.equal(status, 0);
    return decode(view(500, data().getUint32(60, true)));
  }

  return { memory, host, imports, data, view, open, iovec, read };
}

const snapshot = () => captureCall(new Map([
  ["/cfg/file", encode("abcdef")],
  ["/cfg/sub/other", encode("public")],
  ["/cfg/é", encode("unicode")],
  ["/cfg/\ufeffbom", encode("preserved")],
  ["/away", encode("outside the directory descriptor")],
]), ["cp_verify", "-plan", "accounting"]);

test("the imported function names match the reviewed Preview 1 surface", () => {
  const audit = JSON.parse(readFileSync(new URL("../../port/audit.json", import.meta.url)));
  const names = audit.imports.filter(line => line.startsWith(PREVIEW1 + "."))
    .map(line => line.split(" ")[0].slice(PREVIEW1.length + 1)).sort();
  assert.deepEqual(Object.keys(instance(snapshot()).imports).sort(), names);
});

test("admission rejects invalid paths, file directory collisions and invalid buffers", () => {
  for (const path of ["", "relative", "/", "/a//b", "/a/.", "/a/../b", "/a/", "/a\0b", "/\ud800"]) {
    assert.throws(() => captureCall(new Map([[path, new Uint8Array()]]), []), { code: "invalid-input" });
  }
  for (const paths of [["/a", "/a/b"], ["/a/b", "/a"]]) {
    assert.throws(() => captureCall(new Map(paths.map(path => [path, new Uint8Array()])), []), InputError);
  }
  const detached = new Uint8Array(1);
  structuredClone(detached, { transfer: [detached.buffer] });
  for (const bytes of [new Uint8Array(new SharedArrayBuffer(2)), detached, new Uint8ClampedArray(1)]) {
    assert.throws(() => captureCall(new Map([["/file", bytes]]), []), { code: "invalid-input" });
  }
  assert.throws(() => captureCall(new Map(), ["\udc00"]), { code: "invalid-input" });
  assert.throws(() => captureCall(new Map(), ["has\0nul"]), { code: "invalid-input" });
  assert.throws(() => captureCall(new Map(), ["x".repeat(2 ** 20)]), { code: "input-limit" });
});

test("synchronous admission freezes the map, argv and bytes across a suspension", async () => {
  const owner = Buffer.from("xxoriginalyy");
  const files = new Map([["/file", owner.subarray(2, -2)]]);
  files.set("/foreign", runInNewContext("Uint8Array.of(65)"));
  const args = ["cp_verify", "é", ""];
  async function launch() {
    const admitted = captureCall(files, args);
    await Promise.resolve();
    return instance(admitted);
  }
  const pending = launch();
  owner.fill(0);
  files.clear();
  args[0] = "changed";
  args.push("new value");
  const guest = await pending;
  assert.equal(guest.read(guest.open("file"), 16), "original");
  assert.equal(guest.read(guest.open("foreign"), 16), "A");
  assert.equal(guest.imports.args_sizes_get(0, 4), 0);
  assert.equal(guest.data().getUint32(0, true), 3);
  assert.equal(guest.data().getUint32(4, true), 14);
  assert.equal(guest.imports.args_get(16, 80), 0);
  assert.deepEqual([16, 20, 24].map(p => guest.data().getUint32(p, true)), [80, 90, 93]);
  assert.deepEqual(guest.view(80, 14), encode("cp_verify\0é\0\0"));
});

test("path resolution visits intermediate segments and honors directory capabilities", () => {
  const guest = instance(snapshot());
  for (const path of ["cfg//sub/.././file", "./cfg/file", "cfg/é", "cfg/\ufeffbom"]) {
    assert.ok(guest.open(path) >= 4);
  }
  for (const path of ["cfg/file/../sub/other", "cfg/file/.", "cfg/file/", "cfg/file/name"]) {
    assert.equal(guest.open(path), -Errno.notdir);
  }
  assert.equal(guest.open("cfg/missing/../file"), -Errno.noent);
  assert.equal(guest.open("../away"), -Errno.notcapable);
  assert.equal(guest.open("/away"), -Errno.notcapable);
  assert.equal(guest.open(Uint8Array.of(0xc0, 0x80)), -Errno.inval);
  assert.equal(guest.open("cfg/fi\0le"), -Errno.inval);
  assert.equal(guest.open("cfg/file", 3, FILE, 0n, 2), -Errno.notdir);
  const directory = guest.open("cfg", 3, DIR, DIR | FILE, 2);
  assert.ok(directory >= 4);
  assert.equal(guest.open("../away", directory), -Errno.notcapable);
  assert.equal(guest.open("sub/../file", directory) > directory, true);
  assert.equal(guest.open("file", directory, WRITE), -Errno.notcapable);
});

test("descriptor cursors, bounds and rights are local to each instance", () => {
  const call = snapshot();
  const first = instance(call), second = instance(call);
  const a = first.open("cfg/file"), b = first.open("cfg/file"), c = second.open("cfg/file");
  assert.equal(first.read(a, 2), "ab");
  assert.equal(first.read(a, 2, 4n), "ef");
  assert.equal(first.read(a, 2), "cd");
  assert.equal(first.read(b, 2), "ab");
  assert.equal(second.read(c, 2), "ab");
  assert.equal(first.imports.fd_seek(a, -1n, 2, 80), 0);
  assert.equal(first.data().getBigUint64(80, true), 5n);
  assert.equal(first.read(a, 8), "f");
  assert.equal(first.read(a, 8), "");
  assert.equal(first.imports.fd_seek(a, 1n << 63n, 0, 80), Errno.inval);
  assert.equal(first.imports.fd_filestat_get(a, 900), 0);
  assert.equal(first.data().getUint8(916), 4);
  assert.equal(first.data().getBigUint64(932, true), 6n);
  assert.equal(first.imports.fd_close(a), 0);
  assert.equal(first.imports.fd_read(a, 40, 1, 60), Errno.badf);
  assert.equal(first.open("cfg/file"), a);
  for (let fd = 6; fd < 1024; fd++) assert.equal(first.open("cfg/file"), fd);
  assert.equal(first.open("cfg/file"), -Errno.mfile);
});

test("WASI denies ambient capabilities, checks spans and bounds output", () => {
  const guest = instance(snapshot(), { clock: () => 123n, outputLimit: 4 });
  const { imports } = guest;
  guest.view(700, 8).fill(0xff);
  assert.equal(imports.environ_sizes_get(700, 704), 0);
  assert.deepEqual(guest.view(700, 8), new Uint8Array(8));
  assert.equal(imports.random_get(700, 8), Errno.notcapable);
  assert.equal(imports.clock_time_get(0, 0n, 700), Errno.notsup);
  assert.equal(imports.clock_time_get(1, 0n, 700), 0);
  assert.equal(guest.data().getBigUint64(700, true), 123n);
  assert.throws(() => imports.args_get(-1, 80), WasiFault);
  assert.throws(() => imports.fd_read(0, 40, 1025, 60), WasiFault);
  guest.iovec(65535, 2);
  assert.throws(() => imports.fd_write(1, 40, 1, 60), WasiFault);
  guest.view(500, 3).set(encode("abc"));
  guest.iovec(500, 3);
  assert.equal(imports.fd_write(1, 40, 1, 60), 0);
  guest.memory.grow(1);
  guest.view(500, 2).set(encode("xy"));
  guest.iovec(500, 2);
  assert.throws(() => imports.fd_write(2, 40, 1, 60), WasiFault);
  assert.equal(decode(guest.host.streams().stdout), "abc");
  assert.equal(guest.host.streams().stderr.length, 0);
  assert.throws(() => imports.proc_exit(3), error => error instanceof GuestExit && error.status === 3);
});
