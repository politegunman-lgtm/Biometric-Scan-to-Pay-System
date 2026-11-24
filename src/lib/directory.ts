import { reasonsFor } from "./reasons";
import type { Database } from "./store";
import type { Merchant, PaymentReason } from "./types";

/**
 * Payee directory shared by the people picker, the bill/services list and the
 * contact-matching endpoint.
 *
 * Everything payable in this system is a payee (`db.merchants` with a `kind`),
 * so a peer transfer, a supermarket checkout and an ENEO bill all flow through
 * the same signed request → biometric match → risk → receipt pipeline.
 */

export interface PayeeEntry {
  id: string;
  name: string;
  initials: string;
  kind: "business" | "person" | "service";
  category: Merchant["category"];
  tagline: string | null;
  logoHue: number;
  verified: boolean;
  code: string;
  msisdnMasked: string;
  /** Listed by the business itself, not yet reviewed. */
  isNew?: boolean;
  /** Reasons this payee offers, so the payer can pick one before authorising. */
  reasons: PaymentReason[];
}

const digits = (value: string) => value.replace(/\D/g, "");

/** Display form: +237 6•• ••• 190 — recognisable, not harvestable. */
export function maskMsisdn(msisdn: string): string {
  const d = digits(msisdn);
  if (d.length < 6) return msisdn;
  const prefix = d.startsWith("237") ? "+237" : `+${d.slice(0, 3)}`;
  const body = d.startsWith("237") ? d.slice(3) : d.slice(3);
  return `${prefix} ${body.slice(0, 1)}•• ••• ${d.slice(-3)}`;
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function toEntry(m: Merchant): PayeeEntry {
  return {
    id: m.id,
    name: m.name,
    initials: initialsOf(m.name),
    kind: (m.kind ?? "business") as PayeeEntry["kind"],
    category: m.category,
    tagline: m.tagline ?? null,
    logoHue: m.logoHue,
    verified: m.verified,
    code: m.code,
    msisdnMasked: maskMsisdn(m.msisdn),
    isNew: Boolean(m.enrolledAt),
    reasons: reasonsFor(m),
  };
}

export function payeeMatches(m: Merchant, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const qDigits = digits(q);
  if (qDigits.length >= 9) {
    const d = digits(m.msisdn);
    return d === qDigits || d.endsWith(qDigits) || qDigits.endsWith(d);
  }
  if (qDigits.length >= 3 && digits(m.msisdn).includes(qDigits)) return true;
  return (
    m.name.toLowerCase().includes(q) ||
    (m.tagline ?? "").toLowerCase().includes(q) ||
    m.code.toLowerCase() === q
  );
}

export function searchDirectory(db: Database, query: string, limit = 12) {
  const payees = db.merchants.filter((m) => !m.flagged);
  const people = payees.filter((m) => m.kind === "person" && payeeMatches(m, query));
  // Everything that is not a person is payable from the Bills tab: billers,
  // banks, schools — and shops that enrolled themselves or run a terminal.
  const services = payees
    .filter((m) => m.kind !== "person" && payeeMatches(m, query))
    .sort((a, b) => {
      const rank = (m: Merchant) => (m.enrolledAt ? 1 : m.kind === "service" ? 0 : 2);
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
  return {
    people: people.slice(0, limit).map(toEntry),
    services: services.slice(0, limit).map(toEntry),
    counts: { people: people.length, services: services.length },
  };
}

/** Which of these contact numbers already belong to a customer on the platform. */
export function matchContacts(db: Database, numbers: string[]) {
  const people = db.merchants.filter((m) => m.kind === "person" && !m.flagged);
  const wanted = numbers.map(digits).filter((n) => n.length >= 9);
  const found = people.filter((m) =>
    wanted.some((n) => {
      const d = digits(m.msisdn);
      return d === n || d.endsWith(n) || n.endsWith(d);
    }),
  );
  return {
    checked: wanted.length,
    matches: found.map((m) => ({ ...toEntry(m), onPlatform: true as const })),
    invited: Math.max(0, wanted.length - found.length),
  };
}

/** The signed-in customer, as a payable payee (for "my QR"). */
export function selfEntry(db: Database): PayeeEntry | null {
  return {
    id: db.user.id,
    name: db.user.fullName,
    initials: db.user.initials,
    kind: "person",
    category: "transfer",
    tagline: db.user.city,
    logoHue: 48,
    verified: true,
    code: "YOU",
    msisdnMasked: maskMsisdn(db.user.phone),
    reasons: [],
  };
}
