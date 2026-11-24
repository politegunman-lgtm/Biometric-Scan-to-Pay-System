import crypto from "node:crypto";
import { hashPin, randomId, seal, sha256Hex, signMerchantRequest } from "./crypto";
import { synthesiseTemplate, templateHash } from "./biometrics";
import { deriveBaseline, assessRisk } from "./fraud";
import type {
  AuditEntry,
  BiometricState,
  DeviceKey,
  FraudAlert,
  Merchant,
  MerchantCategory,
  NetworkState,
  PaymentRequest,
  RiskAssessment,
  SyncEvent,
  Txn,
  User,
  Wallet,
} from "./types";
import type { Database } from "./store";

/** Deterministic demo data so every reviewer sees the same 90-day history. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20261122);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const between = (min: number, max: number) => min + rnd() * (max - min);
const round5 = (n: number) => Math.max(100, Math.round(n / 5) * 5);

const YAOUNDE = { lat: 3.848, lng: 11.502, city: "Yaoundé" };
const DOUALA = { lat: 4.0511, lng: 9.7679, city: "Douala" };
const BAFOUSSAM = { lat: 5.4781, lng: 10.4179, city: "Bafoussam" };
const BUEA = { lat: 4.153, lng: 9.292, city: "Buea" };
const BAMENDA = { lat: 5.9631, lng: 10.1591, city: "Bamenda" };
const GAROUA = { lat: 9.3017, lng: 13.3921, city: "Garoua" };

const MERCHANTS: Omit<Merchant, "code">[] = [
  { id: "mer_mfoundi", name: "Mfoundi Market Foods", category: "groceries", msisdn: "+237677120045", geo: YAOUNDE, riskScore: 12, flagged: false, logoHue: 42, verified: true },
  { id: "mer_saker", name: "Boulangerie Saker", category: "food-drink", msisdn: "+237699884210", geo: DOUALA, riskScore: 18, flagged: false, logoHue: 26, verified: true },
  { id: "mer_moto", name: "MotoTaxi Express 237", category: "transport", msisdn: "+237655771902", geo: YAOUNDE, riskScore: 24, flagged: false, logoHue: 8, verified: true },
  { id: "mer_mtn_akwa", name: "MTN Service Center Akwa", category: "telecom", msisdn: "+237677000111", geo: DOUALA, riskScore: 5, flagged: false, logoHue: 48, verified: true },
  { id: "mer_wouri", name: "Cinéma Le Wouri", category: "entertainment", msisdn: "+237699332200", geo: DOUALA, riskScore: 32, flagged: false, logoHue: 280, verified: true },
  { id: "mer_pharma", name: "Pharmacie du Centre", category: "health", msisdn: "+237677445566", geo: YAOUNDE, riskScore: 8, flagged: false, logoHue: 160, verified: true },
  { id: "mer_chezwou", name: "Chez Wou Restaurant", category: "food-drink", msisdn: "+237699110022", geo: DOUALA, riskScore: 21, flagged: false, logoHue: 12, verified: true },
  { id: "mer_buea", name: "Buea Mountain Guides", category: "travel", msisdn: "+237677889900", geo: BUEA, riskScore: 54, flagged: false, logoHue: 196, verified: true },
  { id: "mer_eneo", name: "ENEO Prepaid Kiosk", category: "utilities", msisdn: "+237655101010", geo: YAOUNDE, riskScore: 9, flagged: false, logoHue: 52, verified: true },
  { id: "mer_mokolo", name: "Marché Mokolo Textiles", category: "retail", msisdn: "+237699445566", geo: YAOUNDE, riskScore: 38, flagged: false, logoHue: 320, verified: true },
  { id: "mer_bafou", name: "Bafoussam Coffee Co.", category: "food-drink", msisdn: "+237677332211", geo: BAFOUSSAM, riskScore: 16, flagged: false, logoHue: 30, verified: true },
  { id: "mer_airtime", name: "Airtime Hub Bonabéri", category: "telecom", msisdn: "+237655990011", geo: DOUALA, riskScore: 46, flagged: false, logoHue: 50, verified: false },
  { id: "mer_quickcash", name: "QuickCash Betting 237", category: "entertainment", msisdn: "+237699001122", geo: DOUALA, riskScore: 88, flagged: true, logoHue: 0, verified: false },
  { id: "mer_bamenda", name: "Bamenda Fresh Produce", category: "groceries", msisdn: "+237677554433", geo: BAMENDA, riskScore: 27, flagged: false, logoHue: 96, verified: true },
];

/**
 * Customers on the platform, for peer-to-peer transfers. They are modelled as
 * payees so the existing authorisation, fraud and receipt pipeline applies
 * unchanged — the only difference is that a person has no terminal and no
 * merchant code to print.
 */
const PEOPLE: Omit<Merchant, "code">[] = [
  { id: "peer_chantal", name: "Chantal Ngo Bell", category: "transfer", msisdn: "+237677452190", geo: YAOUNDE, riskScore: 3, flagged: false, logoHue: 330, verified: true, kind: "person", tagline: "Bastos · Yaoundé" },
  { id: "peer_emmanuel", name: "Emmanuel Fotso", category: "transfer", msisdn: "+237699118842", geo: DOUALA, riskScore: 4, flagged: false, logoHue: 210, verified: true, kind: "person", tagline: "Bonapriso · Douala" },
  { id: "peer_aicha", name: "Aicha Moussa", category: "transfer", msisdn: "+237655903317", geo: YAOUNDE, riskScore: 2, flagged: false, logoHue: 12, verified: true, kind: "person", tagline: "Mokolo · Yaoundé" },
  { id: "peer_bruno", name: "Bruno Tchoumi", category: "transfer", msisdn: "+237677661204", geo: BAFOUSSAM, riskScore: 6, flagged: false, logoHue: 96, verified: true, kind: "person", tagline: "Bafoussam" },
  { id: "peer_grace", name: "Grace Ekema", category: "transfer", msisdn: "+237699440128", geo: BUEA, riskScore: 2, flagged: false, logoHue: 165, verified: true, kind: "person", tagline: "Molyko · Buea" },
  { id: "peer_samuel", name: "Samuel Njoya", category: "transfer", msisdn: "+237655229876", geo: YAOUNDE, riskScore: 7, flagged: false, logoHue: 40, verified: true, kind: "person", tagline: "Ngoa-Ekellé · Yaoundé" },
  { id: "peer_linda", name: "Linda Mbarga", category: "transfer", msisdn: "+237677335019", geo: DOUALA, riskScore: 3, flagged: false, logoHue: 285, verified: true, kind: "person", tagline: "Akwa · Douala" },
  { id: "peer_ibrahim", name: "Ibrahim Sali", category: "transfer", msisdn: "+237699776401", geo: BAMENDA, riskScore: 9, flagged: false, logoHue: 22, verified: true, kind: "person", tagline: "Bamenda" },
];

/**
 * Billers and chains reachable from the in-app directory: utilities, airtime,
 * subscriptions, supermarkets and school fees.
 */
const SERVICES: Omit<Merchant, "code">[] = [
  { id: "svc_eneo", name: "ENEO Electricity", category: "utilities", msisdn: "+237655100200", geo: YAOUNDE, riskScore: 5, flagged: false, logoHue: 50, verified: true, kind: "service", tagline: "Prepaid meter top-up · bill" },
  { id: "svc_camwater", name: "Camwater", category: "utilities", msisdn: "+237655100201", geo: YAOUNDE, riskScore: 5, flagged: false, logoHue: 190, verified: true, kind: "service", tagline: "Water bill" },
  { id: "svc_mtn_airtime", name: "MTN Airtime", category: "telecom", msisdn: "+237677000100", geo: YAOUNDE, riskScore: 4, flagged: false, logoHue: 48, verified: true, kind: "service", tagline: "Top-up any MTN number" },
  { id: "svc_orange_airtime", name: "Orange Airtime", category: "telecom", msisdn: "+237699000200", geo: DOUALA, riskScore: 4, flagged: false, logoHue: 24, verified: true, kind: "service", tagline: "Top-up any Orange number" },
  { id: "svc_canalplus", name: "Canal+ Cameroon", category: "entertainment", msisdn: "+237699330044", geo: DOUALA, riskScore: 8, flagged: false, logoHue: 220, verified: true, kind: "service", tagline: "Subscription renewal" },
  { id: "svc_superu", name: "Super U Yaoundé", category: "groceries", msisdn: "+237677220011", geo: YAOUNDE, riskScore: 10, flagged: false, logoHue: 110, verified: true, kind: "service", tagline: "In-store checkout" },
  { id: "svc_mahima", name: "Mahima Supermarket", category: "groceries", msisdn: "+237699551177", geo: YAOUNDE, riskScore: 9, flagged: false, logoHue: 60, verified: true, kind: "service", tagline: "In-store checkout" },
  { id: "svc_lycee", name: "Lycée Leclerc", category: "education", msisdn: "+237655440099", geo: YAOUNDE, riskScore: 6, flagged: false, logoHue: 250, verified: true, kind: "service", tagline: "School fees · term 2", paymentReasons: [
    { id: "school_fees", label: "School fees", askStudent: true },
    { id: "library_books", label: "Library books", askStudent: true },
    { id: "library_fees", label: "Library fees", askStudent: true },
    { id: "exam_fees", label: "Exam fees", askStudent: true },
    { id: "uniform", label: "Uniform & kit", askStudent: true },
  ] },
  { id: "svc_hopital", name: "Hôpital Central", category: "health", msisdn: "+237677660088", geo: YAOUNDE, riskScore: 6, flagged: false, logoHue: 160, verified: true, kind: "service", tagline: "Consultation & pharmacy", paymentReasons: [
    { id: "consultation", label: "Consultation" },
    { id: "pharmacy", label: "Pharmacy" },
    { id: "lab_tests", label: "Lab tests" },
  ] },
  { id: "svc_sonara", name: "Tradex Fuel", category: "transport", msisdn: "+237699880055", geo: DOUALA, riskScore: 12, flagged: false, logoHue: 200, verified: true, kind: "service", tagline: "Fuel station" },
  { id: "svc_afriland", name: "Afriland First Bank", category: "banking", msisdn: "+237655770010", geo: YAOUNDE, riskScore: 4, flagged: false, logoHue: 210, verified: true, kind: "service", tagline: "Account deposit · transfer" },
  { id: "svc_ecobank", name: "Ecobank Cameroon", category: "banking", msisdn: "+237677990020", geo: DOUALA, riskScore: 5, flagged: false, logoHue: 170, verified: true, kind: "service", tagline: "Account deposit · transfer" },
  { id: "svc_uy1", name: "Université de Yaoundé I", category: "education", msisdn: "+237699120030", geo: YAOUNDE, riskScore: 7, flagged: false, logoHue: 265, verified: true, kind: "service", tagline: "Tuition · registration fees", paymentReasons: [
    { id: "tuition", label: "Tuition", askStudent: true },
    { id: "registration", label: "Registration", askStudent: true },
    { id: "transcript", label: "Transcript", askStudent: true },
    { id: "hostel", label: "Hostel fees", askStudent: true },
  ] },
];

const CATEGORY_TICKET: Record<MerchantCategory, [number, number]> = {
  groceries: [1800, 16000],
  "food-drink": [900, 9000],
  transport: [300, 2500],
  telecom: [500, 10000],
  utilities: [2000, 25000],
  health: [1500, 18000],
  retail: [2500, 32000],
  entertainment: [1500, 12000],
  travel: [8000, 65000],
  education: [5000, 45000],
  banking: [10_000, 400_000],
  transfer: [2000, 50000],
};

function codeFor(id: string) {
  return sha256Hex(id).slice(0, 5).toUpperCase();
}

function makeReceipt(seq: number) {
  return `BSP-${new Date().getFullYear()}-${String(seq).padStart(5, "0")}`;
}

function geoNear(base: { lat: number; lng: number; city: string }) {
  const jitter = () => (rnd() - 0.5) * 0.014;
  return { lat: +(base.lat + jitter()).toFixed(5), lng: +(base.lng + jitter()).toFixed(5), city: base.city };
}

export function buildSeed(): Database {
  const sensorSeed = "demo-sensor::pixel8-strongbox::v1";
  const userId = "usr_nadege";

  const user: User = {
    id: userId,
    fullName: "Nadège Mballa",
    initials: "NM",
    phone: "+237 6 77 41 22 08",
    email: "nadege.mballa@example.cm",
    city: "Yaoundé",
    homeGeo: { lat: 3.886, lng: 11.512, city: "Yaoundé" },
    memberSince: "2024-03-18",
    kycLevel: 3,
    settings: {
      stepUpThresholdXAF: 50_000,
      offlinePerTxnXAF: 10_000,
      offlineDailyXAF: 25_000,
      requireLiveness: true,
      biometricOnly: false,
      nightGuard: true,
      autoSync: true,
      smsFallback: true,
      notifyOnEveryPayment: true,
    },
    pinSet: true,
  };

  const wallets: Wallet[] = [
    {
      id: "wal_momo",
      provider: "mtn-momo",
      providerName: "MTN Mobile Money",
      msisdn: "+237 6 77 41 22 08",
      holder: "Nadège Mballa",
      balanceXAF: 184_500,
      currency: "XAF",
      primary: true,
      dailyLimitXAF: 500_000,
      perTxnLimitXAF: 300_000,
      offlineFloatXAF: 25_000,
      status: "active",
      accent: "#FFCB05",
    },
    {
      id: "wal_om",
      provider: "orange-money",
      providerName: "Orange Money",
      msisdn: "+237 6 99 07 55 12",
      holder: "Nadège Mballa",
      balanceXAF: 23_400,
      currency: "XAF",
      primary: false,
      dailyLimitXAF: 300_000,
      perTxnLimitXAF: 200_000,
      offlineFloatXAF: 0,
      status: "active",
      accent: "#FF7900",
    },
    {
      id: "wal_eu",
      provider: "express-union",
      providerName: "Express Union Mobile",
      msisdn: "+237 6 55 90 12 34",
      holder: "Nadège Mballa",
      balanceXAF: 8_000,
      currency: "XAF",
      primary: false,
      dailyLimitXAF: 150_000,
      perTxnLimitXAF: 100_000,
      offlineFloatXAF: 0,
      status: "active",
      accent: "#38BDF8",
    },
  ];

  /* ---------------- biometric enrollment ---------------- */
  const fingers: BiometricState["fingers"] = [
    { fingerId: "right-index", label: "Right index", seedFinger: "right-index", quality: 0.95 },
    { fingerId: "left-thumb", label: "Left thumb", seedFinger: "left-thumb", quality: 0.91 },
  ].map((f, i) => {
    const vec = synthesiseTemplate(sensorSeed, f.seedFinger);
    const createdAt = i === 0 ? "2024-03-18T10:22:00.000Z" : "2025-06-02T16:40:00.000Z";
    return {
      id: f.fingerId,
      label: f.label,
      sealedTemplate: seal(JSON.stringify(vec), `finger:${userId}:${f.fingerId}`),
      templateHash: templateHash(vec),
      dimensions: vec.length,
      quality: f.quality,
      matchThreshold: 0.86,
      createdAt,
      lastUsedAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
      useCount: i === 0 ? 187 : 27,
    };
  });

  const biometric: BiometricState = {
    enrolled: true,
    fingers,
    faceEnrolled: true,
    livenessEnabled: true,
    matchThreshold: 0.86,
    failedAttempts: 0,
    lockedUntil: null,
    totalAuths: 214,
    lastAuthAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    scoreBaseline: 0.9538,
  };

  /* ---------------- devices ---------------- */
  const deviceKeys: Database["secrets"]["deviceKeys"] = {};
  const mkDevice = (
    id: string,
    label: string,
    platform: DeviceKey["platform"],
    trusted: boolean,
    daysAgo: number,
    status: DeviceKey["status"] = "active",
  ): DeviceKey => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    deviceKeys[id] = { privateKeyPem, smsSecret: crypto.randomBytes(24).toString("hex") };
    return {
      id,
      label,
      platform,
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      keyHandle: `se:${crypto.randomBytes(8).toString("hex")}`,
      trusted,
      enrolledAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
      lastSeenAt: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
      fingerprint: sha256Hex(id).slice(0, 16).match(/.{4}/g)!.join(":"),
      status,
    };
  };

  const devices: DeviceKey[] = [
    mkDevice("dev_pixel", "Pixel 8 Pro", "android-enclave", true, 240),
    mkDevice("dev_web", "Chrome · MacBook Air", "web", true, 96),
    mkDevice("dev_infinix", "Infinix Hot 10 (sold)", "android-enclave", false, 512, "revoked"),
  ];

  devices[1].lastSeenAt = new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString();
  devices[2].lastSeenAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 41).toISOString();

  /* ---------------- merchants ---------------- */
  const merchants: Merchant[] = [
    ...MERCHANTS.map((m) => ({ ...m, kind: m.kind ?? ("business" as const), code: codeFor(m.id) })),
    ...PEOPLE.map((m) => ({ ...m, code: codeFor(m.id) })),
    ...SERVICES.map((m) => ({ ...m, code: codeFor(m.id) })),
  ];

  /* ---------------- transactions ---------------- */
  const txns: Txn[] = [];
  let receiptSeq = 1180;
  const now = Date.now();

  const historyFor = () =>
    [...txns].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const baseInput = (merchant: Merchant, amountXAF: number, at: Date, opts: {
    brandNewDevice?: boolean;
    liveness?: boolean;
    offline?: boolean;
    channel?: Txn["channel"];
    score?: number;
  }) => {
    const derived = deriveBaseline(historyFor(), user.homeGeo);
    return {
      amountXAF,
      merchant,
      geo: geoNear(merchant.geo),
      brandNewDevice: opts.brandNewDevice ?? false,
      authScore: opts.score ?? between(0.932, 0.981),
      livenessPassed: opts.liveness ?? true,
      offline: opts.offline ?? false,
      channel: opts.channel ?? "qr-scan",
      occurredAt: at,
      offlinePerTxnXAF: user.settings.offlinePerTxnXAF,
      offlineDailyXAF: user.settings.offlineDailyXAF,
      offlineSpentTodayXAF: 0,
      recentTxns: historyFor(),
      baseline: derived,
    };
  };

  function buildTxn(args: {
    merchant: Merchant;
    amountXAF: number;
    at: Date;
    channel: Txn["channel"];
    offline?: boolean;
    deviceLabel: string;
    forceDecline?: boolean;
    brandNewDevice?: boolean;
    liveness?: boolean;
    score?: number;
    geo?: { lat: number; lng: number; city: string };
    provider?: "mtn-momo" | "orange-money";
  }): Txn {
    const input = baseInput(args.merchant, args.amountXAF, args.at, {
      brandNewDevice: args.brandNewDevice,
      liveness: args.liveness,
      offline: args.offline,
      channel: args.channel,
      score: args.score,
    });
    if (args.geo) input.geo = args.geo;
    const risk = assessRisk(input);
    const declined = args.forceDecline || risk.decision === "block";
    receiptSeq += 1;
    const id = randomId("txn");
    return {
      id,
      ref: `REF-${id.slice(-8).toUpperCase()}`,
      receiptNo: makeReceipt(receiptSeq),
      merchantId: args.merchant.id,
      merchantName: args.merchant.name,
      merchantCode: args.merchant.code,
      category: args.merchant.category,
      amountXAF: args.amountXAF,
      feeXAF: 0,
      currency: "XAF",
      status: declined ? "declined" : "settled",
      channel: args.channel,
      provider: args.provider ?? "mtn-momo",
      walletId: args.provider === "orange-money" ? "wal_om" : "wal_momo",
      auth: {
        method: risk.decision === "challenge" ? "pin+biometric" : "biometric",
        matchScore: +input.authScore.toFixed(4),
        livenessPassed: input.livenessPassed,
        fingerLabel: "Right index",
        deviceId: "dev_pixel",
        challengeId: randomId("chl"),
        holdMs: 900 + Math.round(rnd() * 500),
        stepUp: risk.decision === "challenge",
      },
      risk,
      geo: input.geo,
      note: undefined,
      createdAt: args.at.toISOString(),
      settledAt: declined ? null : args.at.toISOString(),
      syncedAt: declined ? null : args.at.toISOString(),
      syncAttempts: declined ? 0 : 1,
      offline: !!args.offline,
      deviceLabel: args.deviceLabel,
      cloudSynced: !declined,
      loyaltyPoints: Math.floor(args.amountXAF / 500),
    };
  }

  // 90 days of organic payments. Weekdays and 07:00–21:00 are weighted, the
  // way mobile-money usage actually clusters (wages, market days, evening food).
  const organicCount = 156;
  for (let i = 0; i < organicCount; i++) {
    const dayOffset = Math.floor(Math.pow(rnd(), 1.25) * 89) + 1;
    const weekday = new Date(now - dayOffset * 86_400_000).getDay();
    if ((weekday === 0 || weekday === 6) && rnd() < 0.45) continue;
    const cityRoll = rnd();
    const pool = merchants.filter(
      (m) =>
        !m.flagged &&
        (cityRoll < 0.64
          ? m.geo.city === "Yaoundé"
          : cityRoll < 0.88
            ? m.geo.city === "Douala"
            : true),
    );
    const merchant = pick(pool);
    const [lo, hi] = CATEGORY_TICKET[merchant.category];
    const amount = round5(between(lo, hi));
    const at = new Date(now - dayOffset * 86_400_000);
    const hour = Math.floor(between(7, 21));
    at.setHours(hour, Math.floor(rnd() * 60), Math.floor(rnd() * 60), 0);
    // Offline vouchers only exist below the customer's cap — the app refuses
    // to sign anything larger, so history cannot contain one either.
    const roll = rnd();
    const wantsOffline = roll > 0.94;
    if (wantsOffline && amount > 8_000) continue;
    const channel: Txn["channel"] = wantsOffline
      ? rnd() < 0.25
        ? "offline-sms"
        : "offline-qr"
      : roll > 0.62
        ? "nfc-tap"
        : "qr-scan";
    const offline = channel.startsWith("offline");
    const provider = rnd() < 0.12 ? "orange-money" : "mtn-momo";
    txns.push(
      buildTxn({
        merchant,
        amountXAF: provider === "orange-money" ? Math.round(amount * 0.55) : amount,
        at,
        channel,
        offline,
        deviceLabel: rnd() < 0.85 ? "Pixel 8 Pro" : "Chrome · MacBook Air",
        provider,
      }),
    );
  }

  // A few payments in the last 24h give the dashboard and velocity model life.
  const recentSpecs: [string, number, number][] = [
    ["mer_moto", 1_200, 3.2],
    ["mer_saker", 2_500, 6.5],
    ["mer_mfoundi", 7_450, 11],
    ["mer_pharma", 4_300, 21],
  ];
  for (const [mid, amount, hoursAgo] of recentSpecs) {
    const merchant = merchants.find((m) => m.id === mid)!;
    const at = new Date(now - hoursAgo * 3_600_000);
    txns.push(
      buildTxn({
        merchant,
        amountXAF: amount,
        at,
        channel: rnd() < 0.4 ? "nfc-tap" : "qr-scan",
        deviceLabel: "Pixel 8 Pro",
      }),
    );
  }

  // Two historic attacks — the story the security screen tells.
  const quickcash = merchants.find((m) => m.id === "mer_quickcash")!;
  const attackAt = new Date(now - 1000 * 60 * 60 * 19);
  txns.push(
    buildTxn({
      merchant: quickcash,
      amountXAF: 480_000,
      at: attackAt,
      channel: "qr-scan",
      deviceLabel: "Pixel 8 Pro",
      forceDecline: true,
      geo: { ...GAROUA },
    }),
  );

  const travelAt = new Date(now - 1000 * 60 * 60 * 43);
  txns.push(
    buildTxn({
      merchant: merchants.find((m) => m.id === "mer_buea")!,
      amountXAF: 96_000,
      at: travelAt,
      channel: "qr-scan",
      deviceLabel: "Unknown Android device",
      brandNewDevice: true,
      liveness: false,
      score: 0.71,
      forceDecline: true,
    }),
  );

  txns.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  /* ---------------- fraud alerts ---------------- */
  const blocked = txns.find((t) => t.status === "declined" && t.merchantId === "mer_quickcash")!;
  const spoof = txns.find((t) => t.status === "declined" && t.merchantId === "mer_buea")!;
  const alerts: FraudAlert[] = [
    {
      id: randomId("alt"),
      txnId: blocked.id,
      title: "Payment blocked — impossible travel",
      detail:
        "480 000 FCFA at a flagged betting merchant in Garoua, 19 minutes after a Yaoundé coffee payment. Card freeze is automatic above 65 risk.",
      severity: "critical",
      signals: blocked.risk.signals,
      createdAt: blocked.createdAt,
      status: "auto-blocked",
      merchantName: blocked.merchantName,
      amountXAF: blocked.amountXAF,
      decision: "block",
    },
    {
      id: randomId("alt"),
      txnId: spoof.id,
      title: "Spoof attempt rejected on unknown device",
      detail:
        "Liveness telemetry showed a flat, static ridge pattern (photo-of-print). Capture rejected before any voucher was signed.",
      severity: "critical",
      signals: spoof.risk.signals,
      createdAt: spoof.createdAt,
      status: "resolved",
      merchantName: spoof.merchantName,
      amountXAF: spoof.amountXAF,
      decision: "block",
    },
    {
      id: randomId("alt"),
      txnId: null,
      title: "Offline cap raised",
      detail: "Offline per-payment cap increased from 5 000 to 10 000 FCFA after 90 days without disputes.",
      severity: "info",
      signals: [],
      createdAt: new Date(now - 1000 * 60 * 60 * 24 * 12).toISOString(),
      status: "resolved",
      merchantName: "Account setting",
      amountXAF: 0,
      decision: "allow",
    },
  ];

  /* ---------------- payment requests ---------------- */
  const mkRequest = (
    merchant: Merchant,
    amountXAF: number,
    note: string,
    minutesAgo: number,
  ): PaymentRequest => {
    const createdAt = new Date(now - minutesAgo * 60_000);
    const payload = {
      id: randomId("req"),
      merchantId: merchant.id,
      amountXAF,
      nonce: crypto.randomBytes(8).toString("hex"),
      exp: createdAt.getTime() + 20 * 60_000,
    };
    return {
      id: payload.id,
      merchantId: merchant.id,
      merchantName: merchant.name,
      merchantCode: merchant.code,
      category: merchant.category,
      amountXAF,
      ref: `QR-${payload.nonce.slice(0, 6).toUpperCase()}`,
      note,
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(payload.exp).toISOString(),
      nonce: payload.nonce,
      signature: signMerchantRequest({
        id: payload.id,
        merchantId: payload.merchantId,
        amountXAF: payload.amountXAF,
        nonce: payload.nonce,
        exp: payload.exp,
      }),
      status: "open",
      channel: "qr-scan",
      geo: merchant.geo,
    };
  };

  const requests: PaymentRequest[] = [
    mkRequest(merchants.find((m) => m.id === "mer_mfoundi")!, 3_500, "Weekly market run", 3),
    mkRequest(merchants.find((m) => m.id === "mer_chezwou")!, 12_000, "Table 7 · lunch", 6),
    mkRequest(merchants.find((m) => m.id === "mer_mtn_akwa")!, 5_000, "Airtime top-up", 9),
  ];

  /* ---------------- network, audit, sync ---------------- */
  const network: NetworkState = {
    tier: "good",
    latencyMs: 180,
    packetLoss: 0.4,
    online: true,
    updatedAt: new Date().toISOString(),
    bars: 3,
    label: "3G · MTN Cameroon",
  };

  const audit: AuditEntry[] = [
    { id: randomId("aud"), at: new Date(now - 1000 * 60 * 42).toISOString(), actor: "device:dev_pixel", action: "biometric.auth", detail: "Right index match 96.1% · liveness passed", severity: "info" },
    { id: randomId("aud"), at: new Date(now - 1000 * 60 * 60 * 19).toISOString(), actor: "risk-engine", action: "payment.blocked", detail: "Impossible travel + flagged merchant (score 88)", severity: "critical" },
    { id: randomId("aud"), at: new Date(now - 1000 * 60 * 60 * 24 * 12).toISOString(), actor: "user:usr_nadege", action: "settings.offline_cap", detail: "offlinePerTxnXAF 5000 → 10000", severity: "warning" },
    { id: randomId("aud"), at: new Date(now - 1000 * 60 * 60 * 24 * 96).toISOString(), actor: "user:usr_nadege", action: "device.pair", detail: "Chrome · MacBook Air paired and trusted", severity: "info" },
    { id: randomId("aud"), at: new Date(now - 1000 * 60 * 60 * 24 * 240).toISOString(), actor: "user:usr_nadege", action: "biometric.enroll", detail: "Right index enrolled (quality 95%)", severity: "info" },
    { id: randomId("aud"), at: "2024-03-18T10:18:00.000Z", actor: "kyc", action: "account.verified", detail: "KYC level 3 · CNI + selfie match", severity: "info" },
  ];

  const syncLog: SyncEvent[] = [
    { id: randomId("syn"), at: new Date(now - 1000 * 60 * 2).toISOString(), kind: "success", message: "Delta sync complete", detail: "12 receipts · 3.4 KB gzip · 412 ms", tier: "good", vouchers: 0 },
    { id: randomId("syn"), at: new Date(now - 1000 * 60 * 60 * 5).toISOString(), kind: "transport", message: "Radio switched 4G → 3G", detail: "Delta mode engaged, batch size 20", tier: "good" },
    { id: randomId("syn"), at: new Date(now - 1000 * 60 * 60 * 22).toISOString(), kind: "sms-fallback", message: "SMS voucher delivered via SMSC", detail: "Token BSP1.41.2500.MFNDI · 118 chars · 1 segment", tier: "offline" },
    { id: randomId("syn"), at: new Date(now - 1000 * 60 * 60 * 22 - 240_000).toISOString(), kind: "queue", message: "2 vouchers queued offline", detail: "Mfoundi Market Foods, MotoTaxi Express", tier: "offline", vouchers: 2 },
    { id: randomId("syn"), at: new Date(now - 1000 * 60 * 60 * 24 * 3).toISOString(), kind: "success", message: "Offline batch settled", detail: "3 vouchers · 11 500 FCFA · signatures verified", tier: "good", vouchers: 3 },
  ];

  const db: Database = {
    version: 1,
    seededAt: new Date().toISOString(),
    user,
    wallets,
    biometric,
    devices,
    merchants,
    txns,
    queue: [],
    requests,
    alerts,
    network,
    audit,
    syncLog,
    vault: {
      lastSyncAt: new Date(now - 1000 * 90).toISOString(),
      syncedTxns: txns.filter((t) => t.status === "settled").length,
      pendingTxns: 0,
      encryptedBytes: Math.round(txns.reduce((s, t) => s + JSON.stringify(t).length, 0) * 0.62),
      region: "Douala · cm-central-1",
    },
    counters: {
      day: new Date().toISOString().slice(0, 10),
      offlineSpentXAF: 0,
      receiptSeq,
    },
    secrets: {
      sensorSeed,
      pin: hashPin("2580"),
      deviceKeys,
      nextCounter: { dev_pixel: 0, dev_web: 0 },
      consumedCounters: { dev_pixel: [], dev_web: [] },
    },
  };

  return db;
}

export type { RiskAssessment };
