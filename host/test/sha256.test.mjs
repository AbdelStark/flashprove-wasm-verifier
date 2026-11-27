import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { test } from "node:test";
import { createSha256 } from "../../build/ts/host/sha256.js";

const reference = parts => { const hash = createHash("sha256"); for (const part of parts) hash.update(part); return hash.digest("hex"); };
const ours = parts => { const hash = createSha256(); for (const part of parts) hash.update(part); return hash.digest(); };

test("SHA-256 matches node:crypto on the FIPS vectors and every padding boundary", () => {
  assert.equal(ours([new TextEncoder().encode("abc")]), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(ours([]), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  for (let length = 0; length <= 200; length++) {
    const bytes = randomBytes(length);
    assert.equal(ours([bytes]), reference([bytes]), `length ${length}`);
  }
});

test("SHA-256 is incremental across arbitrary splits and refuses reuse", () => {
  const bytes = randomBytes(100_003);
  const parts = [];
  for (let offset = 0; offset < bytes.length;) {
    const size = 1 + (offset * 7919) % 257;
    parts.push(bytes.subarray(offset, offset + size), new Uint8Array(0));
    offset += size;
  }
  assert.equal(ours(parts), reference([bytes]));
  const hash = createSha256();
  hash.digest();
  assert.throws(() => hash.update(new Uint8Array(1)));
  assert.throws(() => hash.digest());
});
