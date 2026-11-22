/**
 * End-to-end smoke test against a running dev server.
 *   npx tsx scripts/smoke.mts
 * Exercises enrolment → biometric auth → step-up → offline vouchers →
 * settlement → replay protection → fraud scenarios, and prints a report.
 */
import { synthesiseCapture } from "../src/lib/biometrics";
import { sensorTemplate } from "../src/lib/sensor";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const live = (): { challengeId: string; holdMs: number; microMotion: number; rotationDeg: number } => ({
  challengeId: `chl_${Math.random().toString(36).slice(2, 10)}`,
  holdMs: 1150,
  microMotion: 0.42,
  rotationDeg: 2.8,
});

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return (await res.json()) as T;
}

async function merchantRequest(merchantId: string, amountXAF: number, note = "smoke") {
  const r = await api<any>("/api/merchant", {
    method: "POST",
    body: JSON.stringify({ merchantId, amountXAF, note }),
  });
  if (!r.request) throw new Error(`merchant request failed: ${JSON.stringify(r)}`);
  return r.request;
}

const pay = (body: Record<string, unknown>) =>
  api<any>("/api/pay", { method: "POST", body: JSON.stringify(body) });

async function main() {
  await api("/api/demo", { method: "POST" });
  const demo = await api<any>("/api/demo");
  const seed = demo.sensorSeed;
  const capture = (impostor = false, quality = 0.96) =>
    synthesiseCapture({ seed, fingerId: "right-index", quality, impostor });

  console.log("\n── Biometric authorisation ─────────────────────────────");
  let req = await merchantRequest("mer_mfoundi", 3_500);
  let out = await pay({ requestId: req.id, sample: capture(), liveness: live(), deviceId: "dev_pixel" });
  check("genuine fingerprint settles", out.status === "settled", `${(out.biometric?.score * 100).toFixed(1)}% · ${out.txn?.receiptNo}`);

  req = await merchantRequest("mer_pharma", 4_200);
  out = await pay({ requestId: req.id, sample: capture(true), liveness: live(), deviceId: "dev_pixel" });
  check("impostor fingerprint rejected", out.status === "declined", out.message);

  req = await merchantRequest("mer_pharma", 4_200);
  out = await pay({ requestId: req.id, sample: capture(), liveness: { ...live(), replayed: true } as any, deviceId: "dev_pixel" });
  check("liveness spoof rejected", out.status === "declined" && out.errorCode === "liveness-failed", out.message);

  req = await merchantRequest("mer_pharma", 4_200);
  out = await pay({ requestId: req.id, sample: capture(), liveness: live(), deviceId: "dev_infinix" });
  check("revoked device refused", out.errorCode === "device-untrusted", out.message);

  console.log("\n── Step-up policy ──────────────────────────────────────");
  req = await merchantRequest("mer_mtn_akwa", 75_000);
  out = await pay({ requestId: req.id, sample: capture(), liveness: live(), deviceId: "dev_pixel" });
  check("high value triggers PIN challenge", out.status === "challenged" || out.status === "declined", `${out.status} risk ${out.risk?.score}`);
  if (out.status === "challenged") {
    const wrong = await pay({ requestId: req.id, sample: capture(), liveness: live(), deviceId: "dev_pixel", pin: "0000" });
    check("wrong PIN refused", wrong.status === "declined" && wrong.errorCode === "bad-pin", wrong.message);
    const right = await pay({ requestId: req.id, sample: capture(), liveness: live(), deviceId: "dev_pixel", pin: "2580" });
    check("correct PIN releases payment", right.status === "settled", right.message);
  }

  console.log("\n── Offline vouchers ────────────────────────────────────");
  await api("/api/network", { method: "POST", body: JSON.stringify({ tier: "offline" }) });
  req = await merchantRequest("mer_moto", 2_500);
  out = await pay({ requestId: req.id, sample: capture(), liveness: live(), deviceId: "dev_pixel" });
  check("offline payment queued", out.status === "queued", `${out.voucher?.smsToken}`);
  const token = out.voucher?.smsToken ?? "";
  check("SMS token fits one segment", token.length > 0 && token.length <= 160, `${token.length} chars`);

  req = await merchantRequest("mer_bafou", 900);
  out = await pay({ requestId: req.id, sample: capture(), liveness: live(), deviceId: "dev_pixel" });
  if (out.status === "challenged") {
    out = await pay({ requestId: req.id, sample: capture(), liveness: live(), deviceId: "dev_pixel", pin: "2580" });
  }
  check("second offline voucher queued", out.status === "queued", out.message);

  const offlineSync = await api<any>("/api/sync", { method: "POST", body: JSON.stringify({}) });
  check("sync refused while radio is off", offlineSync.ok === false, offlineSync.message);

  req = await merchantRequest("mer_eneo", 42_000);
  out = await pay({ requestId: req.id, sample: capture(), liveness: live(), deviceId: "dev_pixel" });
  check("offline cap enforced", out.status === "declined", out.message);

  console.log("\n── Settlement & replay ─────────────────────────────────");
  await api("/api/network", { method: "POST", body: JSON.stringify({ tier: "good" }) });
  let sync = await api<any>("/api/sync", { method: "POST", body: JSON.stringify({}) });
  check("queued vouchers settle", sync.settled >= 2, sync.message);

  sync = await api<any>("/api/sync", { method: "POST", body: JSON.stringify({ replay: true }) });
  check("replayed voucher rejected", sync.replay?.detected === true, sync.replay?.detail);

  const after = await api<any>("/api/state");
  const settled = after.txns.filter((t: any) => t.status === "settled" && t.offline).length;
  check("settled offline history visible", settled >= 2, `${settled} offline receipts`);

  console.log("\n── Sensor rotation & enrolment ─────────────────────────");
  const rotatedSeed = `rotated-${Date.now()}`;
  const rotatedTemplate = await sensorTemplate(rotatedSeed, "left-thumb");
  const enrolled = await api<any>("/api/biometric", {
    method: "POST",
    body: JSON.stringify({ action: "enroll", fingerId: "left-thumb", label: "Left thumb", sample: rotatedTemplate, quality: 0.95 }),
  });
  check("template re-bound to a new sensor secret", enrolled.ok === true, enrolled.message);
  req = await merchantRequest("mer_saker", 1_800);
  out = await pay({
    requestId: req.id,
    fingerId: "left-thumb",
    sample: synthesiseCapture({ seed: rotatedSeed, fingerId: "left-thumb", quality: 0.96, impostor: false }),
    liveness: live(),
    deviceId: "dev_pixel",
  });
  check("re-bound template authorises", out.status === "settled" || out.status === "challenged", `${out.status} ${out.message}`);

  console.log("\n── Policy switches ─────────────────────────────────────");
  await api("/api/settings", { method: "POST", body: JSON.stringify({ smsFallback: false }) });
  await api("/api/network", { method: "POST", body: JSON.stringify({ tier: "offline" }) });
  req = await merchantRequest("mer_pharma", 1_200);
  out = await pay({
    requestId: req.id,
    sample: capture(),
    liveness: live(),
    deviceId: "dev_pixel",
    channel: "offline-sms",
    pin: "2580",
  });
  check("SMS fallback can be switched off", out.status === "declined" && out.errorCode === "sms-disabled", out.message);
  await api("/api/settings", { method: "POST", body: JSON.stringify({ smsFallback: true }) });
  await api("/api/network", { method: "POST", body: JSON.stringify({ tier: "good" }) });
  await api("/api/sync", { method: "POST", body: JSON.stringify({}) });

  console.log("\n── Fraud engine ────────────────────────────────────────");
  const scenarios = ["impossible-travel", "velocity-burst", "amount-spike", "stolen-device", "flagged-merchant", "offline-cap"];
  for (const scenario of scenarios) {
    const r = await api<any>("/api/fraud", { method: "POST", body: JSON.stringify({ scenario }) });
    const ok = r.assessment && r.assessment.signals.length > 0;
    check(
      `scenario ${scenario}`,
      ok,
      `${r.assessment?.score} → ${r.assessment?.decision} (${r.assessment?.signals.map((s: any) => s.code).join(", ")})`,
    );
  }

  console.log("\n── Settings & CSV ──────────────────────────────────────");
  const settings = await api<any>("/api/settings", {
    method: "POST",
    body: JSON.stringify({ offlinePerTxnXAF: 12_000, stepUpThresholdXAF: 60_000 }),
  });
  check("settings persisted", settings.settings?.offlinePerTxnXAF === 12_000);
  const csv = await fetch(BASE + "/api/export").then((r) => r.text());
  check("CSV export", csv.startsWith("receipt,created_at"), `${csv.split("\n").length - 1} rows`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
