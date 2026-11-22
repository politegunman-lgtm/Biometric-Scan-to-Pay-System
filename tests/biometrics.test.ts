import test from "node:test";
import assert from "node:assert/strict";
import {
  LOW_CONFIDENCE_THRESHOLD,
  MATCH_THRESHOLD,
  confidenceFromScore,
  cosine,
  evaluateLiveness,
  matchBiometric,
  synthesiseCapture,
  synthesiseTemplate,
  templateHash,
} from "../src/lib/biometrics";

const SEED = "test-sensor-seed";
const template = synthesiseTemplate(SEED, "right-index");
const sealed = JSON.stringify(template);
const live = { challengeId: "chl_1", holdMs: 1150, microMotion: 0.4, rotationDeg: 2.4 };

const match = (over: Partial<Parameters<typeof matchBiometric>[0]> = {}) =>
  matchBiometric({
    sealedTemplate: sealed,
    liveSample: synthesiseCapture({ seed: SEED, fingerId: "right-index", quality: 0.96, impostor: false }),
    liveness: live,
    livenessEnabled: true,
    threshold: MATCH_THRESHOLD,
    lockedUntil: null,
    ...over,
  });

test("genuine captures match with high confidence", () => {
  for (let i = 0; i < 5; i++) {
    const result = match();
    assert.equal(result.matched, true);
    assert.ok(result.score > 0.94, `score ${result.score}`);
    assert.equal(result.reason, "ok");
  }
});

test("a different finger is rejected", () => {
  const result = match({
    liveSample: synthesiseCapture({ seed: SEED, fingerId: "right-index", quality: 0.95, impostor: true }),
  });
  assert.equal(result.matched, false);
  assert.equal(result.reason, "below-threshold");
  assert.ok(result.score < 0.35);
});

test("poor sensor contact produces a weak or failed match", () => {
  const result = match({
    liveSample: synthesiseCapture({ seed: SEED, fingerId: "right-index", quality: 0.42, impostor: false }),
  });
  assert.ok(result.score < MATCH_THRESHOLD, `dry-finger score ${result.score}`);
});

test("low-confidence matches are flagged for step-up", () => {
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    const result = match({
      liveSample: synthesiseCapture({ seed: SEED, fingerId: "right-index", quality: 0.62, impostor: false }),
    });
    if (result.matched && result.score < LOW_CONFIDENCE_THRESHOLD) {
      assert.equal(result.lowConfidence, true);
      found = true;
    }
  }
  assert.ok(found, "expected at least one weak-but-valid match at mid quality");
});

test("liveness rejects replays, short presses and static contact", () => {
  assert.equal(evaluateLiveness({ ...live, replayed: true }, true).passed, false);
  assert.equal(evaluateLiveness({ ...live, holdMs: 200 }, true).passed, false);
  assert.equal(evaluateLiveness({ ...live, microMotion: 0.02 }, true).passed, false);
  assert.equal(evaluateLiveness({ ...live, rotationDeg: 0.1 }, true).passed, false);
  assert.equal(evaluateLiveness(live, true).passed, true);
  assert.equal(evaluateLiveness(undefined, false).passed, true);
});

test("a spoofed capture never reaches the payment path", () => {
  const result = match({ liveness: { ...live, replayed: true } });
  assert.equal(result.matched, false);
  assert.equal(result.reason, "liveness-failed");
});

test("lockout blocks even a correct capture", () => {
  const result = match({ lockedUntil: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(result.matched, false);
  assert.equal(result.reason, "locked-out");
});

test("missing biometric state is handled explicitly", () => {
  assert.equal(match({ sealedTemplate: null }).reason, "no-template");
  assert.equal(match({ liveSample: null }).reason, "malformed");
  assert.equal(match({ liveSample: [1, 2, 3] }).reason, "malformed");
});

test("templates are deterministic and hashed", () => {
  assert.deepEqual(template, synthesiseTemplate(SEED, "right-index"));
  assert.notDeepEqual(template, synthesiseTemplate(SEED, "left-thumb"));
  assert.equal(templateHash(template), templateHash(synthesiseTemplate(SEED, "right-index")));
  assert.equal(template.length, 128);
});

test("cosine similarity is bounded and symmetric", () => {
  const a = synthesiseTemplate(SEED, "a");
  const b = synthesiseTemplate(SEED, "b");
  assert.ok(Math.abs(cosine(a, a) - 1) < 1e-9);
  assert.ok(Math.abs(cosine(a, b) - cosine(b, a)) < 1e-12);
  assert.ok(Math.abs(cosine(a, b)) < 0.35);
});

test("confidence mapping is monotonic", () => {
  assert.ok(confidenceFromScore(0.99) > confidenceFromScore(0.9));
  assert.equal(confidenceFromScore(0.1), 0);
  assert.equal(confidenceFromScore(1), 1);
});
