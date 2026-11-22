/**
 * Domain types for the Biometric Scan-to-Pay platform.
 *
 * The product is a payment rail in front of African mobile-money wallets
 * (MTN MoMo Cameroon is the reference integration). Everything here is
 * provider-agnostic: a wallet points at a `ProviderId` and the provider
 * adapter translates the internal charge into the operator's API.
 */

export type ProviderId = "mtn-momo" | "orange-money" | "express-union";

export type NetworkTier = "excellent" | "good" | "weak" | "offline";

export type PaymentChannel =
  | "nfc-tap"
  | "qr-scan"
  | "offline-qr"
  | "offline-sms"
  | "manual";

export type TxnStatus =
  | "settled"
  | "queued"
  | "syncing"
  | "declined"
  | "challenged"
  | "reversed";

export type RiskLevel = "low" | "elevated" | "high" | "critical";

export type FraudDecision = "allow" | "challenge" | "block";

export type MerchantCategory =
  | "groceries"
  | "food-drink"
  | "transport"
  | "telecom"
  | "utilities"
  | "health"
  | "retail"
  | "entertainment"
  | "travel"
  | "education";

export interface GeoPoint {
  lat: number;
  lng: number;
  city: string;
}

export interface Wallet {
  id: string;
  provider: ProviderId;
  providerName: string;
  msisdn: string;
  holder: string;
  balanceXAF: number;
  currency: "XAF";
  primary: boolean;
  dailyLimitXAF: number;
  perTxnLimitXAF: number;
  offlineFloatXAF: number;
  status: "active" | "restricted" | "frozen";
  accent: string;
}

export interface FingerTemplate {
  id: string;
  label: string;
  /** Ciphertext of the feature vector. Raw biometric data never leaves sealed storage. */
  sealedTemplate: string;
  templateHash: string;
  dimensions: number;
  quality: number;
  matchThreshold: number;
  createdAt: string;
  lastUsedAt: string | null;
  useCount: number;
}

export interface BiometricState {
  enrolled: boolean;
  fingers: FingerTemplate[];
  faceEnrolled: boolean;
  livenessEnabled: boolean;
  matchThreshold: number;
  failedAttempts: number;
  lockedUntil: string | null;
  totalAuths: number;
  lastAuthAt: string | null;
  /** Average match score of the last 20 genuine auths — drift is a fraud signal. */
  scoreBaseline: number;
}

export interface DeviceKey {
  id: string;
  label: string;
  platform: "android-enclave" | "web";
  publicKeyPem: string;
  /** Simulated secure-element wrapping key handle. Private key stays server-side keystore. */
  keyHandle: string;
  trusted: boolean;
  enrolledAt: string;
  lastSeenAt: string;
  fingerprint: string;
  status: "active" | "revoked";
}

export interface UserSettings {
  stepUpThresholdXAF: number;
  offlinePerTxnXAF: number;
  offlineDailyXAF: number;
  requireLiveness: boolean;
  biometricOnly: boolean;
  nightGuard: boolean;
  autoSync: boolean;
  smsFallback: boolean;
  notifyOnEveryPayment: boolean;
}

export interface User {
  id: string;
  fullName: string;
  initials: string;
  phone: string;
  email: string;
  city: string;
  homeGeo: GeoPoint;
  memberSince: string;
  kycLevel: number;
  settings: UserSettings;
  pinSet: boolean;
}

export interface Merchant {
  id: string;
  code: string;
  name: string;
  category: MerchantCategory;
  msisdn: string;
  geo: GeoPoint;
  riskScore: number;
  flagged: boolean;
  logoHue: number;
  verified: boolean;
}

export interface PaymentRequest {
  id: string;
  merchantId: string;
  merchantName: string;
  merchantCode: string;
  category: MerchantCategory;
  amountXAF: number;
  ref: string;
  note?: string;
  createdAt: string;
  expiresAt: string;
  nonce: string;
  signature: string;
  status: "open" | "paid" | "expired" | "cancelled";
  paidTxnId?: string;
  channel: PaymentChannel;
  geo: GeoPoint;
}

export interface AuthEvidence {
  method: "biometric" | "pin+biometric" | "pin";
  matchScore: number;
  livenessPassed: boolean;
  fingerLabel: string;
  deviceId: string;
  challengeId: string;
  holdMs: number;
  stepUp: boolean;
}

export interface RiskSignal {
  code: string;
  label: string;
  weight: number;
  detail: string;
  category: "velocity" | "amount" | "geo" | "device" | "behaviour" | "merchant" | "network" | "biometric";
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  decision: FraudDecision;
  signals: RiskSignal[];
  summary: string;
  recommendedAction: string;
  evaluatedInMs: number;
}

export interface OfflineVoucher {
  v: 1;
  txnId: string;
  userId: string;
  deviceId: string;
  counter: number;
  amountXAF: number;
  currency: "XAF";
  merchantId: string;
  merchantCode: string;
  merchantName: string;
  merchantRef: string;
  issuedAt: string;
  expiresAt: string;
  channel: "offline-qr" | "offline-sms";
  authScore: number;
  livenessPassed: boolean;
  riskScore: number;
  /** Ed25519 signature over the canonical payload, produced by the device key. */
  signature: string;
  /** Compact SMS/USSD token used when the data channel is dead. */
  smsToken: string;
}

export interface QueuedVoucher extends OfflineVoucher {
  status: "queued" | "syncing" | "settled" | "rejected";
  attempts: number;
  lastError?: string;
  syncedAt?: string;
  rejectedReason?: string;
}

export interface Txn {
  id: string;
  ref: string;
  receiptNo: string;
  merchantId: string;
  merchantName: string;
  merchantCode: string;
  category: MerchantCategory;
  amountXAF: number;
  feeXAF: number;
  currency: "XAF";
  status: TxnStatus;
  channel: PaymentChannel;
  provider: ProviderId;
  walletId: string;
  auth: AuthEvidence;
  risk: RiskAssessment;
  geo: GeoPoint;
  note?: string;
  createdAt: string;
  settledAt?: string | null;
  syncedAt?: string | null;
  syncAttempts: number;
  offline: boolean;
  voucherToken?: string;
  deviceLabel: string;
  /** Cloud sync metadata — history is mirrored to the encrypted personal vault. */
  cloudSynced: boolean;
  loyaltyPoints: number;
}

export interface FraudAlert {
  id: string;
  txnId: string | null;
  title: string;
  detail: string;
  severity: "info" | "warning" | "critical";
  signals: RiskSignal[];
  createdAt: string;
  status: "open" | "resolved" | "dismissed" | "auto-blocked";
  merchantName: string;
  amountXAF: number;
  decision: FraudDecision;
}

export interface SyncEvent {
  id: string;
  at: string;
  kind:
    | "queue"
    | "attempt"
    | "success"
    | "failure"
    | "conflict"
    | "transport"
    | "sms-fallback"
    | "usmd-fallback";
  message: string;
  detail?: string;
  tier: NetworkTier;
  vouchers?: number;
}

export interface NetworkState {
  tier: NetworkTier;
  /** Simulated round-trip latency in ms. */
  latencyMs: number;
  packetLoss: number;
  online: boolean;
  updatedAt: string;
  bars: number;
  label: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
  severity: "info" | "warning" | "critical";
}

export interface ProviderAdapter {
  id: ProviderId;
  name: string;
  shortName: string;
  accent: string;
  /** Operator-facing charge. Resolves once the operator confirms the debit. */
  charge: (input: {
    msisdn: string;
    amountXAF: number;
    reference: string;
    idempotencyKey: string;
  }) => Promise<{ ok: boolean; operatorRef: string; balanceAfterXAF: number }>;
  /** Compensation path used when fraud is confirmed after settlement. */
  reverse: (input: { operatorRef: string; amountXAF: number }) => Promise<{ ok: boolean }>;
}

export interface DashboardStats {
  spend30dXAF: number;
  spend30dCount: number;
  avgTicketXAF: number;
  offlineSharePct: number;
  settledPct: number;
  blockedCount: number;
  savingsXAF: number;
  topCategories: { category: MerchantCategory; label: string; amountXAF: number; count: number }[];
  daily: { date: string; amountXAF: number; count: number }[];
  hourly: { hour: number; count: number }[];
  merchants: { merchantId: string; name: string; amountXAF: number; count: number }[];
  riskTrend: { date: string; score: number }[];
}

export interface AppState {
  user: User;
  wallets: Wallet[];
  biometric: BiometricState;
  devices: DeviceKey[];
  merchants: Merchant[];
  txns: Txn[];
  queue: QueuedVoucher[];
  requests: PaymentRequest[];
  alerts: FraudAlert[];
  network: NetworkState;
  audit: AuditEntry[];
  syncLog: SyncEvent[];
  stats: DashboardStats;
  serverTime: string;
  vault: {
    lastSyncAt: string | null;
    syncedTxns: number;
    pendingTxns: number;
    encryptedBytes: number;
    region: string;
  };
}

export interface RiskInput {
  amountXAF: number;
  merchant: Merchant;
  geo: GeoPoint;
  brandNewDevice: boolean;
  authScore: number;
  livenessPassed: boolean;
  offline: boolean;
  channel: PaymentChannel;
  occurredAt: Date;
  offlinePerTxnXAF: number;
  offlineDailyXAF: number;
  offlineSpentTodayXAF: number;
  nightGuard?: boolean;
  recentTxns: Txn[];
  baseline: {
    avgTicketXAF: number;
    ticketStdDevXAF: number;
    usualHours: number[];
    homeGeo: GeoPoint;
    knownMerchants: string[];
    scoreBaseline: number;
  };
}
