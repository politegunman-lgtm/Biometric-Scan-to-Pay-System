import crypto from "node:crypto";
import {
  hashPin,
  open,
  randomId,
  seal,
  sha256Hex,
  signMerchantRequest,
  verifyMerchantRequest,
  verifyPin,
} from "./crypto";
import {
  MATCH_THRESHOLD,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_MS,
  confidenceFromScore,
  matchBiometric,
  templateHash,
  type LivenessProof,
} from "./biometrics";
import { assessRisk, deriveBaseline, distanceKm } from "./fraud";
import { checkVoucher, createVoucher, type VoucherCheck } from "./offline";
import { ADAPTERS, bindBalanceResolver } from "./providers";
import {
  deviceById,
  markVaultDirty,
  nowIso,
  primaryWallet,
  pushAudit,
  pushSync,
  readDb,
  rollOfflineDay,
  walletById,
  type Database,
} from "./store";
import { computeStats } from "./stats";
import { resolveReason } from "./reasons";
import type { PayerDetails } from "./types";
import { NETWORK_PRESETS, transportFor } from "./transport";
import { money } from "./format";
import type {
  AppState,
  AuthEvidence,
  FraudAlert,
  NetworkTier,
  PaymentChannel,
  PaymentRequest,
  ProviderId,
  QueuedVoucher,
  RiskAssessment,
  RiskSignal,
  Txn,
  UserSettings,
} from "./types";

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export interface PayInput {
  requestId?: string;
  merchantId?: string;
  amountXAF?: number;
  note?: string;
  reasonId?: string;
  payerFor?: string;
  payerDetails?: PayerDetails;
  walletId?: string;
  fingerId?: string;
  sample?: number[];
  liveness?: LivenessProof;
  deviceId?: string;
  channel?: PaymentChannel;
  offline?: boolean;
  pin?: string;
}

export interface PayOutcome {
  status: "settled" | "queued" | "challenged" | "declined" | "error";
  message: string;
  txn?: Txn;
  voucher?: QueuedVoucher;
  risk?: RiskAssessment;
  biometric?: { score: number; confidence: number; liveness: boolean; detail: string; fingerLabel: string };
  attemptsLeft?: number;
  errorCode?: string;
  requires?: "pin";
}

function verifyPinOrFail(db: Database, pin?: string): { ok: boolean; message: string } {
  if (!db.secrets.pin) {
    return { ok: false, message: "No step-up PIN configured. Set one in Security to authorise high-value or high-risk payments." };
  }
  if (!pin) return { ok: false, message: "PIN required" };
  const ok = verifyPin(pin, db.secrets.pin.salt, db.secrets.pin.hash);
  return ok ? { ok: true, message: "PIN verified" } : { ok: false, message: "Incorrect PIN" };
}

function applyPolicy(risk: RiskAssessment, amountXAF: number, settings: UserSettings): RiskAssessment {
  if (risk.decision !== "allow") return risk;
  if (amountXAF < settings.stepUpThresholdXAF) return risk;
  const signal: RiskSignal = {
    code: "POLICY_STEPUP",
    label: "Above your step-up threshold",
    weight: 0,
    detail: `${money(amountXAF)} is at or above the ${money(settings.stepUpThresholdXAF)} step-up threshold you configured`,
    category: "behaviour",
  };
  return {
    ...risk,
    decision: "challenge",
    level: risk.level === "low" ? "elevated" : risk.level,
    signals: [...risk.signals, signal],
    summary: "High-value payment — your policy asks for the MoMo PIN on top of the scan.",
    recommendedAction: "Enter your 4-digit PIN to release the payment.",
  };
}

function riskInputs(db: Database, args: {
  amountXAF: number;
  merchant: Database["merchants"][number];
  geo: { lat: number; lng: number; city: string };
  brandNewDevice?: boolean;
  authScore: number;
  livenessPassed: boolean;
  offline: boolean;
  channel: PaymentChannel;
  at: Date;
  extraRecent?: Txn[];
}) {
  const baseline = deriveBaseline(db.txns, db.user.homeGeo);
  const recent = [...(args.extraRecent ?? []), ...db.txns].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );
  return {
    amountXAF: args.amountXAF,
    merchant: args.merchant,
    geo: args.geo,
    brandNewDevice: args.brandNewDevice ?? false,
    authScore: args.authScore,
    livenessPassed: args.livenessPassed,
    offline: args.offline,
    channel: args.channel,
    occurredAt: args.at,
    offlinePerTxnXAF: db.user.settings.offlinePerTxnXAF,
    offlineDailyXAF: db.user.settings.offlineDailyXAF,
    offlineSpentTodayXAF: rollOfflineDay(db),
    nightGuard: db.user.settings.nightGuard,
    recentTxns: recent,
    baseline: {
      ...baseline,
      scoreBaseline: db.biometric.scoreBaseline || baseline.scoreBaseline,
    },
  };
}

function makeAlert(db: Database, args: {
  txn: Txn;
  title: string;
  detail: string;
  severity: FraudAlert["severity"];
  status: FraudAlert["status"];
}): FraudAlert {
  const alert: FraudAlert = {
    id: randomId("alt"),
    txnId: args.txn.id,
    title: args.title,
    detail: args.detail,
    severity: args.severity,
    signals: args.txn.risk.signals,
    createdAt: nowIso(),
    status: args.status,
    merchantName: args.txn.merchantName,
    amountXAF: args.txn.amountXAF,
    decision: args.txn.risk.decision,
  };
  db.alerts.unshift(alert);
  db.alerts = db.alerts.slice(0, 40);
  return alert;
}

/* ------------------------------------------------------------------ *
 * Payment requests (merchant side)
 * ------------------------------------------------------------------ */

export function createPaymentRequest(
  db: Database,
  input: {
    merchantId: string;
    amountXAF: number;
    note?: string;
    ttlMinutes?: number;
    reasonId?: string;
    payerFor?: string;
    payerDetails?: PayerDetails;
  },
): PaymentRequest {
  const merchant = db.merchants.find((m) => m.id === input.merchantId);
  if (!merchant) throw new Error("Unknown merchant");
  if (merchant.closedAt) throw new Error(`${merchant.name} has closed its listing — payments are paused`);
  const chosen = resolveReason(merchant, input.reasonId, input.payerFor, input.payerDetails);
  const amount = Math.round(input.amountXAF);
  if (!Number.isFinite(amount) || amount < 100 || amount > 2_000_000) {
    throw new Error("Amount must be between 100 and 2,000,000 FCFA");
  }
  const createdAt = new Date();
  const exp = createdAt.getTime() + (input.ttlMinutes ?? 20) * 60_000;
  const nonce = crypto.randomBytes(8).toString("hex");
  const id = randomId("req");
  const request: PaymentRequest = {
    id,
    merchantId: merchant.id,
    merchantName: merchant.name,
    merchantCode: merchant.code,
    category: merchant.category,
    amountXAF: amount,
    ref: `QR-${nonce.slice(0, 6).toUpperCase()}`,
    note: input.note,
    reason: chosen.reason,
    reasonId: chosen.reasonId,
    payerFor: chosen.payerFor,
    payerDetails: chosen.payerDetails,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(exp).toISOString(),
    nonce,
    signature: signMerchantRequest({ id, merchantId: merchant.id, amountXAF: amount, nonce, exp }),
    status: "open",
    channel: "qr-scan",
    geo: merchant.geo,
  };
  db.requests.unshift(request);
  db.requests = db.requests.slice(0, 40);
  return request;
}

/** Keep the "nearby requests" list alive so the demo always has something to scan. */
export function ensureOpenRequests(db: Database): PaymentRequest[] {
  const now = Date.now();
  db.requests.forEach((r) => {
    if (r.status === "open" && new Date(r.expiresAt).getTime() < now) r.status = "expired";
  });
  const open = db.requests.filter((r) => r.status === "open");
  if (open.length >= 2) return open;
  const seeds: [string, number, string][] = [
    ["mer_mfoundi", 3_500, "Weekly market run"],
    ["mer_chezwou", 12_000, "Table 7 · lunch"],
    ["mer_mtn_akwa", 5_000, "Airtime top-up"],
    ["mer_moto", 1_500, "Bastos → Mvan"],
    ["mer_pharma", 6_200, "Prescription refill"],
    ["mer_saker", 2_800, "Breakfast bread"],
    ["mer_eneo", 10_000, "Prepaid meter top-up"],
    ["mer_mokolo", 8_500, "Fabric · 3 yards"],
  ];
  // Rotate the demo queue so a long session does not keep showing the same
  // three counter requests. Avoid duplicating a merchant that already has an
  // open request.
  const offset = db.requests.length % seeds.length;
  for (let n = 0; n < seeds.length; n++) {
    if (db.requests.filter((r) => r.status === "open").length >= 3) break;
    const [mid, amount, note] = seeds[(offset + n) % seeds.length];
    const merchant = db.merchants.find((m) => m.id === mid);
    if (!merchant) continue;
    const duplicate = db.requests.some(
      (r) => r.status === "open" && r.merchantId === mid && r.amountXAF === amount,
    );
    if (duplicate) continue;
    createPaymentRequest(db, { merchantId: merchant.id, amountXAF: amount, note });
  }
  return db.requests.filter((r) => r.status === "open");
}

/* ------------------------------------------------------------------ *
 * Authorization
 * ------------------------------------------------------------------ */

export async function authorizePayment(db: Database, input: PayInput): Promise<PayOutcome> {
  bindBalanceResolver((provider) => walletById(db, db.wallets.find((w) => w.provider === provider)?.id).balanceXAF);

  let merchant = input.merchantId ? db.merchants.find((m) => m.id === input.merchantId) : undefined;
  let amount = input.amountXAF ?? 0;
  let note = input.note;
  let reason: string | undefined;
  let reasonId: string | undefined;
  let payerFor: string | undefined;
  let payerDetails: PayerDetails | undefined;
  let request: PaymentRequest | undefined;
  let channel: PaymentChannel = input.channel ?? "qr-scan";

  if (input.requestId) {
    request = db.requests.find((r) => r.id === input.requestId);
    if (!request) return { status: "error", message: "Payment request not found", errorCode: "request-not-found" };
    const payload = {
      id: request.id,
      merchantId: request.merchantId,
      amountXAF: request.amountXAF,
      nonce: request.nonce,
      exp: new Date(request.expiresAt).getTime(),
    };
    if (!verifyMerchantRequest(payload, request.signature)) {
      return { status: "error", message: "Merchant request signature invalid — QR could be tampered", errorCode: "bad-request-signature" };
    }
    if (request.status !== "open") {
      return { status: "error", message: `Request already ${request.status}`, errorCode: "request-closed" };
    }
    if (new Date(request.expiresAt).getTime() < Date.now()) {
      request.status = "expired";
      return { status: "error", message: "This QR code expired — ask the merchant to refresh it", errorCode: "request-expired" };
    }
    merchant = db.merchants.find((m) => m.id === request!.merchantId);
    amount = request.amountXAF;
    note = note ?? request.note;
    // The reason was chosen and validated when the request was minted; the
    // receipt must carry the same label the payer saw.
    reason = request.reason;
    reasonId = request.reasonId;
    payerFor = request.payerFor;
    payerDetails = request.payerDetails;
    channel = request.channel;
  }

  if (!merchant) return { status: "error", message: "Unknown merchant", errorCode: "unknown-merchant" };
  if (!request && (input.reasonId || input.payerFor)) {
    try {
      const chosen = resolveReason(merchant, input.reasonId, input.payerFor, input.payerDetails);
      reason = chosen.reason;
      reasonId = chosen.reasonId;
      payerFor = chosen.payerFor;
      payerDetails = chosen.payerDetails;
    } catch (err) {
      return { status: "error", message: (err as Error).message, errorCode: "bad-reason" };
    }
  }
  amount = Math.round(amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { status: "error", message: "Invalid amount", errorCode: "bad-amount" };
  }

  const payWallet = input.walletId ? walletById(db, input.walletId) : primaryWallet(db);
  if (payWallet.status !== "active") {
    return { status: "error", message: `${payWallet.providerName} wallet is ${payWallet.status}`, errorCode: "wallet-blocked" };
  }
  if (amount > payWallet.perTxnLimitXAF) {
    return {
      status: "declined",
      message: `Above the ${money(payWallet.perTxnLimitXAF)} per-transaction limit for ${payWallet.providerName}`,
      errorCode: "per-txn-limit",
    };
  }

  /* ---------------- device trust ---------------- */
  const device = deviceById(db, input.deviceId ?? "dev_pixel");
  if (!device || device.status === "revoked" || !device.trusted) {
    pushAudit(db, {
      actor: "risk-engine",
      action: "payment.device_rejected",
      detail: `Payment attempt from ${device?.label ?? "unrecognised device"} — not trusted`,
      severity: "critical",
    }, randomId("aud"));
    return {
      status: "declined",
      message: "This device is not trusted for payments. Pair it from Wallet → Devices first.",
      errorCode: "device-untrusted",
    };
  }
  device.lastSeenAt = nowIso();

  /* ---------------- biometric verification ---------------- */
  const finger = db.biometric.fingers.find((f) => f.id === input.fingerId) ?? db.biometric.fingers[0];
  if (!finger) {
    return { status: "error", message: "No fingerprint enrolled", errorCode: "no-biometric" };
  }
  const livenessEnabled = db.biometric.livenessEnabled && db.user.settings.requireLiveness;
  const match = matchBiometric({
    // The envelope is opened only inside the matcher, never exposed to clients.
    sealedTemplate: open(finger.sealedTemplate, `finger:${db.user.id}:${finger.id}`),
    liveSample: input.sample ?? null,
    liveness: input.liveness,
    livenessEnabled,
    // Strict biometrics raises the operating point; weak captures are refused
    // rather than granted a step-up.
    threshold: (finger.matchThreshold ?? MATCH_THRESHOLD) + (db.user.settings.biometricOnly ? 0.04 : 0),
    lockedUntil: db.biometric.lockedUntil,
  });

  if (match.reason === "locked-out") {
    return { status: "declined", message: match.detail, errorCode: "biometric-locked" };
  }

  if (!match.matched) {
    db.biometric.failedAttempts += 1;
    const attemptsLeft = Math.max(0, MAX_FAILED_ATTEMPTS - db.biometric.failedAttempts);
    if (db.biometric.failedAttempts >= MAX_FAILED_ATTEMPTS) {
      db.biometric.lockedUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();
      pushAudit(db, {
        actor: "device",
        action: "biometric.lockout",
        detail: `${MAX_FAILED_ATTEMPTS} consecutive failures — matcher locked for 5 minutes`,
        severity: "critical",
      }, randomId("aud"));
    }
    pushAudit(db, {
      actor: "device",
      action: "biometric.reject",
      detail: `${finger.label}: ${match.detail}`,
      severity: "warning",
    }, randomId("aud"));
    return {
      status: "declined",
      message: match.reason === "liveness-failed"
        ? `${match.detail}. Payment not authorised.`
        : `Fingerprint not recognised (${(match.score * 100).toFixed(1)}%). ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left.`,
      errorCode: match.reason,
      attemptsLeft,
      biometric: {
        score: match.score,
        confidence: confidenceFromScore(match.score),
        liveness: match.livenessPassed,
        detail: match.detail,
        fingerLabel: finger.label,
      },
    };
  }

  // Genuine match: clear the failure counter and update the personal baseline.
  db.biometric.failedAttempts = 0;
  db.biometric.lockedUntil = null;
  db.biometric.totalAuths += 1;
  db.biometric.lastAuthAt = nowIso();
  db.biometric.scoreBaseline = +(db.biometric.scoreBaseline * 0.92 + match.score * 0.08).toFixed(4);
  finger.lastUsedAt = nowIso();
  finger.useCount += 1;

  const effectiveOffline = input.offline ?? db.network.tier === "offline";
  const offlineChannel: PaymentChannel =
    effectiveOffline && (channel === "offline-sms" || db.network.tier === "offline")
      ? input.channel === "offline-sms"
        ? "offline-sms"
        : "offline-qr"
      : channel;

  const at = new Date();
  const risk = applyPolicy(
    assessRisk(
      riskInputs(db, {
        amountXAF: amount,
        merchant,
        geo: { ...merchant.geo },
        authScore: match.score,
        livenessPassed: match.livenessPassed,
        offline: effectiveOffline,
        channel: offlineChannel,
        at,
      }),
    ),
    amount,
    db.user.settings,
  );

  const auth: AuthEvidence = {
    method: "biometric",
    matchScore: +match.score.toFixed(4),
    livenessPassed: match.livenessPassed,
    fingerLabel: finger.label,
    deviceId: device.id,
    challengeId: input.liveness?.challengeId ?? randomId("chl"),
    holdMs: input.liveness?.holdMs ?? 0,
    stepUp: false,
  };

  const biometric = {
    score: match.score,
    confidence: confidenceFromScore(match.score),
    liveness: match.livenessPassed,
    detail: match.detail,
    fingerLabel: finger.label,
  };

  /* ---------------- block ---------------- */
  if (risk.decision === "block") {
    const txn = finaliseTxn(db, {
      merchant, amount, request, risk, auth, geo: merchant.geo, note,
      reason, reasonId, payerFor, payerDetails,
      channel: offlineChannel, offline: effectiveOffline, wallet: payWallet,
      deviceLabel: device.label, at, status: "declined", id: randomId("txn"),
    });
    makeAlert(db, {
      txn,
      title: `Payment blocked — ${risk.signals[0]?.label ?? "risk threshold"}`,
      detail: risk.signals.map((s) => `${s.label}: ${s.detail}`).join(" · "),
      severity: "critical",
      status: "auto-blocked",
    });
    return { status: "declined", message: risk.summary, txn, risk, biometric };
  }

  /* ---------------- challenge ---------------- */
  if (risk.decision === "challenge") {
    if (!input.pin) {
      return {
        status: "challenged",
        message: risk.summary,
        risk,
        biometric,
        requires: "pin",
        errorCode: "step-up-required",
      };
    }
    const pin = verifyPinOrFail(db, input.pin);
    if (!pin.ok) {
      pushAudit(db, { actor: "device", action: "pin.reject", detail: `Step-up failed: ${pin.message}`, severity: "warning" }, randomId("aud"));
      return {
        status: "declined",
        message: pin.message === "Incorrect PIN" ? "Incorrect PIN — payment not authorised." : pin.message,
        risk,
        biometric,
        errorCode: "bad-pin",
      };
    }
    auth.method = "pin+biometric";
    auth.stepUp = true;
  }

  /* ---------------- offline queue ---------------- */
  if (effectiveOffline) {
    return queueOffline(db, {
      wallet: payWallet, merchant, amount, request, risk, auth, biometric,
      channel: input.channel === "offline-sms" ? "offline-sms" : "offline-qr",
      note, reason, reasonId, payerFor, payerDetails, device, at,
    });
  }

  /* ---------------- online capture ---------------- */
  if (amount > payWallet.balanceXAF) {
    return {
      status: "declined",
      message: `Insufficient balance. ${payWallet.providerName} holds ${money(payWallet.balanceXAF)}.`,
      risk,
      biometric,
      errorCode: "insufficient-funds",
    };
  }

  const txnId = randomId("txn");
  const adapter = ADAPTERS[payWallet.provider as ProviderId] ?? ADAPTERS["mtn-momo"];
  const charge = await adapter.charge({
    msisdn: payWallet.msisdn.replace(/\s/g, ""),
    amountXAF: amount,
    reference: request?.ref ?? `ADH-${txnId.slice(-6).toUpperCase()}`,
    idempotencyKey: txnId,
  });

  if (!charge.ok) {
    return { status: "declined", message: `${payWallet.providerName} declined the charge`, errorCode: "operator-declined", risk, biometric };
  }

  payWallet.balanceXAF = charge.balanceAfterXAF;
  const txn = finaliseTxn(db, {
    merchant, amount, request, risk, auth, geo: merchant.geo, note,
    reason, reasonId, payerFor, payerDetails,
    channel: offlineChannel, offline: false, wallet: payWallet, deviceLabel: device.label,
    at, status: "settled", id: txnId,
  });

  db.vault.lastSyncAt = nowIso();
  markVaultDirty(db);
  pushSync(db, {
    kind: "success",
    message: "Realtime authorization captured",
    detail: `${txn.merchantName} · ${money(amount)} · ${charge.operatorRef}`,
  }, randomId("syn"));
  pushAudit(db, {
    actor: `device:${device.id}`,
    action: "payment.settled",
    detail: `${money(amount)} to ${merchant.name} · biometric ${(match.score * 100).toFixed(1)}% · risk ${risk.score}`,
    severity: "info",
  }, randomId("aud"));

  if (risk.score >= 30) {
    makeAlert(db, {
      txn,
      title: "Unusual payment released",
      detail: risk.summary,
      severity: "warning",
      status: "open",
    });
  }

  return { status: "settled", message: `Paid ${money(amount)} to ${merchant.name}`, txn, risk, biometric };
}

function finaliseTxn(
  db: Database,
  args: {
    merchant: Database["merchants"][number];
    amount: number;
    request?: PaymentRequest;
    risk: RiskAssessment;
    auth: AuthEvidence;
    geo: { lat: number; lng: number; city: string };
    note?: string;
    reason?: string;
    reasonId?: string;
    payerFor?: string;
    payerDetails?: PayerDetails;
    channel: PaymentChannel;
    offline: boolean;
    wallet: Database["wallets"][number];
    deviceLabel: string;
    at: Date;
    status: Txn["status"];
    id: string;
  },
): Txn {
  db.counters.receiptSeq += 1;
  const txn: Txn = {
    id: args.id,
    ref: `REF-${args.id.slice(-8).toUpperCase()}`,
    receiptNo: `BSP-${args.at.getFullYear()}-${String(db.counters.receiptSeq).padStart(5, "0")}`,
    merchantId: args.merchant.id,
    merchantName: args.merchant.name,
    merchantCode: args.merchant.code,
    category: args.merchant.category,
    amountXAF: args.amount,
    feeXAF: 0,
    currency: "XAF",
    status: args.status,
    channel: args.channel,
    provider: args.wallet.provider,
    walletId: args.wallet.id,
    auth: args.auth,
    risk: args.risk,
    geo: args.geo,
    note: args.note,
    reason: args.reason,
    reasonId: args.reasonId,
    payerFor: args.payerFor,
    payerDetails: args.payerDetails,
    // The payee needs to know which customer paid, not just the student name.
    payerName: db.user.fullName,
    createdAt: args.at.toISOString(),
    settledAt: args.status === "settled" ? args.at.toISOString() : null,
    syncedAt: args.status === "settled" ? args.at.toISOString() : null,
    syncAttempts: args.status === "settled" ? 1 : 0,
    offline: args.offline,
    deviceLabel: args.deviceLabel,
    cloudSynced: args.status === "settled",
    loyaltyPoints: Math.floor(args.amount / 500),
  };
  db.txns.unshift(txn);
  if (args.request) {
    args.request.status = "paid";
    args.request.paidTxnId = txn.id;
  }
  return txn;
}

/* ------------------------------------------------------------------ *
 * Offline authorization
 * ------------------------------------------------------------------ */

function queueOffline(
  db: Database,
  args: {
    wallet: Database["wallets"][number];
    merchant: Database["merchants"][number];
    amount: number;
    request?: PaymentRequest;
    risk: RiskAssessment;
    auth: AuthEvidence;
    biometric: PayOutcome["biometric"];
    channel: "offline-qr" | "offline-sms";
    note?: string;
    reason?: string;
    reasonId?: string;
    payerFor?: string;
    payerDetails?: PayerDetails;
    device: Database["devices"][number];
    at: Date;
  },
): PayOutcome {
  const settings = db.user.settings;
  const pendingTotal = db.queue
    .filter((q) => q.status === "queued")
    .reduce((s, q) => s + q.amountXAF, 0);

  if (args.amount > settings.offlinePerTxnXAF) {
    return {
      status: "declined",
      message: `Offline single-payment cap is ${money(settings.offlinePerTxnXAF)}. Reconnect to pay ${money(args.amount)}.`,
      errorCode: "offline-per-txn-cap",
      risk: args.risk,
      biometric: args.biometric,
    };
  }
  if (rollOfflineDay(db) + pendingTotal + args.amount > settings.offlineDailyXAF) {
    return {
      status: "declined",
      message: `That would exceed your ${money(settings.offlineDailyXAF)} daily offline allowance (${money(settings.offlineDailyXAF - rollOfflineDay(db) - pendingTotal)} left).`,
      errorCode: "offline-daily-cap",
      risk: args.risk,
      biometric: args.biometric,
    };
  }
  if (args.wallet.balanceXAF - pendingTotal < args.amount) {
    return {
      status: "declined",
      message: `Not enough unreserved balance in ${args.wallet.providerName} to sign an offline voucher.`,
      errorCode: "insufficient-funds",
      risk: args.risk,
      biometric: args.biometric,
    };
  }
  const key = db.secrets.deviceKeys[args.device.id];
  if (!key) {
    return { status: "error", message: "This device has no secure-element key — cannot sign offline vouchers.", errorCode: "no-device-key" };
  }

  if (args.channel === "offline-sms" && !settings.smsFallback) {
    return {
      status: "declined",
      message: "SMS/USSD fallback is disabled in your protection settings.",
      errorCode: "sms-disabled",
      risk: args.risk,
      biometric: args.biometric,
    };
  }
  const txnId = randomId("txn");
  const counter = (db.secrets.nextCounter[args.device.id] ?? 0) + 1;
  db.secrets.nextCounter[args.device.id] = counter;

  const voucher = createVoucher({
    txn: { id: txnId },
    userId: db.user.id,
    deviceId: args.device.id,
    counter,
    amountXAF: args.amount,
    merchant: { id: args.merchant.id, code: args.merchant.code, name: args.merchant.name },
    merchantRef: args.request?.ref ?? `OFF-${txnId.slice(-6).toUpperCase()}`,
    channel: args.channel,
    authScore: args.auth.matchScore,
    livenessPassed: args.auth.livenessPassed,
    riskScore: args.risk.score,
    issuedAt: args.at,
    privateKeyPem: key.privateKeyPem,
    smsSecret: key.smsSecret,
  });

  const txn = finaliseTxn(db, {
    merchant: args.merchant,
    amount: args.amount,
    request: args.request,
    risk: args.risk,
    auth: args.auth,
    geo: args.merchant.geo,
    note: args.note,
    reason: args.reason,
    reasonId: args.reasonId,
    payerFor: args.payerFor,
    channel: args.channel,
    offline: true,
    wallet: args.wallet,
    deviceLabel: args.device.label,
    at: args.at,
    status: "queued",
    id: txnId,
  });
  txn.voucherToken = voucher.smsToken;

  db.counters.offlineSpentXAF += args.amount;
  const queued: QueuedVoucher = { ...voucher, status: "queued", attempts: 0 };
  db.queue.unshift(queued);
  db.queue = db.queue.slice(0, 60);
  markVaultDirty(db);
  pushSync(db, {
    kind: "queue",
    message: `Voucher signed offline #${counter}`,
    detail: `${txn.merchantName} · ${money(args.amount)} · Ed25519 voucher ready for settlement`,
    vouchers: 1,
  }, randomId("syn"));
  if (args.channel === "offline-sms") {
    pushSync(db, {
      kind: "sms-fallback",
      message: "SMS token prepared for SMSC relay",
      detail: `${voucher.smsToken.length} chars · 1 segment · settle on next network`,
      vouchers: 1,
    }, randomId("syn"));
  }
  pushAudit(db, {
    actor: `device:${args.device.id}`,
    action: "payment.offline_voucher",
    detail: `${money(args.amount)} to ${args.merchant.name} · counter ${counter} · risk ${args.risk.score}`,
    severity: "info",
  }, randomId("aud"));

  return {
    status: "queued",
    message: `Queued ${money(args.amount)} for ${args.merchant.name}. It will settle when you're back online.`,
    txn,
    voucher: queued,
    risk: args.risk,
    biometric: args.biometric,
  };
}

/* ------------------------------------------------------------------ *
 * Offline settlement
 * ------------------------------------------------------------------ */

export interface SyncResult {
  ok: boolean;
  message: string;
  settled: number;
  rejected: { txnId: string; merchantName: string; amountXAF: number; reason: string; detail: string }[];
  remaining: number;
  tier: NetworkTier;
  latencyMs: number;
  replay?: { detected: boolean; detail: string; txnId: string };
}

export async function syncQueue(db: Database, opts: { replay?: boolean } = {}): Promise<SyncResult> {
  const tier = db.network.tier;
  const plan = transportFor(tier);
  const base: SyncResult = {
    ok: true,
    message: "",
    settled: 0,
    rejected: [],
    remaining: 0,
    tier,
    latencyMs: db.network.latencyMs,
  };
  if (!plan.requiresOnline) {
    pushSync(db, {
      kind: "failure",
      message: "Sync attempted with no data",
      detail: "Radio is offline — falling back to SMS/USSD store-and-forward",
    }, randomId("syn"));
    return { ...base, ok: false, message: "No data connection. Vouchers stay queued; SMS fallback remains available.", remaining: db.queue.filter((q) => q.status === "queued").length };
  }

  if (opts.replay) {
    const settledVoucher = db.queue.find((q) => q.status === "settled");
    if (!settledVoucher) {
      return { ...base, ok: true, message: "No previously settled voucher to replay yet — settle one first.", remaining: db.queue.filter((q) => q.status === "queued").length };
    }
    const consumed = db.secrets.consumedCounters[settledVoucher.deviceId] ?? [];
    const check = checkVoucher(settledVoucher, {
      now: new Date(),
      publicKeyPem: db.devices.find((d) => d.id === settledVoucher.deviceId)?.publicKeyPem ?? null,
      deviceTrusted: true,
      merchantExists: true,
      walletBalanceXAF: 1e9,
      perTxnCapXAF: 1e9,
      dailyCapXAF: 1e9,
      offlineSpentTodayXAF: 0,
      usedCounters: consumed,
      highestSeenCounter: Math.max(0, ...consumed),
      existingTxnIds: db.txns.map((t) => t.id),
    });
    pushSync(db, {
      kind: "conflict",
      message: "Replay attempt blocked by settlement server",
      detail: `Voucher ${settledVoucher.txnId} counter ${settledVoucher.counter}: ${check.detail}`,
    }, randomId("syn"));
    pushAudit(db, {
      actor: "settlement-server",
      action: "voucher.replay_blocked",
      detail: check.detail,
      severity: "critical",
    }, randomId("aud"));
    if (!check.ok) {
      const txn = db.txns.find((t) => t.id === settledVoucher.txnId);
      if (txn) {
        makeAlert(db, {
          txn,
          title: "Replay attack rejected",
          detail: check.detail,
          severity: "critical",
          status: "auto-blocked",
        });
      }
    }
    return {
      ...base,
      message: check.ok ? "Voucher re-accepted idempotently (no double charge)" : "Replay detected and rejected. No funds moved.",
      replay: { detected: !check.ok, detail: check.detail, txnId: settledVoucher.txnId },
      remaining: db.queue.filter((q) => q.status === "queued").length,
    };
  }

  const pending = db.queue.filter((q) => q.status === "queued").sort((a, b) => a.counter - b.counter);
  if (pending.length === 0) {
    db.vault.lastSyncAt = nowIso();
    pushSync(db, {
      kind: "success",
      message: "Cloud vault up to date",
      detail: `${plan.batchSize} max per batch · ${plan.compress ? "gzip delta" : "full payload"} · ${db.network.latencyMs} ms`,
    }, randomId("syn"));
    return { ...base, message: "Nothing queued — everything is settled.", remaining: 0 };
  }

  const batch = pending.slice(0, plan.batchSize);
  pushSync(db, {
    kind: "attempt",
    message: `Uploading ${batch.length} voucher${batch.length === 1 ? "" : "s"}`,
    detail: `${plan.label} · batch limit ${plan.batchSize} · ${plan.deltaOnly ? "delta" : "full"}${plan.compress ? " + gzip" : ""}`,
    vouchers: batch.length,
  }, randomId("syn"));

  let settledCount = 0;
  for (const voucher of batch) {
    voucher.status = "syncing";
    voucher.attempts += 1;
    const txn = db.txns.find((t) => t.id === voucher.txnId);
    const wallet = txn ? walletById(db, txn.walletId) : primaryWallet(db);
    const consumed = db.secrets.consumedCounters[voucher.deviceId] ?? [];
    const device = db.devices.find((d) => d.id === voucher.deviceId);
    const issuedDay = voucher.issuedAt.slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const spentToday = issuedDay === today ? Math.max(0, db.counters.offlineSpentXAF - voucher.amountXAF) : 0;

    const check: VoucherCheck = checkVoucher(voucher, {
      now: new Date(),
      publicKeyPem: device?.publicKeyPem ?? null,
      deviceTrusted: Boolean(device?.trusted && device?.status === "active"),
      merchantExists: db.merchants.some((m) => m.id === voucher.merchantId),
      walletBalanceXAF: wallet.balanceXAF,
      perTxnCapXAF: db.user.settings.offlinePerTxnXAF,
      dailyCapXAF: db.user.settings.offlineDailyXAF,
      offlineSpentTodayXAF: spentToday,
      usedCounters: consumed,
      highestSeenCounter: Math.max(0, ...consumed),
      existingTxnIds: db.txns.map((t) => t.id),
    });

    if (!check.ok) {
      voucher.status = "rejected";
      voucher.rejectedReason = check.reason;
      voucher.lastError = check.detail;
      if (txn) {
        txn.status = "declined";
        txn.syncAttempts += 1;
        txn.cloudSynced = false;
        makeAlert(db, {
          txn,
          title: `Offline voucher rejected — ${check.reason}`,
          detail: check.detail,
          severity: "critical",
          status: "auto-blocked",
        });
      }
      base.rejected.push({
        txnId: voucher.txnId,
        merchantName: voucher.merchantName,
        amountXAF: voucher.amountXAF,
        reason: check.reason ?? "rejected",
        detail: check.detail,
      });
      pushSync(db, {
        kind: "failure",
        message: `Voucher rejected (${check.reason})`,
        detail: `${voucher.merchantName} · ${money(voucher.amountXAF)} · ${check.detail}`,
      }, randomId("syn"));
      continue;
    }

    if (voucher.amountXAF > wallet.balanceXAF) {
      voucher.status = "rejected";
      voucher.rejectedReason = "insufficient-funds";
      voucher.lastError = "Wallet balance moved below voucher amount before settlement";
      base.rejected.push({
        txnId: voucher.txnId,
        merchantName: voucher.merchantName,
        amountXAF: voucher.amountXAF,
        reason: "insufficient-funds",
        detail: voucher.lastError,
      });
      if (txn) txn.status = "declined";
      continue;
    }

    const adapter = ADAPTERS[wallet.provider as ProviderId] ?? ADAPTERS["mtn-momo"];
    const charge = await adapter.charge({
      msisdn: wallet.msisdn.replace(/\s/g, ""),
      amountXAF: voucher.amountXAF,
      reference: voucher.merchantRef,
      idempotencyKey: voucher.txnId,
    });
    if (!charge.ok) {
      voucher.status = "rejected";
      voucher.rejectedReason = "operator-declined";
      base.rejected.push({
        txnId: voucher.txnId,
        merchantName: voucher.merchantName,
        amountXAF: voucher.amountXAF,
        reason: "operator-declined",
        detail: "Operator core declined the settlement debit",
      });
      continue;
    }

    wallet.balanceXAF = charge.balanceAfterXAF;
    voucher.status = "settled";
    voucher.syncedAt = nowIso();
    db.secrets.consumedCounters[voucher.deviceId] = [...consumed, voucher.counter];
    if (txn) {
      txn.status = "settled";
      txn.settledAt = nowIso();
      txn.syncedAt = nowIso();
      txn.syncAttempts += 1;
      txn.cloudSynced = true;
    }
    settledCount += 1;
  }

  db.vault.lastSyncAt = nowIso();
  markVaultDirty(db);
  const remaining = db.queue.filter((q) => q.status === "queued").length;
  if (settledCount > 0) {
    pushSync(db, {
      kind: "success",
      message: `${settledCount} voucher${settledCount === 1 ? "" : "s"} settled`,
      detail: `${money(batch.reduce((s, v) => s + v.amountXAF, 0))} cleared · ${plan.compress ? "gzip" : "full"} ${Math.round(JSON.stringify(batch).length / 102.4)} KB · ${db.network.latencyMs} ms`,
      vouchers: settledCount,
    }, randomId("syn"));
    pushAudit(db, {
      actor: "settlement-server",
      action: "voucher.batch_settled",
      detail: `${settledCount} offline vouchers · signatures verified · counters advanced`,
      severity: "info",
    }, randomId("aud"));
  }
  if (remaining > 0 && plan.batchSize < pending.length) {
    pushSync(db, {
      kind: "transport",
      message: `${remaining} voucher${remaining === 1 ? "" : "s"} still queued`,
      detail: `Batch limit ${plan.batchSize} on ${plan.label} — next flush continues`,
    }, randomId("syn"));
  }

  const message = base.rejected.length
    ? `${settledCount} settled, ${base.rejected.length} rejected${remaining ? `, ${remaining} still queued` : ""}.`
    : remaining
      ? `${settledCount} settled. ${remaining} still queued — sync again to flush the rest.`
      : `${settledCount} voucher${settledCount === 1 ? "" : "s"} settled. Everything is online again.`;

  return { ...base, message, settled: settledCount, remaining };
}

/* ------------------------------------------------------------------ *
 * Biometric enrollment / verification
 * ------------------------------------------------------------------ */

export function enrollFinger(
  db: Database,
  input: { fingerId: string; label: string; sample: number[]; quality?: number },
) {
  if (!input.sample || input.sample.length !== 128) throw new Error("Malformed template capture");
  const id = input.fingerId.replace(/[^a-z0-9-]/gi, "").slice(0, 24) || "finger";
  db.biometric.fingers = db.biometric.fingers.filter((f) => f.id !== id);
  db.biometric.fingers.push({
    id,
    label: input.label,
    sealedTemplate: seal(JSON.stringify(input.sample), `finger:${db.user.id}:${id}`),
    templateHash: templateHash(input.sample),
    dimensions: input.sample.length,
    quality: input.quality ?? 0.9,
    matchThreshold: MATCH_THRESHOLD,
    createdAt: nowIso(),
    lastUsedAt: null,
    useCount: 0,
  });
  db.biometric.enrolled = true;
  db.biometric.failedAttempts = 0;
  db.biometric.lockedUntil = null;
  pushAudit(db, {
    actor: `user:${db.user.id}`,
    action: "biometric.enroll",
    detail: `${input.label} enrolled · ${input.sample.length}-dim template sealed with AES-256-GCM`,
    severity: "info",
  }, randomId("aud"));
  return db.biometric;
}

export function removeFinger(db: Database, fingerId: string) {
  db.biometric.fingers = db.biometric.fingers.filter((f) => f.id !== fingerId);
  db.biometric.enrolled = db.biometric.fingers.length > 0;
  pushAudit(db, {
    actor: `user:${db.user.id}`,
    action: "biometric.remove",
    detail: `Template ${fingerId} deleted from sealed storage`,
    severity: "warning",
  }, randomId("aud"));
  return db.biometric;
}

export function verifyBiometricOnly(
  db: Database,
  input: { fingerId?: string; sample?: number[]; liveness?: LivenessProof },
) {
  const finger = db.biometric.fingers.find((f) => f.id === input.fingerId) ?? db.biometric.fingers[0];
  if (!finger) return { matched: false, score: 0, detail: "No finger enrolled", livenessPassed: false };
  const sealed = open(finger.sealedTemplate, `finger:${db.user.id}:${finger.id}`);
  const result = matchBiometric({
    sealedTemplate: sealed,
    liveSample: input.sample ?? null,
    liveness: input.liveness,
    livenessEnabled: db.biometric.livenessEnabled,
    threshold: finger.matchThreshold,
    lockedUntil: db.biometric.lockedUntil,
  });
  return {
    matched: result.matched,
    score: result.score,
    confidence: confidenceFromScore(result.score),
    livenessPassed: result.livenessPassed,
    detail: result.detail,
    fingerLabel: finger.label,
  };
}

/* ------------------------------------------------------------------ *
 * Fraud scenario simulator
 * ------------------------------------------------------------------ */

export interface ScenarioResult {
  scenario: string;
  title: string;
  description: string;
  assessment: RiskAssessment;
  context: {
    amountXAF: number;
    merchantName: string;
    city: string;
    at: string;
    offline: boolean;
    device: string;
    distanceFromLastKm?: number;
  };
}

export function simulateScenario(db: Database, scenario: string): ScenarioResult {
  const now = new Date();
  const history = [...db.txns].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const baseline = deriveBaseline(history, db.user.homeGeo);
  const last = history[0];
  const known = db.merchants.filter((m) => !m.flagged);
  const shopping = db.merchants.find((m) => m.id === "mer_mfoundi")!;
  const flagged = db.merchants.find((m) => m.id === "mer_quickcash")!;
  const travel = db.merchants.find((m) => m.id === "mer_buea")!;

  switch (scenario) {
    case "impossible-travel": {
      const at = new Date(now.getTime() - 4 * 60_000);
      const garoua = { lat: 9.3017, lng: 13.3921, city: "Garoua" };
      const assessment = assessRisk({
        ...riskInputs(db, {
          amountXAF: 42_000,
          merchant: travel,
          geo: garoua,
          authScore: 0.958,
          livenessPassed: true,
          offline: false,
          channel: "qr-scan",
          at,
        }),
        recentTxns: [
          { ...last, createdAt: new Date(now.getTime() - 12 * 60_000).toISOString(), geo: { lat: 4.0511, lng: 9.7679, city: "Douala" } },
          ...history,
        ],
        baseline: { ...baseline, scoreBaseline: db.biometric.scoreBaseline },
      });
      return {
        scenario,
        title: "Impossible travel",
        description: "Douala → Garoua in 12 minutes: 900 km at roughly 4 500 km/h. Physically impossible without a cloned credential.",
        assessment,
        context: {
          amountXAF: 42_000,
          merchantName: travel.name,
          city: "Garoua",
          at: at.toISOString(),
          offline: false,
          device: "Pixel 8 Pro",
          distanceFromLastKm: Math.round(distanceKm({ lat: 4.0511, lng: 9.7679 }, garoua)),
        },
      };
    }
    case "velocity-burst": {
      const at = now;
      const burst = Array.from({ length: 5 }, (_, i) => ({
        ...last,
        id: `sim_${i}`,
        createdAt: new Date(now.getTime() - (i + 1) * 60_000).toISOString(),
        amountXAF: 3_500,
        status: "settled" as const,
      }));
      const assessment = assessRisk({
        ...riskInputs(db, {
          amountXAF: 3_500,
          merchant: shopping,
          geo: shopping.geo,
          authScore: 0.963,
          livenessPassed: true,
          offline: false,
          channel: "qr-scan",
          at,
        }),
        recentTxns: [...burst, ...history],
        baseline: { ...baseline, scoreBaseline: db.biometric.scoreBaseline },
      });
      return {
        scenario,
        title: "Velocity burst",
        description: "Six small payments in five minutes — the classic pattern of a stolen unlocked phone being drained at nearby tills.",
        assessment,
        context: { amountXAF: 3_500, merchantName: shopping.name, city: shopping.geo.city, at: at.toISOString(), offline: false, device: "Pixel 8 Pro" },
      };
    }
    case "amount-spike": {
      const at = now;
      const merchant = db.merchants.find((m) => m.id === "mer_pharma")!;
      const assessment = assessRisk({
        ...riskInputs(db, {
          amountXAF: 285_000,
          merchant,
          geo: merchant.geo,
          authScore: 0.961,
          livenessPassed: true,
          offline: false,
          channel: "qr-scan",
          at,
        }),
        baseline: { ...baseline, scoreBaseline: db.biometric.scoreBaseline },
      });
      return {
        scenario,
        title: "Amount spike",
        description: `A ${money(285_000)} charge on a card that averages ${money(baseline.avgTicketXAF)} — 12σ above the customer's own distribution.`,
        assessment,
        context: { amountXAF: 285_000, merchantName: merchant.name, city: merchant.geo.city, at: at.toISOString(), offline: false, device: "Pixel 8 Pro" },
      };
    }
    case "stolen-device": {
      const at = now;
      const merchant = db.merchants.find((m) => m.id === "mer_mokolo")!;
      const assessment = assessRisk({
        ...riskInputs(db, {
          amountXAF: 68_000,
          merchant,
          geo: merchant.geo,
          brandNewDevice: true,
          authScore: 0.71,
          livenessPassed: false,
          offline: false,
          channel: "qr-scan",
          at,
        }),
        baseline: { ...baseline, scoreBaseline: db.biometric.scoreBaseline },
      });
      return {
        scenario,
        title: "Stolen device + spoof",
        description: "Unknown Android device, 71% match, no pulse detected under the ridge pattern. This is the spoof the liveness check exists for.",
        assessment,
        context: { amountXAF: 68_000, merchantName: merchant.name, city: merchant.geo.city, at: at.toISOString(), offline: false, device: "Unknown Android" },
      };
    }
    case "flagged-merchant": {
      const at = now;
      const assessment = assessRisk({
        ...riskInputs(db, {
          amountXAF: 45_000,
          merchant: flagged,
          geo: flagged.geo,
          authScore: 0.961,
          livenessPassed: true,
          offline: false,
          channel: "qr-scan",
          at,
        }),
        baseline: { ...baseline, scoreBaseline: db.biometric.scoreBaseline },
      });
      return {
        scenario,
        title: "Flagged merchant",
        description: "Acquirer risk 88/100, two open collusion cases. Even a clean biometric does not make this payment safe to release.",
        assessment,
        context: { amountXAF: 45_000, merchantName: flagged.name, city: flagged.geo.city, at: at.toISOString(), offline: false, device: "Pixel 8 Pro" },
      };
    }
    case "offline-cap":
    default: {
      const at = now;
      const merchant = known.find((m) => m.id === "mer_eneo")!;
      const assessment = assessRisk({
        ...riskInputs(db, {
          amountXAF: 42_000,
          merchant,
          geo: merchant.geo,
          authScore: 0.955,
          livenessPassed: true,
          offline: true,
          channel: "offline-qr",
          at,
        }),
        baseline: { ...baseline, scoreBaseline: db.biometric.scoreBaseline },
      });
      return {
        scenario: "offline-cap",
        title: "Offline cap breach",
        description: `A ${money(42_000)} voucher signed with no data, four times the ${money(db.user.settings.offlinePerTxnXAF)} offline cap — the exposure that caps exist to bound.`,
        assessment,
        context: { amountXAF: 42_000, merchantName: merchant.name, city: merchant.geo.city, at: at.toISOString(), offline: true, device: "Pixel 8 Pro" },
      };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Network / settings / alerts
 * ------------------------------------------------------------------ */

export function setNetworkTier(db: Database, tier: NetworkTier) {
  const preset = NETWORK_PRESETS[tier];
  const plan = transportFor(tier);
  db.network = {
    tier,
    latencyMs: preset.latencyMs,
    packetLoss: preset.packetLoss,
    online: tier !== "offline",
    updatedAt: nowIso(),
    bars: plan.bars,
    label: tier === "offline" ? "No data · GSM only" : `${plan.label} · MTN Cameroon`,
  };
  pushSync(db, {
    kind: "transport",
    message: `Radio profile → ${plan.label}`,
    detail: `${tier === "offline" ? "Store-and-forward only" : `batch ${plan.batchSize}${plan.compress ? " · gzip" : ""}${plan.deltaOnly ? " · delta" : ""}`} · ${plan.fallback}`,
  }, randomId("syn"));
  pushAudit(db, {
    actor: "user:" + db.user.id,
    action: "network.simulate",
    detail: `Transport profile set to ${plan.label}`,
    severity: "info",
  }, randomId("aud"));
  return db.network;
}

export function updateSettings(db: Database, patch: Partial<UserSettings>) {
  const next: UserSettings = { ...db.user.settings };
  const clamp = (v: unknown, min: number, max: number, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  if (patch.stepUpThresholdXAF !== undefined) next.stepUpThresholdXAF = clamp(patch.stepUpThresholdXAF, 1_000, 500_000, next.stepUpThresholdXAF);
  if (patch.offlinePerTxnXAF !== undefined) next.offlinePerTxnXAF = clamp(patch.offlinePerTxnXAF, 500, 50_000, next.offlinePerTxnXAF);
  if (patch.offlineDailyXAF !== undefined) next.offlineDailyXAF = clamp(patch.offlineDailyXAF, 1_000, 150_000, next.offlineDailyXAF);
  if (next.offlinePerTxnXAF > next.offlineDailyXAF) next.offlineDailyXAF = next.offlinePerTxnXAF;
  if (patch.requireLiveness !== undefined) next.requireLiveness = Boolean(patch.requireLiveness);
  if (patch.biometricOnly !== undefined) next.biometricOnly = Boolean(patch.biometricOnly);
  if (patch.nightGuard !== undefined) next.nightGuard = Boolean(patch.nightGuard);
  if (patch.autoSync !== undefined) next.autoSync = Boolean(patch.autoSync);
  if (patch.smsFallback !== undefined) next.smsFallback = Boolean(patch.smsFallback);
  if (patch.notifyOnEveryPayment !== undefined) next.notifyOnEveryPayment = Boolean(patch.notifyOnEveryPayment);
  db.user.settings = next;
  db.biometric.livenessEnabled = next.requireLiveness;
  pushAudit(db, {
    actor: `user:${db.user.id}`,
    action: "settings.update",
    detail: Object.keys(patch).join(", ") || "no-op",
    severity: "info",
  }, randomId("aud"));
  return next;
}

export function setPin(db: Database, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new Error("PIN must be exactly 4 digits");
  db.secrets.pin = hashPin(pin);
  db.user.pinSet = true;
  pushAudit(db, {
    actor: `user:${db.user.id}`,
    action: "pin.set",
    detail: "Step-up PIN rotated (scrypt, per-user salt)",
    severity: "warning",
  }, randomId("aud"));
  return { ok: true };
}

export function resolveAlert(db: Database, alertId: string, status: FraudAlert["status"]) {
  const alert = db.alerts.find((a) => a.id === alertId);
  if (!alert) throw new Error("Alert not found");
  alert.status = status;
  pushAudit(db, {
    actor: `user:${db.user.id}`,
    action: "alert.review",
    detail: `${alert.title} marked ${status}`,
    severity: "info",
  }, randomId("aud"));
  return alert;
}

export function trustDevice(db: Database, deviceId: string, trusted: boolean) {
  const device = db.devices.find((d) => d.id === deviceId);
  if (!device) throw new Error("Unknown device");
  device.trusted = trusted;
  device.status = trusted ? "active" : "revoked";
  pushAudit(db, {
    actor: `user:${db.user.id}`,
    action: trusted ? "device.trust" : "device.revoke",
    detail: `${device.label} ${trusted ? "re-trusted" : "revoked — its vouchers will be rejected"}`,
    severity: trusted ? "info" : "critical",
  }, randomId("aud"));
  return device;
}

/* ------------------------------------------------------------------ *
 * State projection
 * ------------------------------------------------------------------ */

export function buildAppState(db: Database): AppState {
  ensureOpenRequests(db);
  const openRequests = db.requests.filter((r) => r.status === "open" || r.status === "paid");
  return {
    user: db.user,
    wallets: db.wallets,
    biometric: {
      ...db.biometric,
      fingers: db.biometric.fingers.map((f) => ({ ...f, sealedTemplate: "[sealed: aes-256-gcm]" })),
    },
    devices: db.devices.map((d) => ({ ...d, publicKeyPem: d.publicKeyPem.split("\n")[1]?.slice(0, 24) + "…" })),
    merchants: db.merchants,
    txns: db.txns.slice(0, 200),
    queue: db.queue,
    requests: openRequests.slice(0, 12),
    alerts: db.alerts,
    network: db.network,
    audit: db.audit,
    syncLog: db.syncLog,
    stats: computeStats(db.txns),
    serverTime: nowIso(),
    vault: db.vault,
  };
}

export function currentDb() {
  return readDb();
}

export { sha256Hex };
