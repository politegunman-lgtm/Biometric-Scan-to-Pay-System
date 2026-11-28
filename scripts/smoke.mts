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

  console.log("\n── Merchant deep link ──────────────────────────────────");
  const linked = await api<any>("/api/merchant", {
    method: "POST",
    body: JSON.stringify({ merchantId: "mer_mfoundi", amountXAF: 2_400, note: "phone link" }),
  });
  const phoneUrl: string = linked.phoneUrl ?? "";
  check(
    "merchant request exposes a phone deep link",
    phoneUrl.includes(`/scan?req=${linked.request?.id ?? "?"}`) && phoneUrl.startsWith("http"),
    phoneUrl,
  );
  check("deep link page responds", (await fetch(`${BASE}/scan?req=${linked.request?.id}`)).status === 200, "GET /scan?req=");

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

  console.log("\n── Enrolment, codes and the business portal ────────────");
  const vocab = await api<any>("/api/enroll");
  check("three school levels offered", vocab.levels?.length === 3, vocab.levels?.map((l: any) => l.id).join(", "));

  const missingLevel = await api<any>("/api/enroll", {
    method: "POST",
    body: JSON.stringify({ name: `Smoke School ${Date.now() % 100000}`, type: "school", phone: "690112233", pin: "8642" }),
  });
  check("a school must pick its level", Boolean(missingLevel.error), missingLevel.error);

  const stamp = Date.now() % 1000000;
  const enrolledSchool = await api<any>("/api/enroll", {
    method: "POST",
    body: JSON.stringify({
      name: `Smoke University ${stamp}`,
      type: "school",
      schoolLevel: "university",
      city: "Yaoundé",
      phone: `6 9${String(stamp).padStart(7, "0").slice(0, 7)}`,
      pin: "8642",
      pinConfirm: "8642",
    }),
  });
  check(
    "school enrols with its own PIN",
    Boolean(enrolledSchool.merchant?.code),
    enrolledSchool.error ?? enrolledSchool.merchant?.code,
  );
  const code = String(enrolledSchool.merchant?.code ?? "");
  check("code is 5 characters, system-issued", /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(code), code);
  check(
    "university level recorded",
    enrolledSchool.merchant?.schoolLevel === "university",
    enrolledSchool.merchant?.schoolLevel,
  );

  const wrongPin = await api<any>("/api/business", {
    method: "POST",
    body: JSON.stringify({ code, pin: "2468" }),
  });
  check("the demo PIN does not open an enrolled payee", Boolean(wrongPin.error), wrongPin.error);

  const session = await api<any>("/api/business", {
    method: "POST",
    body: JSON.stringify({ code, pin: "8642" }),
  });
  check("business signs in with its chosen PIN", Boolean(session.token), session.payee?.name);
  const view = await api<any>("/api/business", {
    method: "POST",
    body: JSON.stringify({ action: "data", token: session.token, filters: { groupBy: "faculty" } }),
  });
  check(
    "portal shows only that payee, empty and scoped",
    view.stats?.received === 0 && view.payee?.code === code,
    `${view.payee?.name} · ${view.reasons?.length ?? 0} reasons`,
  );
  const portalCsv = await fetch(`${BASE}/api/business/export?token=${encodeURIComponent(session.token)}`).then((r) => r.text());
  check("portal CSV header", portalCsv.startsWith("paid_at,receipt,customer,student,reason"), `${portalCsv.split("\n").length - 1} rows`);

  const published = await api<any>("/api/business", {
    method: "POST",
    body: JSON.stringify({
      action: "settings",
      token: session.token,
      patch: {
        tagline: "Smoke test faculty lists",
        cohorts: {
          faculties: [{ name: "Faculty of Science", departments: ["Computer Science", "Mathematics"] }],
          years: ["Year 1", "Year 2"],
        },
      },
    }),
  });
  check(
    "portal publishes faculty and department lists",
    published.profile?.cohorts?.faculties?.[0]?.departments?.length === 2,
    published.error ?? published.message,
  );

  const unknownFaculty = await api<any>("/api/merchant", {
    method: "POST",
    body: JSON.stringify({
      merchantId: enrolledSchool.merchant.id,
      amountXAF: 5_000,
      reasonId: "tuition",
      payerFor: "Smoke Student",
      payerDetails: { faculty: "Faculty of Magic", department: "Wizardry", year: "Year 1" },
    }),
  });
  check("a value outside the published list is refused", /choose a faculty from the list/i.test(String(unknownFaculty.error)), unknownFaculty.error);

  const listedFaculty = await api<any>("/api/merchant", {
    method: "POST",
    body: JSON.stringify({
      merchantId: enrolledSchool.merchant.id,
      amountXAF: 5_000,
      reasonId: "tuition",
      payerFor: "Smoke Student",
      payerDetails: { faculty: "faculty of science", department: "computer science", year: "year 2" },
    }),
  });
  check(
    "a listed faculty is accepted and canonicalised",
    listedFaculty.request?.payerDetails?.faculty === "Faculty of Science",
    listedFaculty.error ?? JSON.stringify(listedFaculty.request?.payerDetails ?? {}),
  );

  const closed = await api<any>("/api/business", {
    method: "POST",
    body: JSON.stringify({ action: "close", token: session.token }),
  });
  const payClosed = await api<any>("/api/merchant", {
    method: "POST",
    body: JSON.stringify({ merchantId: enrolledSchool.merchant.id, amountXAF: 5_000 }),
  });
  check(
    "a closed business takes no payments",
    Boolean(closed.profile?.closedAt) && /closed its listing/i.test(String(payClosed.error)),
    payClosed.error,
  );
  const reopened = await api<any>("/api/business", {
    method: "POST",
    body: JSON.stringify({ action: "reopen", token: session.token }),
  });
  check("a business can reopen", reopened.profile?.closedAt === null, reopened.error ?? reopened.message);

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
