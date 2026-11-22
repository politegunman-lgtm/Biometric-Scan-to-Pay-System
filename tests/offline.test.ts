import test from "node:test";
import assert from "node:assert/strict";
import {
  createDeviceKeyPair,
  seal,
  open,
  hashPin,
  verifyPin,
  signEd25519,
  verifyEd25519,
  signMerchantRequest,
  verifyMerchantRequest,
} from "../src/lib/crypto";
import { buildSmsToken, checkVoucher, createVoucher, verifyVoucher, VOUCHER_TTL_MS } from "../src/lib/offline";
import type { QueuedVoucher } from "../src/lib/types";

const device = createDeviceKeyPair();
const smsSecret = "test-sms-secret-0123456789";
const issuer = { id: "mer_test", code: "TEST1", name: "Test Merchant" };

function makeVoucher(over: Partial<Parameters<typeof createVoucher>[0]> = {}): QueuedVoucher {
  const v = createVoucher({
    txn: { id: "txn_test_1" },
    userId: "usr_1",
    deviceId: "dev_1",
    counter: 1,
    amountXAF: 3_500,
    merchant: issuer,
    merchantRef: "QR-ABCDEF",
    channel: "offline-qr",
    authScore: 0.972,
    livenessPassed: true,
    riskScore: 12,
    issuedAt: new Date(),
    privateKeyPem: device.privateKeyPem,
    smsSecret,
    ...over,
  });
  return { ...v, status: "queued", attempts: 0 };
}

const ctx = (over: Partial<Parameters<typeof checkVoucher>[1]> = {}) => ({
  now: new Date(),
  publicKeyPem: device.publicKeyPem,
  deviceTrusted: true,
  merchantExists: true,
  walletBalanceXAF: 100_000,
  perTxnCapXAF: 10_000,
  dailyCapXAF: 25_000,
  offlineSpentTodayXAF: 0,
  usedCounters: [] as number[],
  highestSeenCounter: 0,
  existingTxnIds: [] as string[],
  ...over,
});

test("a signed voucher verifies against the device key", () => {
  const v = makeVoucher();
  assert.equal(verifyVoucher(v, device.publicKeyPem), true);
});

test("tampering with the amount breaks the signature", () => {
  const v = makeVoucher();
  const tampered = { ...v, amountXAF: 1_500 };
  assert.equal(verifyVoucher(tampered, device.publicKeyPem), false);
  const check = checkVoucher(tampered, ctx());
  assert.equal(check.ok, false);
  assert.equal(check.reason, "bad-signature");
});

test("a voucher signed by another key does not verify", () => {
  const attacker = createDeviceKeyPair();
  const v = makeVoucher({ privateKeyPem: attacker.privateKeyPem });
  assert.equal(verifyVoucher(v, device.publicKeyPem), false);
  assert.equal(checkVoucher(v, ctx()).reason, "bad-signature");
});

test("replaying a consumed counter is rejected", () => {
  const v = makeVoucher({ counter: 7 });
  const check = checkVoucher(v, ctx({ usedCounters: [7], highestSeenCounter: 7 }));
  assert.equal(check.ok, false);
  assert.equal(check.reason, "replay");
});

test("counter far beyond the device window is rejected", () => {
  const v = makeVoucher({ counter: 500 });
  assert.equal(checkVoucher(v, ctx({ highestSeenCounter: 1 })).reason, "counter-future");
});

test("revoked devices cannot settle", () => {
  const v = makeVoucher();
  assert.equal(checkVoucher(v, ctx({ deviceTrusted: false })).reason, "device-revoked");
});

test("expired vouchers are rejected", () => {
  const issuedAt = new Date(Date.now() - VOUCHER_TTL_MS - 60_000);
  const v = makeVoucher({ issuedAt });
  assert.equal(checkVoucher(v, ctx()).reason, "expired");
});

test("caps and balance are enforced at settlement", () => {
  const v = makeVoucher({ amountXAF: 12_000 });
  assert.equal(checkVoucher(v, ctx()).reason, "cap-exceeded");

  const daily = makeVoucher({ amountXAF: 9_000, counter: 2 });
  assert.equal(checkVoucher(daily, ctx({ offlineSpentTodayXAF: 20_000 })).reason, "daily-cap");

  const poor = makeVoucher({ amountXAF: 5_000, counter: 3 });
  assert.equal(checkVoucher(poor, ctx({ walletBalanceXAF: 1_000 })).reason, "insufficient-funds");
});

test("SMS fallback token fits one 160-char segment and stays under its cap", () => {
  const v = makeVoucher({ channel: "offline-sms", amountXAF: 2_000 });
  assert.ok(v.smsToken.length <= 160, `token length ${v.smsToken.length}`);
  assert.match(v.smsToken, /^BSP1\.\d+\.2000\.TEST1\.[0-9A-Z]+\.[0-9A-F]{16}$/);
  assert.equal(checkVoucher(v, ctx()).ok, true);

  const large = makeVoucher({ channel: "offline-sms", amountXAF: 12_000, counter: 4 });
  assert.equal(checkVoucher(large, ctx()).reason, "cap-exceeded");
});

test("unknown merchants cannot settle", () => {
  const v = makeVoucher();
  assert.equal(checkVoucher(v, ctx({ merchantExists: false })).reason, "unknown-merchant");
});

test("SMS token is deterministic for the same payload", () => {
  const at = new Date("2026-11-22T10:00:00.000Z");
  const payload = {
    v: 1 as const,
    txnId: "txn_x",
    userId: "usr_1",
    deviceId: "dev_1",
    counter: 3,
    amountXAF: 1500,
    currency: "XAF" as const,
    merchantId: "mer_test",
    merchantCode: "TEST1",
    merchantName: "Test Merchant",
    merchantRef: "QR-1",
    issuedAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + VOUCHER_TTL_MS).toISOString(),
    channel: "offline-sms" as const,
    authScore: 0.97,
    livenessPassed: true,
    riskScore: 4,
  };
  assert.equal(buildSmsToken(payload, smsSecret), buildSmsToken(payload, smsSecret));
  assert.notEqual(buildSmsToken(payload, smsSecret), buildSmsToken(payload, "another-secret"));
});

test("envelope encryption binds ciphertext to its AAD", () => {
  const sealed = seal(JSON.stringify([0.1, 0.2]), "finger:usr_1:right-index");
  assert.equal(open(sealed, "finger:usr_1:right-index"), JSON.stringify([0.1, 0.2]));
  assert.throws(() => open(sealed, "finger:usr_1:left-thumb"));
});

test("PIN hashing uses a salted scrypt digest", () => {
  const { salt, hash } = hashPin("2580");
  assert.equal(verifyPin("2580", salt, hash), true);
  assert.equal(verifyPin("2581", salt, hash), false);
  const other = hashPin("2580");
  assert.notEqual(other.salt, salt);
  assert.notEqual(other.hash, hash);
});

test("merchant QR requests are signed and tamper-evident", () => {
  const payload = {
    id: "req_1",
    merchantId: "mer_test",
    amountXAF: 3500,
    nonce: "abcdef1234567890",
    exp: 1_900_000_000_000,
  };
  const sig = signMerchantRequest(payload);
  assert.equal(verifyMerchantRequest(payload, sig), true);
  assert.equal(verifyMerchantRequest({ ...payload, amountXAF: 350_000 }, sig), false);
  assert.equal(verifyMerchantRequest({ ...payload, merchantId: "mer_other" }, sig), false);
});

test("Ed25519 signatures detect payload edits", () => {
  const sig = signEd25519(device.privateKeyPem, "amount=3500");
  assert.equal(verifyEd25519(device.publicKeyPem, "amount=3500", sig), true);
  assert.equal(verifyEd25519(device.publicKeyPem, "amount=3501", sig), false);
});
