import test from "node:test";
import assert from "node:assert/strict";
import { buildSeed } from "../src/lib/seed";
import {
  DEFAULT_PORTAL_PIN,
  checkPortalPin,
  issuePortalToken,
  merchantByCode,
  portalCsv,
  portalView,
  readPortalToken,
} from "../src/lib/portal";
import { createPaymentRequest, authorizePayment } from "../src/lib/service";
import { sensorCapture, sensorLiveness } from "../src/lib/sensor";
import type { Database } from "../src/lib/store";

/**
 * Business portal: scoped tokens, reason/cohort filtering and CSV shape.
 * Payments are made through the real authorisation path so the fixtures are
 * the same rows a live school would see.
 */

const freshDb = () => buildSeed() as unknown as Database;

async function pay(
  db: Database,
  input: { merchantId: string; amountXAF: number; reasonId?: string; payerFor?: string; payerDetails?: Record<string, string> },
) {
  const request = createPaymentRequest(db, input);
  const sample = await sensorCapture({ seed: db.secrets.sensorSeed, fingerId: "right-index", quality: 0.96, impostor: false });
  const outcome = await authorizePayment(db, {
    requestId: request.id,
    walletId: db.wallets.find((w) => w.primary)!.id,
    fingerId: "right-index",
    sample,
    liveness: sensorLiveness(1150, false),
    deviceId: db.devices.find((d) => d.trusted)!.id,
    channel: "qr-scan",
    // High-value payments step up to the PIN; the demo PIN is 2580.
    pin: "2580",
  });
  assert.equal(outcome.status, "settled", outcome.message);
  return outcome.txn!;
}

test("a portal token is scoped to one payee and expires", () => {
  const db = freshDb();
  const { token } = issuePortalToken(db, "svc_lycee");
  assert.equal(readPortalToken(db, token), "svc_lycee");
  assert.equal(readPortalToken(db, token.replace("svc_lycee", "svc_uy1")), null, "tampered id rejected");
  assert.equal(readPortalToken(db, `${token}x`), null);
  assert.equal(readPortalToken(db, null), null);
  // 8h later the same token is refused.
  const exp = Number(token.split(".")[1]);
  assert.ok(exp > Date.now() + 7 * 3600_000);
});

test("sign-in needs the right code and PIN", () => {
  const db = freshDb();
  const lycee = merchantByCode(db, "A2DE5");
  assert.ok(lycee, "seeded payee found by code");
  assert.equal(lycee!.id, "svc_lycee");
  assert.equal(checkPortalPin(lycee!, DEFAULT_PORTAL_PIN), true);
  assert.equal(checkPortalPin(lycee!, "0000"), false);
  assert.equal(merchantByCode(db, "nope!"), undefined);
  // Peers cannot use the portal at all.
  const peer = db.merchants.find((m) => m.kind === "person")!;
  assert.equal(merchantByCode(db, peer.code), undefined);
});

test("portal groups fees by reason, class and department", async () => {
  const db = freshDb();
  const lycee = db.merchants.find((m) => m.id === "svc_lycee")!;
  // The seed ships 90 days of history, so assertions are deltas against it.
  const before = portalView(db, lycee, {}).stats;
  await pay(db, {
    merchantId: "svc_lycee",
    amountXAF: 25_000,
    reasonId: "school_fees",
    payerFor: "Marie Claire Ngo",
    payerDetails: { class: "Form 4 B" },
  });
  await pay(db, {
    merchantId: "svc_lycee",
    amountXAF: 12_000,
    reasonId: "library_books",
    payerFor: "Paul Biya Jr",
    payerDetails: { class: "Form 4 B" },
  });
  await pay(db, {
    merchantId: "svc_uy1",
    amountXAF: 120_000,
    reasonId: "tuition",
    payerFor: "Aicha Moussa",
    payerDetails: { faculty: "Science", department: "Computer Science", year: "Year 2" },
  });

  const byReason = portalView(db, lycee, { groupBy: "reason" });
  assert.equal(byReason.stats.received, before.received + 2);
  assert.equal(byReason.stats.volumeXAF, before.volumeXAF + 37_000);
  const labels = byReason.groups.map((g) => g.label);
  assert.ok(labels.includes("School fees") && labels.includes("Library books"));

  const byClass = portalView(db, lycee, { groupBy: "class" });
  const form4 = byClass.groups.find((g) => g.label === "Form 4 B");
  assert.ok(form4, "class cohort exists");
  assert.equal(form4!.count, 2);
  assert.equal(form4!.totalXAF, 37_000);

  // A university sees only its own rows, grouped by department.
  const uni = db.merchants.find((m) => m.id === "svc_uy1")!;
  const uniView = portalView(db, uni, { groupBy: "department" });
  assert.ok(uniView.groups.some((g) => g.label === "Computer Science" && g.totalXAF === 120_000));
  const newest = uniView.payments[0];
  assert.equal(newest.payerDetails?.year, "Year 2");
  assert.equal(newest.payerDetails?.faculty, "Science");
  assert.ok(uniView.facets.faculty.some((f) => f.value === "Science"));
  // Scoping: the school's payments never appear in the university's ledger.
  assert.ok(uniView.payments.every((p) => p.reason !== "Library books"));
});

test("search and filters narrow the ledger, and the CSV mirrors the view", async () => {
  const db = freshDb();
  await pay(db, {
    merchantId: "svc_lycee",
    amountXAF: 25_000,
    reasonId: "school_fees",
    payerFor: "Marie Claire Ngo",
    payerDetails: { class: "Form 4 B" },
  });
  await pay(db, {
    merchantId: "svc_lycee",
    amountXAF: 9_000,
    reasonId: "exam_fees",
    payerFor: "Ibrahim Sali",
    payerDetails: { class: "Form 5 A" },
  });
  const lycee = db.merchants.find((m) => m.id === "svc_lycee")!;

  const marie = portalView(db, lycee, { q: "marie" });
  assert.equal(marie.payments.length, 1);
  assert.equal(marie.payments[0].payerFor, "Marie Claire Ngo");

  const exam = portalView(db, lycee, { reason: "Exam fees" });
  assert.equal(exam.payments.length, 1);
  assert.equal(exam.stats.volumeXAF, 9_000);

  const formA = portalView(db, lycee, { field: "class", value: "Form 5 A" });
  assert.equal(formA.payments.length, 1);

  const none = portalView(db, lycee, { q: "nobody-by-that-name" });
  assert.equal(none.payments.length, 0);

  const csv = portalCsv(exam);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /paid_at,receipt,customer,student,reason,class/);
  assert.match(lines[1], /Ibrahim Sali/);
  assert.match(lines[1], /Exam fees/);
  assert.match(lines[1], /Form 5 A/);
});

test("declined attempts stay out of the payee's books unless asked for", async () => {
  const db = freshDb();
  const lycee = db.merchants.find((m) => m.id === "svc_lycee")!;
  await pay(db, {
    merchantId: "svc_lycee",
    amountXAF: 15_000,
    reasonId: "school_fees",
    payerFor: "Marie Claire Ngo",
    payerDetails: { class: "Form 4 B" },
  });
  // A blocked attempt at the same merchant.
  db.txns.unshift({
    ...db.txns[0],
    id: "txn_declined_fixture",
    status: "declined",
    reason: "School fees",
    payerFor: "Fraudster",
    receiptNo: "BSP-2026-99999",
  });
  const paid = portalView(db, lycee, { status: "paid" });
  assert.ok(paid.payments.every((p) => p.status !== "declined"));
  assert.ok(!paid.payments.some((p) => p.receiptNo === "BSP-2026-99999"));
  const all = portalView(db, lycee, { status: "all" });
  assert.ok(all.payments.some((p) => p.receiptNo === "BSP-2026-99999" && p.status === "declined"));
});
