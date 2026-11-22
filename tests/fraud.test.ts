import test from "node:test";
import assert from "node:assert/strict";
import { assessRisk, decisionFor, deriveBaseline, levelFor } from "../src/lib/fraud";
import type { Merchant, RiskInput, Txn } from "../src/lib/types";

const YAOUNDE = { lat: 3.848, lng: 11.502, city: "Yaoundé" };
const GAROUA = { lat: 9.3017, lng: 13.3921, city: "Garoua" };

const merchant = (over: Partial<Merchant> = {}): Merchant => ({
  id: "mer_test",
  code: "TEST1",
  name: "Test Merchant",
  category: "groceries",
  msisdn: "+237600000000",
  geo: YAOUNDE,
  riskScore: 12,
  flagged: false,
  logoHue: 42,
  verified: true,
  ...over,
});

function txn(over: Partial<Txn> = {}): Txn {
  return {
    id: `txn_${Math.random().toString(36).slice(2)}`,
    ref: "REF",
    receiptNo: "BSP-2026-00001",
    merchantId: "mer_test",
    merchantName: "Test Merchant",
    merchantCode: "TEST1",
    category: "groceries",
    amountXAF: 5_000,
    feeXAF: 0,
    currency: "XAF",
    status: "settled",
    channel: "qr-scan",
    provider: "mtn-momo",
    walletId: "wal_momo",
    auth: {
      method: "biometric",
      matchScore: 0.96,
      livenessPassed: true,
      fingerLabel: "Right index",
      deviceId: "dev_pixel",
      challengeId: "chl",
      holdMs: 1100,
      stepUp: false,
    },
    risk: { score: 0, level: "low", decision: "allow", signals: [], summary: "", recommendedAction: "", evaluatedInMs: 0 },
    geo: YAOUNDE,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    settledAt: new Date(Date.now() - 3_600_000).toISOString(),
    syncedAt: null,
    syncAttempts: 1,
    offline: false,
    deviceLabel: "Pixel 8 Pro",
    cloudSynced: true,
    loyaltyPoints: 10,
    ...over,
  };
}

const baseline = (over: Partial<RiskInput["baseline"]> = {}): RiskInput["baseline"] => ({
  avgTicketXAF: 9_000,
  ticketStdDevXAF: 6_000,
  usualHours: [8, 9, 12, 13, 17, 18, 19, 20],
  homeGeo: { ...YAOUNDE, city: "Yaoundé" },
  knownMerchants: ["mer_test"],
  scoreBaseline: 0.954,
  ...over,
});

function input(over: Partial<RiskInput> = {}): RiskInput {
  const base: RiskInput = {
    amountXAF: 3_500,
    merchant: merchant(),
    geo: { ...YAOUNDE },
    brandNewDevice: false,
    authScore: 0.965,
    livenessPassed: true,
    offline: false,
    channel: "qr-scan",
    occurredAt: new Date(2026, 10, 20, 13, 0, 0),
    offlinePerTxnXAF: 10_000,
    offlineDailyXAF: 25_000,
    offlineSpentTodayXAF: 0,
    recentTxns: [txn({ createdAt: new Date(2026, 10, 20, 9, 0, 0).toISOString() })],
    baseline: baseline(),
  };
  return { ...base, ...over };
}

test("normal payment releases without friction", () => {
  const risk = assessRisk(input());
  assert.equal(risk.decision, "allow");
  assert.ok(risk.score < 30, `score ${risk.score}`);
});

test("impossible travel is blocked", () => {
  const risk = assessRisk(
    input({
      geo: GAROUA,
      merchant: merchant({ id: "mer_far", name: "Garoua Shop" }),
      recentTxns: [
        txn({
          createdAt: new Date(2026, 10, 20, 12, 48, 0).toISOString(),
          geo: { lat: 4.0511, lng: 9.7679, city: "Douala" },
        }),
      ],
    }),
  );
  assert.ok(risk.signals.some((s) => s.code === "IMPOSSIBLE_TRAVEL"));
  assert.equal(risk.decision, "block");
  assert.ok(risk.score >= 65);
});

test("velocity burst escalates to step-up", () => {
  const now = new Date(2026, 10, 20, 13, 0, 0).getTime();
  const recentTxns = Array.from({ length: 5 }, (_, i) =>
    txn({ createdAt: new Date(now - (i + 1) * 60_000).toISOString() }),
  );
  const risk = assessRisk(input({ recentTxns, occurredAt: new Date(now) }));
  assert.ok(risk.signals.some((s) => s.code === "VELOCITY_10M_HIGH"));
  assert.ok(risk.score >= 30, `score ${risk.score}`);
});

test("offline voucher above the cap is blocked", () => {
  const risk = assessRisk(
    input({ offline: true, channel: "offline-qr", amountXAF: 42_000, merchant: merchant({ id: "mer_eneo", category: "utilities" }) }),
  );
  assert.ok(risk.signals.some((s) => s.code === "OFFLINE_CAP"));
  assert.equal(risk.decision, "block");
});

test("offline payment inside the cap is allowed but monitored", () => {
  const risk = assessRisk(input({ offline: true, channel: "offline-qr", amountXAF: 2_500 }));
  assert.equal(risk.decision, "allow");
  assert.ok(risk.signals.some((s) => s.code === "OFFLINE_UNVERIFIED"));
});

test("impossible amount for merchant category fires", () => {
  const risk = assessRisk(
    input({
      amountXAF: 285_000,
      merchant: merchant({ id: "mer_pharma", category: "health", name: "Pharmacy" }),
      recentTxns: [txn()],
    }),
  );
  assert.ok(risk.signals.some((s) => s.code === "CATEGORY_ANOMALY"));
  assert.ok(risk.score >= 30);
});

test("flagged merchant cannot pass on a clean biometric alone", () => {
  const risk = assessRisk(
    input({
      amountXAF: 45_000,
      merchant: merchant({ id: "mer_bad", flagged: true, riskScore: 88, name: "Flagged" }),
      recentTxns: [],
    }),
  );
  assert.ok(risk.signals.some((s) => s.code === "MERCHANT_FLAGGED"));
  assert.equal(risk.decision, "block");
});

test("liveness failure dominates the score", () => {
  const risk = assessRisk(input({ livenessPassed: false, recentTxns: [] }));
  assert.ok(risk.signals.some((s) => s.code === "LIVENESS_FAIL"));
  assert.equal(risk.decision, "block");
});

test("correlated amount signals are capped, not additive", () => {
  const risk = assessRisk(
    input({
      amountXAF: 900_000,
      merchant: merchant({ category: "health" }),
      recentTxns: [],
      baseline: baseline({ avgTicketXAF: 2_000, ticketStdDevXAF: 800 }),
    }),
  );
  const amountSignals = risk.signals.filter((s) => s.category === "amount");
  const rawAmount = amountSignals.reduce((s, x) => s + x.weight, 0);
  assert.ok(rawAmount > 42, "test expects the raw amount weight to exceed the cap");
  assert.ok(risk.score <= 60, `score should stay compressed, got ${risk.score}`);
});

test("score thresholds map to decisions and levels", () => {
  assert.equal(decisionFor(0), "allow");
  assert.equal(decisionFor(29), "allow");
  assert.equal(decisionFor(30), "challenge");
  assert.equal(decisionFor(64), "challenge");
  assert.equal(decisionFor(65), "block");
  assert.equal(levelFor(10), "low");
  assert.equal(levelFor(35), "elevated");
  assert.equal(levelFor(55), "high");
  assert.equal(levelFor(90), "critical");
});

test("baseline learns average ticket and merchant history", () => {
  const b = deriveBaseline(
    [txn({ amountXAF: 2_000 }), txn({ amountXAF: 4_000 }), txn({ amountXAF: 6_000 })],
    YAOUNDE,
  );
  assert.equal(b.avgTicketXAF, 4_000);
  assert.ok(b.knownMerchants.includes("mer_test"));
  assert.equal(b.homeGeo.city, "Yaoundé");
});
