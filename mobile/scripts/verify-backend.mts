/**
 * Parity check between the Expo client's sensor derivation and the wallet
 * service. It performs the same steps the app performs, without the UI:
 *
 *   GET /api/biometric  -> sensorSeed
 *   POST /api/merchant  -> a signed request
 *   POST /api/pay       -> a capture vector derived by mobile/src/lib/sensor.ts
 *
 * If the server accepts the vector, the RN derivation is identical to the one
 * the web client and the server matcher use.
 *
 * Usage: npm run verify:backend [baseUrl]
 */

import { livenessProof, sensorCapture } from "../src/lib/sensor";

const base = process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000";

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const meta = await json<{ sensorSeed: string }>("/api/biometric");
const state = await json<{ devices: { id: string; trusted: boolean }[]; wallets: { id: string }[] }>("/api/state");
const merchant = await json<{ merchants: { id: string; flagged?: boolean }[] }>("/api/merchant");
const merchantId = (merchant.merchants.find((m) => !m.flagged) ?? merchant.merchants[0]).id;

const minted = await json<{ request: { id: string; amountXAF: number; ref: string } }>("/api/merchant", {
  method: "POST",
  body: JSON.stringify({ merchantId, amountXAF: 1500, note: "expo parity check" }),
});

const sample = sensorCapture({ seed: meta.sensorSeed, fingerId: "right-index", quality: 0.96 });
const outcome = await json<{ status: string; message: string; biometric?: { score: number } }>("/api/pay", {
  method: "POST",
  body: JSON.stringify({
    requestId: minted.request.id,
    amountXAF: minted.request.amountXAF,
    walletId: state.wallets[0]?.id,
    fingerId: "right-index",
    sample,
    liveness: livenessProof(1150),
    deviceId: state.devices.find((d) => d.trusted)?.id ?? "dev_pixel",
    channel: "qr-scan",
  }),
});

const ok = outcome.status === "settled" || outcome.status === "challenged";
console.log(`${ok ? "✓" : "✗"} ${outcome.status} — ${outcome.message}`);
if (outcome.biometric) console.log(`  match score ${(outcome.biometric.score * 100).toFixed(2)}%`);
process.exit(ok ? 0 : 1);
