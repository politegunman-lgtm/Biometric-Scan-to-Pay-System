import { randomId, sha256Hex } from "./crypto";
import { PROVIDER_META, ADAPTERS } from "./providers";
import { setPortalPin } from "./portal";
import { defaultReasonsFor } from "./reasons";
import { nowIso, pushAudit, type Database } from "./store";
import type { GeoPoint, Merchant, MerchantCategory, ProviderId, SchoolLevel, Txn, Wallet } from "./types";

/**
 * Account-side operations that are not part of a payment:
 *
 *  - choosing which mobile-money wallet pays by default
 *  - linking another provider account
 *  - self-enrolment of a business as a payable payee
 *
 * Payments never branch here: an enrolled business is just another payee, so it
 * goes through the same signed request → biometrics → risk → receipt pipeline.
 */

/* ------------------------------------------------------------------ *
 * Wallets
 * ------------------------------------------------------------------ */

export function walletPublic(w: Wallet) {
  return {
    id: w.id,
    provider: w.provider,
    providerName: w.providerName,
    msisdn: w.msisdn,
    balanceXAF: w.balanceXAF,
    currency: w.currency,
    primary: w.primary,
    status: w.status,
    accent: w.accent,
    perTxnLimitXAF: w.perTxnLimitXAF,
    dailyLimitXAF: w.dailyLimitXAF,
    offlineFloatXAF: w.offlineFloatXAF,
  };
}

export function setPrimaryWallet(db: Database, walletId: string) {
  const wallet = db.wallets.find((w) => w.id === walletId);
  if (!wallet) throw new Error("Wallet not found");
  if (wallet.status !== "active") throw new Error(`${wallet.providerName} is ${wallet.status} — pick an active wallet`);

  const previous = db.wallets.find((w) => w.primary);
  if (previous?.id === wallet.id) {
    return { wallets: db.wallets.map(walletPublic), primaryWalletId: wallet.id, changed: false as const };
  }
  for (const w of db.wallets) w.primary = w.id === wallet.id;
  pushAudit(
    db,
    {
      actor: `user:${db.user.id}`,
      action: "wallet.primary",
      detail: `Default funding moved from ${previous?.providerName ?? "none"} to ${wallet.providerName}`,
      severity: "info",
    },
    randomId("aud"),
  );
  return { wallets: db.wallets.map(walletPublic), primaryWalletId: wallet.id, changed: true as const };
}

const digitsOf = (value: string) => value.replace(/\D/g, "");

/** Accepts 6XXXXXXXX, 2376XXXXXXXX, +237 6 XX XX XX XX. */
export function normaliseCameroonMsisdn(raw: string): string | null {
  let d = digitsOf(raw);
  if (d.startsWith("237")) d = d.slice(3);
  if (!/^6\d{8}$/.test(d)) return null;
  return `+237${d}`;
}

export function formatMsisdn(msisdn: string) {
  const d = digitsOf(msisdn).replace(/^237/, "");
  return `+237 ${d.slice(0, 1)} ${d.slice(1, 3)} ${d.slice(3, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}

export interface LinkWalletInput {
  provider?: unknown;
  msisdn?: unknown;
}

export function linkWallet(db: Database, input: LinkWalletInput) {
  const provider = String(input.provider ?? "") as ProviderId;
  if (!(provider in ADAPTERS)) throw new Error("Choose MTN Mobile Money, Orange Money or Express Union");

  const msisdn = normaliseCameroonMsisdn(String(input.msisdn ?? ""));
  if (!msisdn) throw new Error("Enter a Cameroonian mobile number, e.g. 6 77 41 22 08");

  const duplicate = db.wallets.find((w) => digitsOf(w.msisdn) === digitsOf(msisdn));
  if (duplicate) throw new Error(`${duplicate.providerName} is already linked with that number`);
  if (db.wallets.filter((w) => w.provider === provider).length >= 2) {
    throw new Error(`Two ${PROVIDER_META[provider].name} accounts are enough for the demo`);
  }

  const meta = PROVIDER_META[provider];
  const wallet: Wallet = {
    id: `wal_${provider.split("-")[0]}${db.wallets.length + 1}_${sha256Hex(msisdn + provider).slice(0, 4)}`,
    provider,
    providerName: meta.name,
    msisdn: formatMsisdn(msisdn),
    holder: db.user.fullName,
    // Sandbox float so the new wallet can actually pay before a real top-up.
    balanceXAF: 20_000,
    currency: "XAF",
    primary: false,
    dailyLimitXAF: 300_000,
    perTxnLimitXAF: 200_000,
    offlineFloatXAF: 10_000,
    status: "active",
    accent: meta.accent,
  };
  db.wallets.push(wallet);
  pushAudit(
    db,
    {
      actor: `user:${db.user.id}`,
      action: "wallet.link",
      detail: `${wallet.providerName} linked (${wallet.msisdn}) · sandbox float 20 000 FCFA`,
      severity: "info",
    },
    randomId("aud"),
  );
  return { wallet: walletPublic(wallet), wallets: db.wallets.map(walletPublic) };
}

/* ------------------------------------------------------------------ *
 * Business self-enrolment
 * ------------------------------------------------------------------ */

export type EnrolType = "shop" | "supermarket" | "utility" | "school" | "hospital" | "bank" | "telecom" | "other";

export const ENROL_TYPES: {
  id: EnrolType;
  label: string;
  kind: "business" | "service";
  category: MerchantCategory;
  /** Education payees must say which level they are, because it decides the fields. */
  asksSchoolLevel?: boolean;
}[] = [
  { id: "shop", label: "Shop / restaurant", kind: "business", category: "retail" },
  { id: "supermarket", label: "Supermarket", kind: "business", category: "groceries" },
  { id: "utility", label: "Utility (water, power)", kind: "service", category: "utilities" },
  { id: "school", label: "School / university", kind: "service", category: "education", asksSchoolLevel: true },
  { id: "hospital", label: "Clinic / hospital", kind: "service", category: "health" },
  { id: "bank", label: "Bank / microfinance", kind: "service", category: "banking" },
  { id: "telecom", label: "Telecom / airtime", kind: "service", category: "telecom" },
  { id: "other", label: "Something else", kind: "service", category: "retail" },
];

/**
 * Which kind of school. Primary and secondary schools collect a class;
 * universities collect faculty → department → year.
 */
export const SCHOOL_LEVELS: { id: SchoolLevel; label: string; hint: string }[] = [
  { id: "primary", label: "Primary", hint: "Class, e.g. Class 6" },
  { id: "secondary", label: "Secondary / high school", hint: "Form or class, e.g. Form 4 B" },
  { id: "university", label: "University", hint: "Faculty, department and year" },
];

const CITIES: Record<string, GeoPoint> = {
  yaounde: { lat: 3.848, lng: 11.5021, city: "Yaoundé" },
  douala: { lat: 4.0511, lng: 9.7679, city: "Douala" },
  bafoussam: { lat: 5.4781, lng: 10.4179, city: "Bafoussam" },
  bamenda: { lat: 5.9631, lng: 10.1591, city: "Bamenda" },
  garoua: { lat: 9.3017, lng: 13.3921, city: "Garoua" },
  buea: { lat: 4.1527, lng: 9.241, city: "Buea" },
  limbe: { lat: 4.0186, lng: 9.2163, city: "Limbé" },
  kribi: { lat: 2.9333, lng: 9.9167, city: "Kribi" },
};

export function cityOptions() {
  return Object.values(CITIES).map((c) => c.city);
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 18);
}

/**
 * A payee code is minted by the system, never chosen by the business: 5
 * characters from an unambiguous alphabet (no I/O/0/1, so it survives being
 * read aloud or written on a receipt). Every code is checked against the live
 * payee list *and* the ledger of codes already issued, so a code is never
 * reused for a different organisation.
 */
export function uniquePayeeCode(db: Database, seed: string) {
  const secrets = db.secrets as Database["secrets"] & { issuedCodes?: string[] };
  const issued = new Set(secrets.issuedCodes ?? []);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let salt = 0;
  for (;;) {
    const hex = sha256Hex(`${seed}:${salt}`);
    let code = "";
    for (let i = 0; i < 5; i += 1) code += alphabet[parseInt(hex.slice(i * 2, i * 2 + 2), 16) % alphabet.length];
    if (!issued.has(code) && !db.merchants.some((m) => m.code === code)) {
      secrets.issuedCodes = [...issued, code];
      return code;
    }
    salt += 1;
  }
}

export interface EnrolInput {
  name?: unknown;
  type?: unknown;
  city?: unknown;
  area?: unknown;
  phone?: unknown;
  about?: unknown;
  /** primary | secondary | university — required when type is "school". */
  schoolLevel?: unknown;
  /** 4-digit portal PIN, chosen by the business itself. */
  pin?: unknown;
  pinConfirm?: unknown;
}

export function enrolMerchant(db: Database, input: EnrolInput) {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 48) throw new Error("Business name must be 2–48 characters");

  const kindMeta = ENROL_TYPES.find((t) => t.id === input.type);
  if (!kindMeta) throw new Error("Choose what kind of business this is");

  // Which school it is decides whether payers are asked for a class or for
  // faculty/department/year, so the business has to say.
  let schoolLevel: SchoolLevel | undefined;
  if (kindMeta.asksSchoolLevel) {
    const wanted = String(input.schoolLevel ?? "");
    const level = SCHOOL_LEVELS.find((l) => l.id === wanted);
    if (!level) throw new Error("Say whether this is a primary school, secondary school or university");
    schoolLevel = level.id;
  }

  // The PIN is the business's own — the system issues the code, they choose the
  // PIN. Confirmation fields catch a typo before it locks them out.
  const pin = String(input.pin ?? "");
  if (!/^\d{4}$/.test(pin)) throw new Error("Choose a 4-digit access PIN for the business portal");
  if (input.pinConfirm !== undefined && String(input.pinConfirm) !== pin) {
    throw new Error("The two PINs do not match");
  }

  const cityKey = String(input.city ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const geo = CITIES[cityKey] ?? CITIES.yaounde;

  const msisdn = normaliseCameroonMsisdn(String(input.phone ?? ""));
  if (!msisdn) throw new Error("Enter the business phone number, e.g. 6 55 10 02 00");

  const about = String(input.about ?? "").trim().slice(0, 70);
  const area = String(input.area ?? "").trim().slice(0, 40);

  const bare = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = bare(name);
  const clash = db.merchants.find((m) => {
    if (m.kind === "person") return false;
    // "ENEO" must not enrol next to the existing "ENEO Electricity" payee.
    const existing = bare(m.name);
    return existing.includes(wanted) || wanted.includes(existing) || m.msisdn.replace(/\D/g, "") === msisdn.replace(/\D/g, "");
  });
  if (clash) throw new Error(`${clash.name} is already on Scan to Pay — search for it in the app`);

  const slug = slugify(name) || "business";
  const merchant: Merchant = {
    id: `mer_${slug}_${sha256Hex(name + msisdn).slice(0, 6)}`,
    code: uniquePayeeCode(db, name + msisdn),
    name,
    category: kindMeta.category,
    msisdn,
    geo,
    riskScore: 12,
    flagged: false,
    logoHue: (parseInt(sha256Hex(name).slice(0, 4), 16) % 360) | 0,
    // Not verified yet: a reviewer would confirm the registration before the
    // payee badge turns green. It is payable immediately, which is the point.
    verified: false,
    kind: kindMeta.kind,
    tagline: about || `${kindMeta.label} · ${area || geo.city}`,
    enrolledAt: nowIso(),
    ownerMsisdn: msisdn,
    // Schools, clinics and utilities start with a sensible reason list that
    // they can edit in the terminal.
    paymentReasons: defaultReasonsFor(kindMeta.category, kindMeta.kind, schoolLevel),
    ...(schoolLevel ? { schoolLevel } : {}),
  };
  setPortalPin(merchant, pin);
  db.merchants.unshift(merchant);
  pushAudit(
    db,
    {
      actor: `merchant:${merchant.id}`,
      action: "merchant.enroll",
      detail: `${merchant.name} enrolled as ${kindMeta.label}${schoolLevel ? ` (${schoolLevel})` : ""} (${geo.city}) · pending verification`,
      severity: "info",
    },
    randomId("aud"),
  );
  return {
    merchant: {
      id: merchant.id,
      name: merchant.name,
      code: merchant.code,
      kind: merchant.kind,
      category: merchant.category,
      tagline: merchant.tagline,
      city: merchant.geo.city,
      verified: merchant.verified,
      schoolLevel: merchant.schoolLevel ?? null,
      /** True: the business chose this PIN itself; the code above was issued by us. */
      pinSetByBusiness: true,
    },
    message: `${merchant.name} is now payable in the app`,
  };
}

/* ------------------------------------------------------------------ *
 * Recipients of past payments
 * ------------------------------------------------------------------ */

export interface RecipientSummary {
  merchantId: string;
  name: string;
  code: string;
  category: string;
  kind: "business" | "person" | "service";
  payments: number;
  spentXAF: number;
  lastPaidAt: string;
  lastTxnId: string;
  lastAmountXAF: number;
}

/** Who you have paid, aggregated — the "recipients" view and its CSV. */
export function recipientsOf(db: Database, txns: Txn[] = db.txns): RecipientSummary[] {
  const byId = new Map<string, RecipientSummary>();
  for (const txn of txns) {
    if (txn.status === "declined") continue;
    const merchant = db.merchants.find((m) => m.id === txn.merchantId);
    const existing = byId.get(txn.merchantId);
    if (existing) {
      existing.payments += 1;
      existing.spentXAF += txn.status === "settled" ? txn.amountXAF : 0;
      if (txn.createdAt > existing.lastPaidAt) {
        existing.lastPaidAt = txn.createdAt;
        existing.lastTxnId = txn.id;
        existing.lastAmountXAF = txn.amountXAF;
      }
      continue;
    }
    byId.set(txn.merchantId, {
      merchantId: txn.merchantId,
      name: txn.merchantName,
      code: txn.merchantCode,
      category: txn.category,
      kind: merchant?.kind ?? "business",
      payments: 1,
      spentXAF: txn.status === "settled" ? txn.amountXAF : 0,
      lastPaidAt: txn.createdAt,
      lastTxnId: txn.id,
      lastAmountXAF: txn.amountXAF,
    });
  }
  return [...byId.values()].sort((a, b) => (a.lastPaidAt < b.lastPaidAt ? 1 : -1));
}

export function recipientsCsv(recipients: RecipientSummary[]) {
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["name", "payee_code", "kind", "category", "payments", "settled_xaf", "last_paid_at"];
  const rows = recipients.map((r) =>
    [r.name, r.code, r.kind, r.category, r.payments, r.spentXAF, r.lastPaidAt].map(escape).join(","),
  );
  return [header.join(","), ...rows].join("\n");
}
