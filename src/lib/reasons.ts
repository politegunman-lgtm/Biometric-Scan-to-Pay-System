import type { Merchant, MerchantCategory, PaymentReason } from "./types";

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

export const SCHOOL_REASONS: PaymentReason[] = [
  { id: "school_fees", label: "School fees", askStudent: true },
  { id: "library_books", label: "Library books", askStudent: true },
  { id: "library_fees", label: "Library fees", askStudent: true },
  { id: "registration", label: "Registration", askStudent: true },
  { id: "exam_fees", label: "Exam fees", askStudent: true },
  { id: "uniform", label: "Uniform & kit", askStudent: true },
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
  return BY_CATEGORY[merchant.category] ?? [];
}

export function defaultReasonsFor(category: MerchantCategory, kind?: Merchant["kind"]): PaymentReason[] {
  if (kind === "person") return [];
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
    const item = (raw ?? {}) as { id?: unknown; label?: unknown; askStudent?: unknown };
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

    out.push({ id, label, askStudent: Boolean(item.askStudent) });
  }
  return out;
}

export interface ResolvedReason {
  reasonId?: string;
  reason?: string;
  payerFor?: string;
}

/**
 * Attach the chosen reason (and, when the reason asks for it, who the payment
 * is for) to a payment. Unknown reasons are rejected rather than silently
 * dropped: a school reconciling fees must not receive a payment tagged with a
 * reason it never published.
 */
export function resolveReason(merchant: Merchant, reasonId?: string, payerFor?: string): ResolvedReason {
  if (!reasonId) {
    if (payerFor && payerFor.trim()) {
      throw new Error("Choose a reason before naming who the payment is for");
    }
    return {};
  }
  const reason = reasonsFor(merchant).find((r) => r.id === reasonId);
  if (!reason) throw new Error("That reason is not offered by this payee");

  const who = (payerFor ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  if (reason.askStudent) {
    if (who.length < 2) throw new Error(`Enter the student's name for "${reason.label}"`);
    return { reasonId: reason.id, reason: reason.label, payerFor: who };
  }
  return { reasonId: reason.id, reason: reason.label };
}
