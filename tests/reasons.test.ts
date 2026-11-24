import test from "node:test";
import assert from "node:assert/strict";
import { buildSeed } from "../src/lib/seed";
import {
  CLINIC_REASONS,
  SCHOOL_REASONS,
  normaliseReasons,
  reasonsFor,
  resolveReason,
} from "../src/lib/reasons";
import { createPaymentRequest } from "../src/lib/service";
import { enrolMerchant } from "../src/lib/accounts";
import type { Database } from "../src/lib/store";

/** Reason-for-payment catalogue: defaults, validation and request binding. */

const freshDb = () => buildSeed() as unknown as Database;
const school = (db: Database) => db.merchants.find((m) => m.id === "svc_lycee")!;

test("schools fall back to the education template, peers have none", () => {
  const db = freshDb();
  const labels = reasonsFor(school(db)).map((r) => r.label);
  assert.ok(labels.includes("School fees"));
  assert.ok(labels.every((l) => SCHOOL_REASONS.some((r) => r.label === l)), "school labels come from the template");
  const person = db.merchants.find((m) => m.kind === "person")!;
  assert.deepEqual(reasonsFor(person), []);
  // The seeded clinic uses its own explicit list (same as the template here).
  const clinic = db.merchants.find((m) => m.id === "svc_hopital")!;
  assert.deepEqual(reasonsFor(clinic).map((r) => r.label), CLINIC_REASONS.map((r) => r.label));
});

test("an explicit empty list means 'no reasons', not 'use the default'", () => {
  const db = freshDb();
  const lycee = school(db);
  lycee.paymentReasons = [];
  assert.deepEqual(reasonsFor(lycee), []);
  delete lycee.paymentReasons;
  assert.ok(reasonsFor(lycee).length > 0);
});

test("submitted reasons are slugged, deduped and capped", () => {
  const cleaned = normaliseReasons([
    { label: "  Library   books ", askStudent: true },
    { label: "Bus pass" },
  ]);
  assert.deepEqual(cleaned, [
    { id: "library_books", label: "Library books", askStudent: true },
    { id: "bus_pass", label: "Bus pass", askStudent: false },
  ]);

  // Duplicate ids get suffixed, duplicate labels are rejected.
  const twice = normaliseReasons([{ label: "Misc" }, { label: "Misc!" }]);
  assert.notEqual(twice[0].id, twice[1].id);
  assert.throws(() => normaliseReasons([{ label: "Misc" }, { label: "misc" }]), /listed twice/i);

  assert.throws(() => normaliseReasons([{ label: "A" }]), /at least 2/);
  assert.throws(() => normaliseReasons(Array.from({ length: 9 }, (_, i) => ({ label: `Reason ${i}` }))), /at most 8/);
  assert.throws(() => normaliseReasons("nope"), /must be a list/i);
});

test("resolving a reason enforces the student-name rule", () => {
  const db = freshDb();
  const lycee = school(db);

  const fees = resolveReason(lycee, "school_fees", "  Marie   Claire Ngo ");
  assert.equal(fees.reason, "School fees");
  assert.equal(fees.reasonId, "school_fees");
  assert.equal(fees.payerFor, "Marie Claire Ngo");

  assert.throws(() => resolveReason(lycee, "school_fees"), /student's name/i);
  assert.throws(() => resolveReason(lycee, "school_fees", " "), /student's name/i);
  assert.throws(() => resolveReason(lycee, "nonsense"), /not offered/i);
  assert.throws(() => resolveReason(lycee, undefined, "Marie"), /Choose a reason/i);

  // A reason that does not ask for a student drops the name instead of storing it.
  const clinic = db.merchants.find((m) => m.id === "svc_hopital")!;
  const consult = resolveReason(clinic, "consultation", "ignored");
  assert.equal(consult.payerFor, undefined);
});

test("the signed request carries the reason and beneficiary name", () => {
  const db = freshDb();
  const request = createPaymentRequest(db, {
    merchantId: "svc_lycee",
    amountXAF: 25_000,
    reasonId: "library_books",
    payerFor: "Marie Claire Ngo",
  });
  assert.equal(request.reason, "Library books");
  assert.equal(request.reasonId, "library_books");
  assert.equal(request.payerFor, "Marie Claire Ngo");
  assert.ok(request.signature.length > 20);

  assert.throws(
    () => createPaymentRequest(db, { merchantId: "svc_lycee", amountXAF: 25_000, reasonId: "school_fees" }),
    /student's name/i,
  );
  assert.throws(
    () => createPaymentRequest(db, { merchantId: "mer_mfoundi", amountXAF: 2_000, reasonId: "school_fees", payerFor: "X" }),
    /not offered/i,
  );
});

test("a school that enrols itself starts with fee reasons", () => {
  const db = freshDb();
  const { merchant } = enrolMerchant(db, {
    name: "Institut Bilingue de Mvan",
    type: "school",
    city: "Yaoundé",
    phone: "6 99 55 44 33",
  });
  const stored = db.merchants.find((m) => m.id === merchant.id)!;
  assert.equal(stored.category, "education");
  assert.ok(stored.paymentReasons?.length, "template copied at enrolment");
  assert.ok(stored.paymentReasons!.some((r) => r.id === "school_fees" && r.askStudent));
});
