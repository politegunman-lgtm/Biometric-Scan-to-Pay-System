/** Subset of the server's shapes that this client actually reads. */

export interface Wallet {
  id: string;
  provider: "mtn-momo" | "orange-money" | "express-union" | string;
  providerName: string;
  msisdn: string;
  balanceXAF: number;
  accent: string;
  primary?: boolean;
  offlineFloatXAF?: number;
  status?: "active" | "restricted" | "frozen";
  perTxnLimitXAF?: number;
  dailyLimitXAF?: number;
  holder?: string;
  currency?: "XAF";
}

export interface Settings {
  stepUpThresholdXAF: number;
  offlinePerTxnXAF: number;
  offlineDailyXAF: number;
  requireLiveness: boolean;
  biometricOnly: boolean;
  nightGuard: boolean;
  autoSync: boolean;
  smsFallback: boolean;
}

export interface Finger {
  id: string;
  label: string;
  quality: number;
  useCount: number;
}

export interface PaymentRequest {
  id: string;
  ref: string;
  merchantId: string;
  merchantName: string;
  merchantCode?: string;
  amountXAF: number;
  note?: string;
  category: string;
  status: "open" | "paid" | "cancelled" | "expired";
  expiresAt: string;
  createdAt: string;
}

export interface Txn {
  id: string;
  ref: string;
  merchantId: string;
  merchantName: string;
  merchantCode: string;
  amountXAF: number;
  feeXAF?: number;
  status: "settled" | "queued" | "declined" | "reversed";
  createdAt: string;
  category: string;
  offline?: boolean;
  receiptNo?: string;
  reason?: string;
  reasonId?: string;
  payerFor?: string;
  payerDetails?: PayerDetails;
  channel?: string;
  provider?: string;
  walletId?: string;
  note?: string;
  auth?: { matchScore: number; livenessScore?: number; method?: string };
  risk?: { score: number; decision: string; level?: string };
}

export interface RiskAssessment {
  level: "low" | "medium" | "high" | "critical" | string;
  score: number;
  summary: string;
  signals?: { code: string; weight: number; label: string }[];
}

export interface QueuedVoucher {
  id: string;
  amountXAF: number;
  merchantName: string;
  status: string;
}

export interface AppState {
  user: {
    fullName: string;
    initials: string;
    phone: string;
    city: string;
    settings: Settings;
    pinSet: boolean;
  };
  wallets: Wallet[];
  biometric: {
    fingers: Finger[];
    livenessEnabled: boolean;
    lockedUntil: string | null;
    failedAttempts: number;
  };
  devices: { id: string; label: string; trusted: boolean }[];
  merchants: { id: string; name: string; code: string; flagged?: boolean }[];
  requests: PaymentRequest[];
  txns: Txn[];
  queue: QueuedVoucher[];
  alerts: { id: string; status: string; title: string }[];
  network: { tier: "excellent" | "good" | "weak" | "offline"; label: string; online: boolean };
  vault: { lastSyncAt: string | null; syncedTxns: number; pendingTxns: number };
  stats: Record<string, number>;
  serverTime: string;
}

export type PayerField = "class" | "faculty" | "department" | "year";

export interface PayerDetails {
  class?: string;
  faculty?: string;
  department?: string;
  year?: string;
}

export interface PaymentReason {
  id: string;
  label: string;
  askStudent?: boolean;
  askFields?: PayerField[];
}

export interface Payee {
  id: string;
  name: string;
  initials: string;
  kind: "business" | "person" | "service";
  category: string;
  tagline: string | null;
  logoHue: number;
  verified: boolean;
  code: string;
  msisdnMasked: string;
  onPlatform?: boolean;
  reasons?: PaymentReason[];
}

export interface Directory {
  ok: boolean;
  query: string;
  people: Payee[];
  services: Payee[];
  counts: { people: number; services: number };
  me: Payee | null;
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

export type PayTarget = {
  requestId?: string;
  walletId?: string;
  merchantId?: string;
  merchantName: string;
  amountXAF: number;
  note?: string;
  category?: string;
  source: "request" | "merchant";
};
