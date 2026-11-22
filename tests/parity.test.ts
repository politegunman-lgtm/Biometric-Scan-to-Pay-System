import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256Bytes, sha256Hex } from "../src/lib/sha256";
import { sensorTemplate } from "../src/lib/sensor";
import { synthesiseTemplate } from "../src/lib/biometrics";

const cases = [
  "",
  "a",
  "abc",
  "seed:7",
  "local-sensor-000000000000000000000000000000000000",
  "Mfoundi Market Foods · 3 500 FCFA · Yaoundé",
  "ligne d'essai — accents é à ç ü",
  "日本語のテスト",
  "emoji 🫆🔐",
  "x".repeat(55),
  "y".repeat(56),
  "z".repeat(64),
  "w".repeat(1000),
];

test("bundled SHA-256 matches node crypto byte for byte", () => {
  for (const input of cases) {
    const expected = createHash("sha256").update(input, "utf8").digest("hex");
    assert.equal(sha256Hex(input), expected, `hex mismatch for ${JSON.stringify(input.slice(0, 24))}`);
    assert.deepEqual(
      sha256Bytes(input),
      new Uint8Array(createHash("sha256").update(input, "utf8").digest()),
      "byte mismatch",
    );
  }
});

test("SHA-256 handles UTF-8 and binary input identically", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
  assert.equal(sha256Hex(bytes), createHash("sha256").update(bytes).digest("hex"));
});

test("client sensor template is identical to the server template", async () => {
  const seeds = ["demo-seed", "local-sensor-abc123", "", "z".repeat(200)];
  for (const seed of seeds) {
    for (const fingerId of ["right-index", "left-thumb"]) {
      const client = await sensorTemplate(seed, fingerId);
      const server = synthesiseTemplate(seed, fingerId);
      assert.deepEqual(client, server, `mismatch for ${seed || "<empty>"} / ${fingerId}`);
    }
  }
});

test("biometrics still work where crypto.subtle is missing (plain http)", async () => {
  const original = globalThis.crypto;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  // A non-secure context exposes getRandomValues but not subtle.
  Object.defineProperty(globalThis, "crypto", {
    value: { getRandomValues: original.getRandomValues.bind(original) },
    configurable: true,
    writable: true,
  });
  try {
    assert.equal(globalThis.crypto.subtle, undefined);
    const template = await sensorTemplate("offline-device-seed", "right-index");
    assert.equal(template.length, 128);
    assert.deepEqual(template, synthesiseTemplate("offline-device-seed", "right-index"));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else Object.defineProperty(globalThis, "crypto", { value: original, configurable: true, writable: true });
  }
});
