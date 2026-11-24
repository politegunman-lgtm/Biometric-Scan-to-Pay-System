import crypto from "node:crypto";
import { hashPin, hmac, sha256Hex, timingSafeEqualStr, verifyPin } from "./crypto";
import { reasonsFor } from "./reasons";
import type { Database } from "./store";
import type { Merchant, PayerField, Txn } from "./types";

/**
 * Business portal: an exclusive, read-mostly seat for the payee side.
 *
 * A merchant signs in with its payee code plus an access PIN and gets a scoped,
 * expiring token. Every portal call is scoped to one `merchantId`, so a school
 * can only ever see payments addressed to it. Nothing here changes the payment
 * pipeline: it is a projection over the transactions already settled.
 *
 * Deliberately NOT a student database. The portal groups and filters the rows
 * that came in with payments (reason, student, class/faculty/department/year),
 * which is enough to reconcile fees without owning a registry.
 */

export const DEFAULT_PORTAL_PIN = "2468";
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function secret(db: Database): string {
  // The portal secret lives beside the sensor seed; created on first use so old
  // stores keep working.
  const secrets = db.secrets as Database["secrets"] & { portalSecret?: string };
  if (!secrets.portalSecret) secrets.portalSecret = crypto.randomBytes(32).toString("hex");
  return secrets.portalSecret;
}

const sigOf = (secretValue: string, body: string) => hmac(secretValue, body).subarray(0, 16).toString("hex");

export function issuePortalToken(db: Database, merchantId: string): { token: string; expiresAt: string } {
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = `${merchantId}.${exp}`;
  return { token: `${body}.${sigOf(secret(db), body)}`, expiresAt: new Date(exp).toISOString() };
}

/** Returns the merchant id the token was issued for, or null. */
export function readPortalToken(db: Database, token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [merchantId, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = sigOf(secret(db), `${merchantId}.${expRaw}`);
  if (!timingSafeEqualStr(sig, expected)) return null;
  return merchantId;
}

export function checkPortalPin(merchant: Merchant, pin: string): boolean {
  if (merchant.portalPin) return verifyPin(pin, merchant.portalPin.salt, merchant.portalPin.hash);
  // Seeded payees have no stored PIN; the demo code applies until the business
  // sets its own (enrolment stores one).
  return pin === DEFAULT_PORTAL_PIN;
}

export function setPortalPin(merchant: Merchant, pin: string) {
  if (!/^\d{4}$/.test(pin)) throw new Error("Access PIN must be 4 digits");
  merchant.portalPin = hashPin(pin);
}

/** Find a payee by its 5-character code, case-insensitively. */
export function merchantByCode(db: Database, code: string): Merchant | undefined {
  const wanted = code.trim().toUpperCase();
  if (!wanted) return undefined;
  return db.merchants.find((m) => m.kind !== "person" && m.code === wanted);
}

export interface PortalFilters {
  q?: string;
  reason?: string;
  status?: string;
  field?: PayerField | "any";
  value?: string;
  groupBy?: GroupKey;
  from?: string;
  to?: string;
}

export type GroupKey = "reason" | "class" | "faculty" | "department" | "year" | "day";

export const GROUP_KEYS: { id: GroupKey; label: string }[] = [
  { id: "reason", label: "Reason" },
  { id: "class", label: "Class" },
  { id: "faculty", label: "Faculty" },
  { id: "department", label: "Department" },
  { id: "year", label: "Year" },
  { id: "day", label: "Day" },
];

export interface PortalPayment {
  id: string;
  receiptNo: string;
  createdAt: string;
  amountXAF: number;
  status: Txn["status"];
  channel: string;
  offline: boolean;
  reason: string | null;
  payerFor: string | null;
  payerDetails: Txn["payerDetails"] | null;
  payerName: string | null;
  provider: string;
}

function valueOf(txn: Txn, key: GroupKey): string {
  if (key === "reason") return txn.reason ?? "Unspecified";
  if (key === "day") return txn.createdAt.slice(0, 10);
  return txn.payerDetails?.[key] ?? "Unspecified";
}

function matchesFilters(txn: Txn, filters: PortalFilters): boolean {
  // Declined attempts are noise for reconciliation, so "paid" is the default
  // view; "all" is the explicit opt-in that includes them.
  const status = filters.status ?? "paid";
  if (status === "paid") {
    if (txn.status !== "settled" && txn.status !== "queued") return false;
  } else if (status !== "all" && txn.status !== status) {
    return false;
  }
  if (filters.reason && filters.reason !== "all" && (txn.reason ?? "Unspecified") !== filters.reason) return false;
  if (filters.field && filters.field !== "any" && filters.value) {
    if (valueOf(txn, filters.field) !== filters.value) return false;
  }
  if (filters.from && txn.createdAt.slice(0, 10) < filters.from) return false;
  if (filters.to && txn.createdAt.slice(0, 10) > filters.to) return false;
  if (filters.q && filters.q.trim()) {
    const hay = [
      txn.payerFor ?? "",
      txn.payerName ?? "",
      txn.reason ?? "",
      txn.receiptNo,
      txn.payerDetails?.class ?? "",
      txn.payerDetails?.faculty ?? "",
      txn.payerDetails?.department ?? "",
      txn.payerDetails?.year ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(filters.q.trim().toLowerCase())) return false;
  }
  return true;
}

export function portalView(db: Database, merchant: Merchant, filters: PortalFilters) {
  const all = db.txns.filter((t) => t.merchantId === merchant.id);
  const rows = all.filter((t) => matchesFilters(t, filters)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const counted = rows.filter((t) => t.status === "settled" || t.status === "queued");
  const today = new Date().toISOString().slice(0, 10);
  const todayRows = all.filter(
    (t) => t.createdAt.slice(0, 10) === today && (t.status === "settled" || t.status === "queued"),
  );

  const groupBy: GroupKey = filters.groupBy ?? "reason";
  const buckets = new Map<string, { key: string; label: string; count: number; totalXAF: number }>();
  for (const txn of counted) {
    const key = valueOf(txn, groupBy);
    const bucket = buckets.get(key) ?? { key, label: key, count: 0, totalXAF: 0 };
    bucket.count += 1;
    bucket.totalXAF += txn.amountXAF;
    buckets.set(key, bucket);
  }

  // Facet values for the filters, computed over everything this payee received
  // so a filter never hides the option that would return records.
  const facet = (pick: (t: Txn) => string | undefined) => {
    const map = new Map<string, { value: string; count: number; totalXAF: number }>();
    for (const txn of all) {
      if (txn.status === "declined") continue;
      const value = pick(txn);
      if (!value) continue;
      const entry = map.get(value) ?? { value, count: 0, totalXAF: 0 };
      entry.count += 1;
      entry.totalXAF += txn.amountXAF;
      map.set(value, entry);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };

  return {
    ok: true as const,
    payee: {
      id: merchant.id,
      name: merchant.name,
      code: merchant.code,
      kind: merchant.kind ?? "service",
      category: merchant.category,
      city: merchant.geo.city,
      tagline: merchant.tagline ?? null,
      verified: merchant.verified,
      enrolledAt: merchant.enrolledAt ?? null,
    },
    reasons: reasonsFor(merchant),
    filters: { ...filters, groupBy },
    stats: {
      received: counted.length,
      volumeXAF: counted.reduce((s, t) => s + t.amountXAF, 0),
      todayCount: todayRows.length,
      todayVolumeXAF: todayRows.reduce((s, t) => s + t.amountXAF, 0),
      beneficiaries: new Set(all.filter((t) => t.payerFor && t.status !== "declined").map((t) => t.payerFor!)).size,
      rows: rows.length,
    },
    groups: [...buckets.values()].sort((a, b) => b.totalXAF - a.totalXAF || a.label.localeCompare(b.label)),
    facets: {
      reasons: facet((t) => t.reason ?? "Unspecified"),
      class: facet((t) => t.payerDetails?.class),
      faculty: facet((t) => t.payerDetails?.faculty),
      department: facet((t) => t.payerDetails?.department),
      year: facet((t) => t.payerDetails?.year),
    },
    payments: rows.slice(0, 200).map<PortalPayment>((t) => ({
      id: t.id,
      receiptNo: t.receiptNo,
      createdAt: t.createdAt,
      amountXAF: t.amountXAF,
      status: t.status,
      channel: t.channel,
      offline: t.offline,
      reason: t.reason ?? null,
      payerFor: t.payerFor ?? null,
      payerDetails: t.payerDetails ?? null,
      payerName: t.payerName ?? null,
      provider: t.provider,
    })),
    generatedAt: new Date().toISOString(),
    fingerprint: sha256Hex(`${merchant.id}:${rows.length}:${Date.now()}`).slice(0, 12),
  };
}

export function portalCsv(view: ReturnType<typeof portalView>): string {
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "paid_at",
    "receipt",
    "customer",
    "student",
    "reason",
    "class",
    "faculty",
    "department",
    "year",
    "amount_xaf",
    "status",
    "channel",
    "provider",
  ];
  const rows = view.payments.map((p) =>
    [
      p.createdAt,
      p.receiptNo,
      p.payerName ?? "",
      p.payerFor ?? "",
      p.reason ?? "",
      p.payerDetails?.class ?? "",
      p.payerDetails?.faculty ?? "",
      p.payerDetails?.department ?? "",
      p.payerDetails?.year ?? "",
      p.amountXAF,
      p.status,
      p.channel,
      p.provider,
    ]
      .map(escape)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}
