import crypto from "node:crypto";
import { sha256Hex } from "./crypto";

/**
 * Biometric matching layer.
 *
 * Production reality (what this models):
 *  - Enrollment extracts a non-reversible feature vector inside the OEM
 *    secure enclave (Android BiometricPrompt / StrongBox, iOS Secure Enclave).
 *  - The raw fingerprint image NEVER leaves the sensor. The matcher returns a
 *    signed assertion (match / no-match + score) to the payment app.
 *  - This server-side matcher exists so the demo is inspectable end-to-end:
 *    the sealed template is compared against a normalised live sample, and the
 *    same thresholds/lockout logic would run inside the enclave in production.
 *
 * The vector space is a 128-dimension embedding. A genuine capture is the
 * enrolled template plus bounded observation noise; an impostor capture is an
 * independent vector in the same space. Scores are cosine similarity in [0,1].
 */

export const TEMPLATE_DIM = 128;
export const MATCH_THRESHOLD = 0.86;
/** Below this, we accept the match but require a step-up factor. */
export const LOW_CONFIDENCE_THRESHOLD = 0.9;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60 * 1000;
export const MIN_HOLD_MS = 850;

export function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error("dimension mismatch");
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * Convert a cosine similarity into a 0..1 confidence using the calibrated
 * operating point of the demo matcher: genuine captures sit at 0.90–0.99,
 * impostors at 0.00–0.25. We map the decision band to a readable percentage
 * without touching the decision itself.
 */
export function confidenceFromScore(score: number): number {
  return Math.max(0, Math.min(1, (score - 0.35) / 0.65));
}

export function templateHash(vec: number[]): string {
  return sha256Hex(vec.map((v) => v.toFixed(4)).join(","));
}

export interface LivenessProof {
  challengeId: string;
  holdMs: number;
  /** Variance of sub-dermal micro-motion captured during the press. */
  microMotion: number;
  rotationDeg: number;
  replayed?: boolean;
}

export interface MatchResult {
  matched: boolean;
  score: number;
  livenessPassed: boolean;
  lowConfidence: boolean;
  reason:
    | "ok"
    | "below-threshold"
    | "liveness-failed"
    | "locked-out"
    | "no-template"
    | "malformed";
  detail: string;
}

export function evaluateLiveness(proof: LivenessProof | undefined, enabled: boolean) {
  if (!enabled) return { passed: true, detail: "Liveness check disabled by user setting" };
  if (!proof) return { passed: false, detail: "No liveness telemetry supplied" };
  if (proof.replayed) {
    return { passed: false, detail: "Replay artefact: static ridge pattern, zero micro-motion" };
  }
  if (proof.holdMs < MIN_HOLD_MS) {
    return { passed: false, detail: `Press too short (${proof.holdMs}ms < ${MIN_HOLD_MS}ms)` };
  }
  if (proof.microMotion < 0.15) {
    return { passed: false, detail: "No sub-dermal pulse detected — possible spoof" };
  }
  if (proof.rotationDeg < 0.4) {
    return { passed: false, detail: "Sensor contact flat — capacitive depth check failed" };
  }
  return { passed: true, detail: "Live tissue confirmed (pulse + micro-motion + depth)" };
}

export function matchBiometric(args: {
  sealedTemplate: string | null;
  liveSample: number[] | null;
  liveness: LivenessProof | undefined;
  livenessEnabled: boolean;
  threshold: number;
  lockedUntil: string | null;
  now?: Date;
}): MatchResult {
  const now = args.now ?? new Date();
  if (args.lockedUntil && new Date(args.lockedUntil).getTime() > now.getTime()) {
    return {
      matched: false,
      score: 0,
      livenessPassed: false,
      lowConfidence: false,
      reason: "locked-out",
      detail: "Matcher locked after repeated failures. Try again after the cool-down.",
    };
  }
  if (!args.sealedTemplate) {
    return {
      matched: false,
      score: 0,
      livenessPassed: false,
      lowConfidence: false,
      reason: "no-template",
      detail: "No enrolled biometric template for this account",
    };
  }
  if (!args.liveSample || args.liveSample.length !== TEMPLATE_DIM) {
    return {
      matched: false,
      score: 0,
      livenessPassed: false,
      lowConfidence: false,
      reason: "malformed",
      detail: "Sensor returned a malformed capture",
    };
  }

  const liveness = evaluateLiveness(args.liveness, args.livenessEnabled);
  const score = cosine(JSON.parse(args.sealedTemplate) as number[], args.liveSample);
  const passed = score >= args.threshold;

  if (!liveness.passed) {
    return {
      matched: false,
      score,
      livenessPassed: false,
      lowConfidence: false,
      reason: "liveness-failed",
      detail: liveness.detail,
    };
  }
  if (!passed) {
    return {
      matched: false,
      score,
      livenessPassed: true,
      lowConfidence: false,
      reason: "below-threshold",
      detail: `Similarity ${(score * 100).toFixed(1)}% below ${(args.threshold * 100).toFixed(1)}% threshold`,
    };
  }
  return {
    matched: true,
    score,
    livenessPassed: true,
    lowConfidence: score < LOW_CONFIDENCE_THRESHOLD,
    reason: "ok",
    detail:
      score < LOW_CONFIDENCE_THRESHOLD
        ? `Weak but valid match (${(score * 100).toFixed(1)}%) — step-up required`
        : `Strong match (${(score * 100).toFixed(1)}%)`,
  };
}

/* ------------------------------------------------------------------ *
 * Simulated sensor — deterministic capture generation
 * ------------------------------------------------------------------ */

/** Deterministic pseudo-random expansion of a seed (xorshift128 seeded by SHA-256). */
function expandSeed(seed: string, dims: number, salt: number): number[] {
  const digest = crypto.createHash("sha256").update(`${seed}:${salt}`).digest();
  let s0 = digest.readUInt32LE(0) || 1;
  let s1 = digest.readUInt32LE(4) || 2;
  let s2 = digest.readUInt32LE(8) || 3;
  let s3 = digest.readUInt32LE(12) || 4;
  const out: number[] = [];
  for (let i = 0; i < dims; i++) {
    const t = s0 ^ (s0 << 11);
    s0 = s1;
    s1 = s2;
    s2 = s3;
    s3 = s3 ^ (s3 >>> 19) ^ t ^ (t >>> 8);
    out.push(((s3 >>> 0) / 0xffffffff) * 2 - 1);
  }
  return out;
}

/** The enrolled "finger": stable for a given device secret + finger id. */
export function synthesiseTemplate(seed: string, fingerId: string): number[] {
  const raw = expandSeed(`${seed}::${fingerId}`, TEMPLATE_DIM * 2, 7);
  // Box-Muller-ish shaped values are unnecessary; a unit-normalised projection
  // keeps genuine captures in a tight angular neighbourhood.
  return normalize(raw.slice(0, TEMPLATE_DIM));
}

/**
 * A single capture. `quality` (0..1) models dry fingers, partial contact and
 * sensor smudging — the dominant real-world cause of false rejects in Africa's
 * dusty / high-humidity deployment contexts. `impostor` models a different
 * finger presented to the sensor.
 */
export function synthesiseCapture(args: {
  seed: string;
  fingerId: string;
  quality: number;
  impostor: boolean;
  salt?: number;
}): number[] {
  const salt = args.salt ?? Math.floor(Math.random() * 1e9);
  const base = args.impostor
    ? normalize(expandSeed(`${args.seed}::impostor::${salt}`, TEMPLATE_DIM, 3))
    : synthesiseTemplate(args.seed, args.fingerId);
  // Total angular perturbation α, independent of dimensionality.
  const alpha = 0.16 + (1 - Math.min(1, Math.max(0, args.quality))) * 0.95;
  const sigma = alpha / Math.sqrt(TEMPLATE_DIM);
  const noise = expandSeed(`${args.seed}::noise::${salt}`, TEMPLATE_DIM, 11).map(
    (n) => n * sigma * 1.732, // uniform(-1,1) → unit variance scaling
  );
  return normalize(base.map((v, i) => v + noise[i]));
}
