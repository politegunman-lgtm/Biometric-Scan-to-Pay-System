import type { Payee, PayerDetails, PayerField, PaymentReason } from "./types";

/**
 * Client mirror of the server's cohort rules.
 *
 * The phone shows the same dropdowns the web app does — published lists mean the
 * payer selects, not spells — and blocks Continue on exactly the gaps the server
 * would reject, so nothing is signed and then bounced.
 */

const EMPTY = { faculties: [], years: [], classes: [] };

export function fieldOptions(payee: Payee, field: PayerField, faculty?: string): string[] {
  const catalogue = payee.cohorts ?? EMPTY;
  if (field === "class") return catalogue.classes;
  if (field === "year") return catalogue.years;
  if (field === "faculty") return catalogue.faculties.map((f) => f.name);
  const wanted = (faculty ?? "").trim().toLowerCase();
  if (!wanted) return [];
  return catalogue.faculties.find((f) => f.name.toLowerCase() === wanted)?.departments ?? [];
}

export interface Gap {
  field: "reason" | "payerFor" | PayerField;
  message: string;
}

/** What still has to be filled before the request may be signed. */
export function payerGaps(
  payee: Pick<Payee, "name" | "reasons">,
  input: { reason: PaymentReason | null; payerFor: string; payerDetails: PayerDetails },
): Gap[] {
  const offered: PaymentReason[] = payee.reasons ?? [];
  if (offered.length === 0) return [];

  const gaps: Gap[] = [];
  const reason = input.reason && offered.find((r) => r.id === input.reason!.id);
  if (!reason) {
    gaps.push({ field: "reason", message: `Choose a reason for this payment to ${payee.name}` });
    return gaps;
  }
  if (reason.askStudent && input.payerFor.trim().length < 2) {
    gaps.push({ field: "payerFor", message: `Enter the student's name for "${reason.label}"` });
  }
  for (const field of reason.askFields ?? []) {
    if (!String(input.payerDetails[field] ?? "").trim()) {
      gaps.push({ field, message: `${field.charAt(0).toUpperCase()}${field.slice(1)} is required for "${reason.label}"` });
    }
  }
  return gaps;
}
