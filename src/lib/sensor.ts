/**
 * Browser-side simulated capacitive sensor.
 *
 * Mirrors the server matcher's vector space exactly (same SHA-256 expansion and
 * xorshift), so a capture produced here reproduces the characteristics of an
 * enrolled template. In a shipping app this file does not exist: the OEM
 * biometric HAL captures the print and returns a signed assertion; JavaScript
 * never sees ridge data. Kept explicit so the demo is honest about which parts
 * are simulated.
 */

export const TEMPLATE_DIM = 128;
export const MATCH_THRESHOLD = 0.86;

const encoder = new TextEncoder();

async function digestBytes(input: string): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto unavailable");
  const buf = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(input));
  return new Uint8Array(buf);
}

/** Deterministic pseudo-random expansion of `sha256(seed + ":" + salt)`. */
function expand(digest: Uint8Array, dims: number): number[] {
  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
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

async function expandSeed(seed: string, dims: number, salt: number): Promise<number[]> {
  return expand(await digestBytes(`${seed}:${salt}`), dims);
}

/** The enrolled finger: stable for a device secret + finger id. */
export async function sensorTemplate(seed: string, fingerId: string): Promise<number[]> {
  const raw = await expandSeed(`${seed}::${fingerId}`, TEMPLATE_DIM * 2, 7);
  return normalize(raw.slice(0, TEMPLATE_DIM));
}

export interface CaptureOptions {
  seed: string;
  fingerId: string;
  quality: number;
  impostor: boolean;
  salt?: number;
}

/** One sensor capture, with observation noise scaled by finger/sensor quality. */
export async function sensorCapture(opts: CaptureOptions): Promise<number[]> {
  const salt = opts.salt ?? Math.floor(Math.random() * 1e9);
  const base = opts.impostor
    ? normalize(await expandSeed(`${opts.seed}::impostor::${salt}`, TEMPLATE_DIM, 3))
    : await sensorTemplate(opts.seed, opts.fingerId);
  const alpha = 0.16 + (1 - Math.min(1, Math.max(0, opts.quality))) * 0.95;
  const sigma = alpha / Math.sqrt(TEMPLATE_DIM);
  const noise = (await expandSeed(`${opts.seed}::noise::${salt}`, TEMPLATE_DIM, 11)).map(
    (n) => n * sigma * 1.732,
  );
  return normalize(base.map((v, i) => v + noise[i]));
}

export interface LivenessProof {
  challengeId: string;
  holdMs: number;
  microMotion: number;
  rotationDeg: number;
  replayed?: boolean;
}

/** Telemetry a real sensor reports alongside the capture. */
export function sensorLiveness(holdMs: number, spoof: boolean): LivenessProof {
  return {
    challengeId: `chl_${Math.random().toString(36).slice(2, 12)}`,
    holdMs,
    microMotion: spoof ? 0.02 : 0.25 + Math.random() * 0.4,
    rotationDeg: spoof ? 0.1 : 1.5 + Math.random() * 3,
    replayed: spoof,
  };
}

const SEED_KEY = "bsp.sensorSeed";
const FINGER_KEY = "bsp.fingerSeedId";

export function readLocalSeed(): string | null {
  try {
    return localStorage.getItem(SEED_KEY);
  } catch {
    return null;
  }
}

export function writeLocalSeed(seed: string) {
  try {
    localStorage.setItem(SEED_KEY, seed);
  } catch {
    /* private mode: session-only sensor */
  }
}

export function randomSeed() {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return `local-sensor-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function readFingerId(): string {
  try {
    return localStorage.getItem(FINGER_KEY) ?? "right-index";
  } catch {
    return "right-index";
  }
}
