import { cohortsPublished, matchOption, optionsForField } from "./cohorts";
import type { Merchant, MerchantCategory, PayerDetails, PayerField, PaymentReason, SchoolLevel } from "./types";

/**
 * Reason-for-payment catalogue.
 *
 * A payee — in practice a school, university, clinic or utility — can publish a
 * short list of reasons ("School fees", "Library books", …). When the payer
 * picks one, the reason travels with the signed request and lands on the
 * receipt, so the organisation can reconcile who paid for what.
 *
 * Some reasons ask who the payment is for (school fees: the student's name).
 * That field is captured at payment time and stored alongside the reason.
 */

const MAX_REASONS = 8;
const MAX_LABEL = 40;

export const PAYER_FIELDS: { id: PayerField; label: string; short: string }[] = [
  { id: "class", label: "Class", short: "Class" },
  { id: "faculty", label: "Faculty", short: "Faculty" },
  { id: "department", label: "Department", short: "Dept" },
  { id: "year", label: "Year of study", short: "Year" },
];

export const SCHOOL_REASONS: PaymentReason[] = [
  { id: "school_fees", label: "School fees", askStudent: true, askFields: ["class"] },
  { id: "library_books", label: "Library books", askStudent: true, askFields: ["class"] },
  { id: "library_fees", label: "Library fees", askStudent: true, askFields: ["class"] },
  { id: "registration", label: "Registration", askStudent: true, askFields: ["class"] },
  { id: "exam_fees", label: "Exam fees", askStudent: true, askFields: ["class"] },
  { id: "uniform", label: "Uniform & kit", askStudent: true, askFields: ["class"] },
];

/** Universities need faculty → department → year, not a single class. */
export const UNIVERSITY_REASONS: PaymentReason[] = [
  { id: "tuition", label: "Tuition", askStudent: true, askFields: ["faculty", "department", "year"] },
  { id: "registration", label: "Registration", askStudent: true, askFields: ["faculty", "department", "year"] },
  { id: "transcript", label: "Transcript", askStudent: true, askFields: ["faculty", "department", "year"] },
  { id: "hostel", label: "Hostel fees", askStudent: true, askFields: ["year"] },
];

export const CLINIC_REASONS: PaymentReason[] = [
  { id: "consultation", label: "Consultation" },
  { id: "pharmacy", label: "Pharmacy" },
  { id: "lab_tests", label: "Lab tests" },
];

export const UTILITY_REASONS: PaymentReason[] = [
  { id: "monthly_bill", label: "Monthly bill" },
  { id: "reconnection", label: "Reconnection fee" },
  { id: "meter_topup", label: "Meter top-up" },
];

const BY_CATEGORY: Partial<Record<MerchantCategory, PaymentReason[]>> = {
  education: SCHOOL_REASONS,
  health: CLINIC_REASONS,
  utilities: UTILITY_REASONS,
};

/**
 * The reasons a payer may choose from.
 *
 * `undefined` means "never customised" → fall back to the category template so
 * a school that enrolled before this feature still offers its reasons.
 * An explicit empty array means the payee removed them, and stays empty.
 */
export function reasonsFor(merchant: Merchant): PaymentReason[] {
  if (merchant.paymentReasons) return merchant.paymentReasons;
  if (merchant.kind === "person") return [];
  return defaultReasonsFor(merchant.category, merchant.kind, merchant.schoolLevel);
}

/**
 * The starting list for a newly enrolled payee. A university gets tuition-style
 * reasons (faculty, department, year); a primary or secondary school gets fee
 * reasons that ask for the class — the same fields its portal will group by.
 */
export function defaultReasonsFor(
  category: MerchantCategory,
  kind?: Merchant["kind"],
  schoolLevel?: SchoolLevel,
): PaymentReason[] {
  if (kind === "person") return [];
  if (category === "education" && schoolLevel === "university") return UNIVERSITY_REASONS;
  return BY_CATEGORY[category] ?? [];
}

const slug = (label: string) =>
  label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);

/** Validate and normalise a payee-submitted list. Throws with a human message. */
export function normaliseReasons(input: unknown): PaymentReason[] {
  if (!Array.isArray(input)) throw new Error("Reasons must be a list");
  if (input.length > MAX_REASONS) throw new Error(`A payee can publish at most ${MAX_REASONS} reasons`);

  const out: PaymentReason[] = [];
  const usedIds = new Set<string>();
  const usedLabels = new Set<string>();

  for (const raw of input) {
    const item = (raw ?? {}) as { id?: unknown; label?: unknown; askStudent?: unknown; askFields?: unknown };
    const label = String(item.label ?? "").trim().replace(/\s+/g, " ");
    if (label.length < 2) throw new Error("Every reason needs a label of at least 2 characters");
    if (label.length > MAX_LABEL) throw new Error(`Keep reason labels under ${MAX_LABEL} characters`);

    const key = label.toLowerCase();
    if (usedLabels.has(key)) throw new Error(`"${label}" is listed twice`);
    usedLabels.add(key);

    let id = slug(label) || "reason";
    let n = 2;
    while (usedIds.has(id)) id = `${slug(label)}_${n++}`;
    usedIds.add(id);

    const rawFields = Array.isArray(item.askFields) ? item.askFields : [];
    const askFields = PAYER_FIELDS.map((f) => f.id).filter((id) => rawFields.includes(id));
    out.push({
      id,
      label,
      askStudent: Boolean(item.askStudent),
      ...(askFields.length ? { askFields } : {}),
    });
  }
  return out;
}

export interface PayerGap {
  /** `reason` for the reason itself, `payerFor` for the student, else a cohort field. */
  field: "reason" | "payerFor" | PayerField;
  message: string;
}

/**
 * What still has to be filled before a payment may continue.
 *
 * Shared by the web and the phone so the reminder a payer sees matches exactly
 * what the server will enforce — no payment is signed, then bounced.
 */
export function payerGaps(input: {
  payeeName: string;
  reasons: PaymentReason[];
  reasonId?: string;
  payerFor?: string;
  payerDetails?: PayerDetails;
}): PayerGap[] {
  const offered = input.reasons;
  if (offered.length === 0) return [];

  const gaps: PayerGap[] = [];
  const reason = offered.find((r) => r.id === input.reasonId);
  if (!reason) {
    gaps.push({ field: "reason", message: `Choose a reason for this payment to ${input.payeeName}` });
    return gaps;
  }

  if (reason.askStudent && (input.payerFor ?? "").trim().length < 2) {
    gaps.push({ field: "payerFor", message: `Enter the student's name for "${reason.label}"` });
  }

  for (const field of reason.askFields ?? []) {
    const value = String(input.payerDetails?.[field] ?? "").trim();
    if (!value) {
      const label = PAYER_FIELDS.find((f) => f.id === field)?.label ?? field;
      gaps.push({ field, message: `${label} is required for "${reason.label}"` });
    }
  }
  return gaps;
}

export interface ResolvedReason {
  reasonId?: string;
  reason?: string;
  payerFor?: string;
  payerDetails?: PayerDetails;
}

/**
 * Attach the chosen reason (and, when the reason asks for it, who the payment
 * is for) to a payment. Unknown reasons are rejected rather than silently
 * dropped: a school reconciling fees must not receive a payment tagged with a
 * reason it never published.
 */
export function resolveReason(
  merchant: Merchant,
  reasonId?: string,
  payerFor?: string,
  payerDetails?: PayerDetails,
): ResolvedReason {
  if (!reasonId) {
    if (payerFor && payerFor.trim()) {
      throw new Error("Choose a reason before naming who the payment is for");
    }
    return {};
  }
  const reason = reasonsFor(merchant).find((r) => r.id === reasonId);
  if (!reason) throw new Error("That reason is not offered by this payee");

  const who = (payerFor ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (reason.askStudent && who.length < 2) {
    throw new Error(`Enter the student's name for "${reason.label}"`);
  }

  const details: PayerDetails = {};
  // Faculty before department: the department list depends on the faculty chosen.
  const order = PAYER_FIELDS.map((f) => f.id);
  const fields = [...(reason.askFields ?? [])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const published = cohortsPublished(merchant);

  for (const field of fields) {
    const label = PAYER_FIELDS.find((f) => f.id === field)?.label ?? field;
    const value = String(payerDetails?.[field] ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (value.length < 1) {
      throw new Error(`${label} is required for "${reason.label}"`);
    }

    // Once the payee publishes its lists, the value has to come from one of them
    // — otherwise the payer is choosing, not spelling, and the portal's grouping
    // stays clean.
    if (published) {
      const options = optionsForField(merchant, field, details.faculty);
      if (options.length > 0) {
        const canonical = matchOption(options, value);
        if (!canonical) {
          throw new Error(`Choose a ${label.toLowerCase()} from the list for "${reason.label}"`);
        }
        details[field] = canonical;
        continue;
      }
    }
    details[field] = value;
  }

  // A department has to belong to the faculty it was filed under.
  if (details.faculty && details.department && published) {
    const departments = optionsForField(merchant, "department", details.faculty);
    if (departments.length > 0) {
      const canonical = matchOption(departments, details.department);
      if (!canonical) throw new Error(`${details.department} is not a department of ${details.faculty}`);
      details.department = canonical;
    }
  }

  return {
    reasonId: reason.id,
    reason: reason.label,
    ...(reason.askStudent ? { payerFor: who } : {}),
    ...(Object.keys(details).length ? { payerDetails: details } : {}),
  };
}
