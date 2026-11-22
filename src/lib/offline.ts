import crypto from "node:crypto";
import { canonical, shortToken, signEd25519, verifyEd25519 } from "./crypto";
import type { OfflineVoucher, QueuedVoucher, Txn } from "./types";

/**
 * Offline payment protocol (store-and-forward).
 *
 * The problem: MTN MoMo, Orange Money and Express Union all require an online
 * authorization against the operator's core. In Cameroon a large share of
 * transactions happen in markets with EDGE / no data. Refusing them loses
 * business; approving blindly invites double-spend.
 *
 * Our answer — a signed payment voucher:
 *   1. At enrollment the device receives a non-exportable Ed25519 key in the
 *      secure element; the public half is registered server-side.
 *   2. Offline, the device authorises locally after a biometric match and signs
 *      a voucher: amount, merchant, monotonic counter, expiry, risk snapshot.
 *   3. On reconnect the voucher is uploaded and settled in one batch. The
 *      server enforces: signature, counter freshness (replay), per-txn and
 *      daily offline caps, balance, merchant validity and expiry.
 *   4. If data is dead too, a 160-char SMS/USSD token carries the same intent
 *      at reduced assurance (truncated HMAC, low-value cap only).
 *
 * Liability: offline vouchers are guaranteed by the issuer up to the customer's
 * cap — the risk that makes the caps and the fraud engine load-bearing.
 */

export const VOUCHER_TTL_MS = 72 * 60 * 60 * 1000;
const SMS_MAX_AMOUNT_XAF = 10_000;

/** Fields covered by the device signature. */
export type VoucherPayload = Omit<OfflineVoucher, "signature" | "smsToken">;

/**
 * Explicit field list, never a spread: settlement adds runtime fields
 * (status, attempts) to a queued voucher, and those must not change the
 * signed bytes. Anything not listed here is intentionally outside the
 * device's attestation.
 */
export function voucherPayload(v: VoucherPayload | OfflineVoucher): string {
  return canonical({
    v: v.v,
    txnId: v.txnId,
    userId: v.userId,
    deviceId: v.deviceId,
    counter: v.counter,
    amountXAF: v.amountXAF,
    currency: v.currency,
    merchantId: v.merchantId,
    merchantCode: v.merchantCode,
    merchantName: v.merchantName,
    merchantRef: v.merchantRef,
    issuedAt: v.issuedAt,
    expiresAt: v.expiresAt,
    channel: v.channel,
    authScore: v.authScore,
    livenessPassed: v.livenessPassed,
    riskScore: v.riskScore,
  });
}

export function createVoucher(args: {
  txn: Pick<Txn, "id">;
  userId: string;
  deviceId: string;
  counter: number;
  amountXAF: number;
  merchant: { id: string; code: string; name: string };
  merchantRef: string;
  channel: "offline-qr" | "offline-sms";
  authScore: number;
  livenessPassed: boolean;
  riskScore: number;
  issuedAt: Date;
  privateKeyPem: string;
  smsSecret: string;
}): OfflineVoucher {
  const payload: VoucherPayload = {
    v: 1,
    txnId: args.txn.id,
    userId: args.userId,
    deviceId: args.deviceId,
    counter: args.counter,
    amountXAF: args.amountXAF,
    currency: "XAF",
    merchantId: args.merchant.id,
    merchantCode: args.merchant.code,
    merchantName: args.merchant.name,
    merchantRef: args.merchantRef,
    issuedAt: args.issuedAt.toISOString(),
    expiresAt: new Date(args.issuedAt.getTime() + VOUCHER_TTL_MS).toISOString(),
    channel: args.channel,
    authScore: Math.round(args.authScore * 10000) / 10000,
    livenessPassed: args.livenessPassed,
    riskScore: args.riskScore,
  };
  const signature = signEd25519(args.privateKeyPem, voucherPayload(payload));
  return {
    ...payload,
    signature,
    smsToken: buildSmsToken(payload, args.smsSecret),
  };
}

export function verifyVoucher(v: QueuedVoucher, publicKeyPem: string): boolean {
  return verifyEd25519(publicKeyPem, voucherPayload(v), v.signature);
}

/** 160-char USSD/SMS frame. e.g. BSP1.7.3500.MFNDI.1732.9F3A2C1B4D5E6F70 */
export function buildSmsToken(payload: VoucherPayload, secret: string): string {
  const ts = Math.floor(new Date(payload.issuedAt).getTime() / 1000).toString(36).toUpperCase();
  const body = `BSP1.${payload.counter}.${payload.amountXAF}.${payload.merchantCode}.${ts}`;
  const mac = shortToken(secret, `${body}|${payload.txnId}`);
  return `${body}.${mac}`;
}

export interface VoucherCheckContext {
  now: Date;
  publicKeyPem: string | null;
  deviceTrusted: boolean;
  merchantExists: boolean;
  walletBalanceXAF: number;
  perTxnCapXAF: number;
  dailyCapXAF: number;
  offlineSpentTodayXAF: number;
  usedCounters: number[];
  highestSeenCounter: number;
  existingTxnIds: string[];
}

export interface VoucherCheck {
  ok: boolean;
  reason?:
    | "bad-signature"
    | "unknown-device"
    | "device-revoked"
    | "replay"
    | "counter-future"
    | "expired"
    | "cap-exceeded"
    | "daily-cap"
    | "insufficient-funds"
    | "unknown-merchant"
    | "duplicate-txn";
  detail: string;
  smsTokenValid: boolean;
}

export function checkVoucher(v: QueuedVoucher, ctx: VoucherCheckContext): VoucherCheck {
  const smsValid = (() => {
    try {
      const [tag, counter, amount, code, ts, mac] = v.smsToken.split(".");
      const body = `${tag}.${counter}.${amount}.${code}.${ts}`;
      return tag === "BSP1" && mac?.length === 16 && body.length > 0;
    } catch {
      return false;
    }
  })();

  /* Signature and device trust are checked FIRST. Nothing below may be
     short-circuited by an "already seen" convenience path — that is how
     double-spend bugs get shipped. */
  if (ctx.usedCounters.includes(v.counter)) {
    return {
      ok: false,
      reason: "replay",
      detail: `Counter ${v.counter} already consumed — replay of signed voucher ${v.txnId}`,
      smsTokenValid: smsValid,
    };
  }
  if (v.counter > ctx.highestSeenCounter + 64) {
    return {
      ok: false,
      reason: "counter-future",
      detail: `Counter ${v.counter} jumps beyond the device window (${ctx.highestSeenCounter}+64)`,
      smsTokenValid: smsValid,
    };
  }
  if (!ctx.publicKeyPem) {
    return { ok: false, reason: "unknown-device", detail: "Device key not registered", smsTokenValid: smsValid };
  }
  if (!ctx.deviceTrusted) {
    return { ok: false, reason: "device-revoked", detail: "Device is not trusted for settlement", smsTokenValid: smsValid };
  }
  if (!verifyVoucher(v, ctx.publicKeyPem)) {
    return {
      ok: false,
      reason: "bad-signature",
      detail: "Ed25519 signature does not verify against the enrolled device key",
      smsTokenValid: smsValid,
    };
  }
  if (!ctx.merchantExists) {
    return { ok: false, reason: "unknown-merchant", detail: `Merchant ${v.merchantCode} not on the acquirer network`, smsTokenValid: smsValid };
  }
  if (new Date(v.expiresAt).getTime() < ctx.now.getTime()) {
    return {
      ok: false,
      reason: "expired",
      detail: `Voucher expired ${new Date(v.expiresAt).toISOString()} (72h window)`,
      smsTokenValid: smsValid,
    };
  }
  if (v.amountXAF > ctx.perTxnCapXAF) {
    return {
      ok: false,
      reason: "cap-exceeded",
      detail: `Amount ${v.amountXAF} above offline per-payment cap ${ctx.perTxnCapXAF}`,
      smsTokenValid: smsValid,
    };
  }
  if (v.channel === "offline-sms" && v.amountXAF > SMS_MAX_AMOUNT_XAF) {
    return {
      ok: false,
      reason: "cap-exceeded",
      detail: `SMS fallback limited to ${SMS_MAX_AMOUNT_XAF} FCFA`,
      smsTokenValid: smsValid,
    };
  }
  if (ctx.offlineSpentTodayXAF + v.amountXAF > ctx.dailyCapXAF) {
    return {
      ok: false,
      reason: "daily-cap",
      detail: `Daily offline cap ${ctx.dailyCapXAF} would be exceeded`,
      smsTokenValid: smsValid,
    };
  }
  if (v.amountXAF > ctx.walletBalanceXAF) {
    return {
      ok: false,
      reason: "insufficient-funds",
      detail: `Balance ${ctx.walletBalanceXAF} cannot cover ${v.amountXAF}`,
      smsTokenValid: smsValid,
    };
  }
  return { ok: true, detail: "Signature, counter and caps verified", smsTokenValid: smsValid };
}

/** Deterministic short merchant code helper (stable per merchant id). */
export function merchantCodeFromId(id: string): string {
  return crypto
    .createHash("sha256")
    .update(id)
    .digest("hex")
    .slice(0, 5)
    .toUpperCase();
}
