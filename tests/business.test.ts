import test from "node:test";
import assert from "node:assert/strict";
import { buildSeed } from "../src/lib/seed";
import {
  cohortsFor,
  defaultCohorts,
  fieldOptions,
  matchOption,
  normaliseCohorts,
} from "../src/lib/cohorts";
import {
  closeListing,
  deleteListing,
  reopenListing,
  rotatePortalPin,
  updateBusiness,
} from "../src/lib/businessAdmin";
import { payerGaps, resolveReason } from "../src/lib/reasons";
import { createPaymentRequest } from "../src/lib/service";
import { searchDirectory } from "../src/lib/directory";
import { checkPortalPin } from "../src/lib/portal";
import type { Database } from "../src/lib/store";

/**
 * Cohort lists and the business editing itself: the dropdowns a school
 * publishes, what the server accepts for them, and leaving the platform.
 */

const freshDb = () => buildSeed() as unknown as Database;
const merchantOf = (db: Database, id: string) => db.merchants.find((m) => m.id === id)!;

test("each school level starts with the right cohort lists", () => {
  const uni = defaultCohorts("university");
  assert.ok(uni.faculties.length >= 4);
  assert.ok(uni.faculties.every((f) => f.departments.length > 0));
  assert.ok(uni.years.includes("Year 2"));
  assert.equal(uni.classes.length, 0);

  const secondary = defaultCohorts("secondary");
  assert.equal(secondary.faculties.length, 0);
  assert.ok(secondary.classes.includes("Form 4"));

  const primary = defaultCohorts("primary");
  assert.ok(primary.classes.includes("Class 3"));
  assert.deepEqual(defaultCohorts(undefined), { faculties: [], years: [], classes: [] });

  // Field lookups follow the published catalogue.
  const catalogue = defaultCohorts("university");
  assert.ok(fieldOptions(catalogue, "faculty").includes("Faculty of Science"));
  assert.deepEqual(fieldOptions(catalogue, "department", "Faculty of Science").slice(0, 2), [
    "Computer Science",
    "Mathematics",
  ]);
  assert.deepEqual(fieldOptions(catalogue, "department", "Faculty of Law & Political Science"), [
    "Law",
    "Political Science",
  ]);
  assert.equal(matchOption(["Form 4", "Form 5"], " form   4 "), "Form 4");
  assert.equal(matchOption(["Form 4"], "Form 9"), null);
});

test("a catalogue is normalised, deduplicated and capped", () => {
  const catalogue = normaliseCohorts({
    faculties: [
      { name: " Faculty of Science ", departments: ["Computer Science", "computer science", "", "Mathematics"] },
      { name: "faculty of science", departments: ["Physics"] },
    ].slice(0, 1),
    years: "Year 1, Year 2, year 1",
    classes: [],
  });
  assert.deepEqual(catalogue.faculties[0], {
    name: "Faculty of Science",
    departments: ["Computer Science", "Mathematics"],
  });
  assert.deepEqual(catalogue.years, ["Year 1", "Year 2"]);

  assert.throws(
    () =>
      normaliseCohorts({
        faculties: [
          { name: "Science", departments: [] },
          { name: "science", departments: [] },
        ],
      }),
    /listed twice/i,
  );

  const many = normaliseCohorts({ years: Array.from({ length: 40 }, (_, i) => `Year ${i}`) });
  assert.ok(many.years.length <= 16);
});

test("published lists are authoritative when a payment is minted", () => {
  const db = freshDb();
  const uni = merchantOf(db, "svc_uy1");

  // Canonical spelling wins even when the payer sends lower case.
  const resolved = resolveReason(uni, "tuition", "Aicha Moussa", {
    faculty: "faculty of science",
    department: "computer science",
    year: "year 2",
  });
  assert.deepEqual(resolved.payerDetails, {
    faculty: "Faculty of Science",
    department: "Computer Science",
    year: "Year 2",
  });

  assert.throws(
    () =>
      resolveReason(uni, "tuition", "Aicha Moussa", {
        faculty: "Engineering",
        department: "Civil",
        year: "Year 2",
      }),
    /choose a faculty from the list/i,
  );
  assert.throws(
    () =>
      resolveReason(uni, "tuition", "Aicha Moussa", {
        faculty: "Faculty of Law & Political Science",
        department: "Computer Science",
        year: "Year 1",
      }),
    /choose a department from the list/i,
  );

  // A payee that never published lists still accepts free text.
  const shop = db.merchants.find((m) => m.category === "retail" && m.kind !== "person")!;
  shop.paymentReasons = [{ id: "layaway", label: "Layaway", askStudent: true, askFields: ["class"] }];
  delete shop.cohorts;
  assert.deepEqual(resolveReason(shop, "layaway", "Ngo", { class: "Form 4 B" }).payerDetails, { class: "Form 4 B" });
});

test("the business edits its own details and cohort lists", () => {
  const db = freshDb();
  const uni = merchantOf(db, "svc_uy1");

  const profile = updateBusiness(db, uni, {
    name: "Université de Yaoundé I (Ngoa-Ekelle)",
    tagline: "  Tuition   and registration ",
    phone: "6 99 12 00 30",
    city: "Douala",
    cohorts: {
      faculties: [{ name: "Faculty of Science", departments: ["Computer Science", "Mathematics"] }],
      years: ["Year 1", "Year 2", "Year 3"],
    },
  });
  assert.equal(profile.name, "Université de Yaoundé I (Ngoa-Ekelle)");
  assert.equal(profile.tagline, "Tuition and registration");
  assert.equal(profile.city, "Douala");
  assert.equal(profile.cohorts.faculties.length, 1);
  assert.equal(profile.cohortsPublished, true);
  assert.ok(db.audit.some((a) => a.action === "merchant.settings"));

  assert.throws(() => updateBusiness(db, uni, { name: "ENEO Electricity" }), /pick a distinct name/i);
  assert.throws(() => updateBusiness(db, uni, { phone: "12345" }), /Cameroonian mobile number/i);
  assert.throws(() => updateBusiness(db, uni, { city: "Atlantis" }), /Choose a city/i);
  assert.throws(
    () => updateBusiness(db, uni, { cohorts: { faculties: [], years: [], classes: [] } }),
    /at least one faculty/i,
  );

  // A secondary school cannot keep faculties, and a university drops classes.
  const lycee = merchantOf(db, "svc_lycee");
  const school = updateBusiness(db, lycee, {
    cohorts: { faculties: [{ name: "Ignored", departments: [] }], years: [], classes: ["Form 1", "Form 2"] },
  });
  assert.equal(school.cohorts.faculties.length, 0);
  assert.deepEqual(school.cohorts.classes, ["Form 1", "Form 2"]);
  const promoted = updateBusiness(db, lycee, { schoolLevel: "university" });
  assert.equal(promoted.schoolLevel, "university");
  assert.deepEqual(cohortsFor(merchantOf(db, "svc_lycee")).classes, []);
});

test("a business can close, reopen and delete itself", () => {
  const db = freshDb();
  const lycee = merchantOf(db, "svc_lycee");
  createPaymentRequest(db, { merchantId: "svc_lycee", amountXAF: 5_000 });
  const openBefore = db.requests.filter((r) => r.merchantId === "svc_lycee" && r.status === "open").length;
  assert.ok(openBefore > 0);

  closeListing(db, lycee);
  assert.ok(lycee.closedAt);
  assert.equal(db.requests.filter((r) => r.merchantId === "svc_lycee" && r.status === "open").length, 0);
  assert.ok(!searchDirectory(db, "Lycée").services.some((s) => s.id === "svc_lycee"), "closed payee leaves the directory");
  assert.throws(() => createPaymentRequest(db, { merchantId: "svc_lycee", amountXAF: 5_000 }), /closed its listing/i);
  assert.throws(() => closeListing(db, lycee), /already closed/i);

  reopenListing(db, lycee);
  assert.equal(lycee.closedAt, null);
  assert.ok(searchDirectory(db, "Lycée").services.some((s) => s.id === "svc_lycee"));

  const receipts = db.txns.filter((t) => t.merchantId === "svc_lycee").length;
  assert.throws(() => deleteListing(db, lycee, "Lycee"), /Type "Lycée Leclerc" to confirm/i);
  const result = deleteListing(db, lycee, " lycée leclerc ");
  assert.equal(result.receiptsKept, receipts);
  assert.ok(!db.merchants.some((m) => m.id === "svc_lycee"));
  assert.equal(db.txns.filter((t) => t.merchantId === "svc_lycee").length, receipts, "receipts survive");
  assert.ok(db.txns.some((t) => t.merchantId === "svc_lycee" && t.merchantName === "Lycée Leclerc"));
});

test("the portal PIN can be rotated from inside the portal", () => {
  const db = freshDb();
  const eneo = merchantOf(db, "svc_eneo");
  assert.equal(checkPortalPin(eneo, "2468"), true);
  rotatePortalPin(db, eneo, "9081");
  assert.equal(checkPortalPin(eneo, "9081"), true);
  assert.equal(checkPortalPin(eneo, "2468"), false);
  assert.throws(() => rotatePortalPin(db, eneo, "90"), /4 digits/i);
});

test("the payer is told exactly what is still missing", () => {
  const db = freshDb();
  const uni = merchantOf(db, "svc_uy1");

  const noReason = payerGaps({ payeeName: uni.name, reasons: uni.paymentReasons ?? [], reasonId: "", payerFor: "" });
  assert.equal(noReason.length, 1);
  assert.match(noReason[0].message, /Choose a reason/);

  const incomplete = payerGaps({
    payeeName: uni.name,
    reasons: uni.paymentReasons ?? [],
    reasonId: "tuition",
    payerFor: "",
    payerDetails: { faculty: "Faculty of Science" },
  });
  assert.deepEqual(incomplete.map((g) => g.field), ["payerFor", "department", "year"]);

  const complete = payerGaps({
    payeeName: uni.name,
    reasons: uni.paymentReasons ?? [],
    reasonId: "tuition",
    payerFor: "Aicha Moussa",
    payerDetails: { faculty: "Faculty of Science", department: "Computer Science", year: "Year 2" },
  });
  assert.deepEqual(complete, []);

  // A shop with no published reasons never blocks a payment.
  assert.deepEqual(payerGaps({ payeeName: "Shop", reasons: [] }), []);
});
