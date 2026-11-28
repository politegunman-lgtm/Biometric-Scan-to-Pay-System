/**
 * Simulated capacitive sensor for the mobile demo.
 *
 * The OS biometric prompt is real (`expo-local-authentication`): Android
 * BiometricPrompt / iOS LocalAuthentication decides yes or no and never hands
 * the app a template. Because the demo server still matches 128-dimension
 * vectors, this file derives the same vector the web client derives from the
 * server's `sensorSeed`, so the existing backend works unmodified.
 *
 * In production this module disappears: the sensor returns a signed assertion
 * and the app never sees ridge data at all.
 */

import { sha256Bytes, utf8 } from "./sha256";

export const TEMPLATE_DIM = 128;
export const MATCH_THRESHOLD = 0.86;

function digest(input: string): Uint8Array {
  return sha256Bytes(utf8(input));
}

function expand(bytes: Uint8Array, dims: number): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let s0 = view.getUint32(0, true) || 1;
  let s1 = view.getUint32(4, true) || 2;
  let s2 = view.getUint32(8, true) || 3;
  let s3 = view.getUint32(12, true) || 4;
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

function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function sensorTemplate(seed: string, fingerId: string): number[] {
  const raw = expand(digest(`${seed}::${fingerId}:7`), TEMPLATE_DIM * 2);
  return normalize(raw.slice(0, TEMPLATE_DIM));
}

export interface CaptureOptions {
  seed: string;
  fingerId: string;
  /** 0..1 — how good the contact was. 0.96 reproduces a clean press. */
  quality?: number;
  salt?: number;
}

export function sensorCapture(opts: CaptureOptions): number[] {
  const quality = opts.quality ?? 0.96;
  const salt = opts.salt ?? Math.floor(Math.random() * 1e9);
  const base = sensorTemplate(opts.seed, opts.fingerId);
  const alpha = 0.16 + (1 - Math.min(1, Math.max(0, quality))) * 0.95;
  const sigma = alpha / Math.sqrt(TEMPLATE_DIM);
  const noise = expand(digest(`${opts.seed}::noise::${salt}:11`), TEMPLATE_DIM).map((n) => n * sigma * 1.732);
  return normalize(base.map((v, i) => v + noise[i]));
}

export interface LivenessProof {
  challengeId: string;
  holdMs: number;
  microMotion: number;
  rotationDeg: number;
  replayed: boolean;
}

export function livenessProof(holdMs: number, opts?: { spoof?: boolean }): LivenessProof {
  const spoof = opts?.spoof ?? false;
  return {
    challengeId: `chl_${Math.random().toString(36).slice(2, 12)}`,
    holdMs,
    microMotion: spoof ? 0.02 : 0.28 + Math.random() * 0.35,
    rotationDeg: spoof ? 0.1 : 1.6 + Math.random() * 2.4,
    replayed: spoof,
  };
}
