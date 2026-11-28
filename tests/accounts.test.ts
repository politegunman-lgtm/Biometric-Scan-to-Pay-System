import test from "node:test";
import assert from "node:assert/strict";
import { buildSeed } from "../src/lib/seed";
import {
  enrolMerchant,
  linkWallet,
  normaliseCameroonMsisdn,
  recipientsOf,
  setPrimaryWallet,
} from "../src/lib/accounts";
import { searchDirectory } from "../src/lib/directory";
import { checkPortalPin, merchantByCode } from "../src/lib/portal";
import type { Database } from "../src/lib/store";

/**
 * Account-side property checks: wallet switching, wallet linking and business
 * enrolment. They run against a fresh in-memory seed, so no file store or
 * server is involved.
 */

function freshDb(): Database {
  const db = buildSeed() as unknown as Database;
  // buildSeed returns the persisted shape; the secret block is created by the
  // store, so borrow the pieces the account functions read.
  db.user = { ...db.user };
  return db;
}

test("exactly one wallet is primary after every switch", () => {
  const db = freshDb();
  for (const wallet of [...db.wallets].reverse()) {
    const result = setPrimaryWallet(db, wallet.id);
    assert.equal(result.primaryWalletId, wallet.id);
    assert.equal(db.wallets.filter((w) => w.primary).length, 1);
    assert.equal(db.wallets.find((w) => w.primary)!.id, wallet.id);
  }
  // Re-selecting the current default is a no-op, not a second primary.
  const current = db.wallets.find((w) => w.primary)!;
  const again = setPrimaryWallet(db, current.id);
  assert.equal(again.changed, false);
  assert.equal(db.wallets.filter((w) => w.primary).length, 1);
});

test("an unknown or inactive wallet cannot become primary", () => {
  const db = freshDb();
  assert.throws(() => setPrimaryWallet(db, "wal_does_not_exist"), /not found/i);
  db.wallets[1].status = "frozen";
  assert.throws(() => setPrimaryWallet(db, db.wallets[1].id), /frozen/i);
});

test("Cameroonian numbers normalise, junk is rejected", () => {
  const good = ["6 77 41 22 08", "677412208", "+237 677 412 208", "237677412208"];
  for (const raw of good) assert.equal(normaliseCameroonMsisdn(raw), "+237677412208", raw);
  for (const bad of ["", "12345", "712345678", "+237 7 12 34 56 78", "abc"]) {
    assert.equal(normaliseCameroonMsisdn(bad), null, bad);
  }
});

test("linking a wallet never duplicates a number and only adds one account", () => {
  const db = freshDb();
  const before = db.wallets.length;
  const { wallet } = linkWallet(db, { provider: "express-union", msisdn: "6 55 77 88 99" });
  assert.equal(db.wallets.length, before + 1);
  assert.equal(wallet.primary, false);
  assert.match(wallet.msisdn, /^\+237 6 55 77 88 99$/);

  assert.throws(() => linkWallet(db, { provider: "mtn-momo", msisdn: "+237 655 77 88 99" }), /already linked/i);
  assert.throws(() => linkWallet(db, { provider: "not-a-provider", msisdn: "655778899" }), /MTN|Orange|Express/i);
});

test("an enrolled business is searchable, masked and payable", () => {
  const db = freshDb();
  const { merchant } = enrolMerchant(db, {
    name: "Nkoldongo Pharmacy",
    type: "hospital",
    city: "Yaoundé",
    area: "Nkoldongo",
    phone: "6 90 11 22 33",
    about: "Pharmacy & consultation",
    pin: "4321",
    pinConfirm: "4321",
  });

  const stored = db.merchants.find((m) => m.id === merchant.id)!;
  assert.equal(stored.kind, "service");
  assert.equal(stored.category, "health");
  assert.equal(stored.verified, false);
  assert.ok(stored.enrolledAt, "enrolment timestamp recorded");

  const found = searchDirectory(db, "nkoldongo");
  const entry = found.services.find((s) => s.id === merchant.id);
  assert.ok(entry, "appears in the Bills directory");
  assert.equal(entry!.isNew, true);
  assert.ok(!entry!.msisdnMasked.includes("011223"), "full number is never exposed");
});

test("enrolment rejects duplicates, bad numbers and missing names", () => {
  const db = freshDb();
  assert.throws(() => enrolMerchant(db, { name: "", type: "shop", phone: "677000111" }), /2–48/);
  assert.throws(() => enrolMerchant(db, { name: "Shop", type: "shop", phone: "12345", pin: "1234" }), /phone number/i);
  assert.throws(() => enrolMerchant(db, { name: "Nope", type: "spaceship", phone: "677000111" }), /kind of business/i);
  // "ENEO" must collide with the seeded "ENEO Electricity".
  assert.throws(
    () => enrolMerchant(db, { name: "ENEO", type: "utility", phone: "677000222", pin: "1234" }),
    /already on Scan to Pay/i,
  );
  // Same name twice is a duplicate too.
  enrolMerchant(db, { name: "Boulangerie du Rond Point", type: "shop", phone: "677000333", pin: "1234" });
  assert.throws(
    () => enrolMerchant(db, { name: "boulangerie du rond point", type: "other", phone: "677000444", pin: "1234" }),
    /already on Scan to Pay/i,
  );
});

test("recipients aggregate only money that moved", () => {
  const db = freshDb();
  const rows = recipientsOf(db);
  assert.ok(rows.length > 0);
  const byId = new Map(rows.map((r) => [r.merchantId, r]));
  for (const txn of db.txns) {
    if (txn.status === "declined") assert.ok(!byId.has(txn.merchantId) || byId.get(txn.merchantId)!.spentXAF >= 0);
  }
  // Totals are internally consistent with the ledger.
  for (const row of rows) {
    const settled = db.txns.filter((t) => t.merchantId === row.merchantId && t.status === "settled");
    assert.equal(row.spentXAF, settled.reduce((s, t) => s + t.amountXAF, 0));
    assert.equal(row.payments, db.txns.filter((t) => t.merchantId === row.merchantId && t.status !== "declined").length);
  }
  // Sorted newest first.
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].lastPaidAt >= rows[i].lastPaidAt);
});

test("a school says which level it is, and the level picks the reason template", () => {
  const db = freshDb();
  assert.throws(
    () => enrolMerchant(db, { name: "École de Nkolbisson", type: "school", phone: "6 77 12 34 56", pin: "1234" }),
    /primary school, secondary school or university/i,
  );
  assert.throws(
    () =>
      enrolMerchant(db, {
        name: "École de Nkolbisson",
        type: "school",
        schoolLevel: "kindergarten",
        phone: "6 77 12 34 56",
        pin: "1234",
      }),
    /primary school, secondary school or university/i,
  );

  const uni = enrolMerchant(db, {
    name: "Institut Universitaire de Douala",
    type: "school",
    schoolLevel: "university",
    city: "Douala",
    phone: "6 77 22 33 44",
    pin: "1357",
  });
  const uniStored = db.merchants.find((m) => m.id === uni.merchant.id)!;
  assert.equal(uniStored.schoolLevel, "university");
  assert.ok(
    uniStored.paymentReasons?.some((r) => r.id === "tuition" && r.askFields?.includes("faculty")),
    "university starts with tuition-style reasons",
  );

  const primary = enrolMerchant(db, {
    name: "École Primaire de Bonabéri",
    type: "school",
    schoolLevel: "primary",
    city: "Douala",
    phone: "6 77 55 66 77",
    pin: "2468",
  });
  const primaryStored = db.merchants.find((m) => m.id === primary.merchant.id)!;
  assert.equal(primaryStored.schoolLevel, "primary");
  assert.ok(primaryStored.paymentReasons?.some((r) => r.askFields?.includes("class")));
  assert.ok(!primaryStored.paymentReasons?.some((r) => r.askFields?.includes("faculty")));
});

test("the system mints payee codes and never reuses one", () => {
  const db = freshDb();
  const seen = new Set(db.merchants.map((m) => m.code));
  const alphabet = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/;
  // Fresh numbers each time: enrolment refuses a number already on the network.
  const phone = () => `6 9${String(1000000 + Math.floor(Math.random() * 8999999)).slice(0, 7)}`;

  for (let i = 0; i < 40; i += 1) {
    const { merchant } = enrolMerchant(db, {
      name: `Test Business ${String(i).padStart(2, "0")}`,
      type: "shop",
      phone: phone(),
      pin: "1234",
    });
    assert.match(merchant.code, alphabet);
    assert.ok(!seen.has(merchant.code), `code ${merchant.code} was reused`);
    seen.add(merchant.code);
  }

  // A code that was issued before (even for a payee no longer listed) stays retired.
  const retired = db.merchants.at(-1)!.code;
  db.merchants = db.merchants.filter((m) => m.code !== retired);
  assert.ok(db.secrets.issuedCodes?.includes(retired));
  for (let i = 0; i < 30; i += 1) {
    const { merchant } = enrolMerchant(db, {
      name: `Another Shop ${String(i).padStart(2, "0")}`,
      type: "shop",
      phone: phone(),
      pin: "1234",
    });
    assert.notEqual(merchant.code, retired);
  }
});

test("the business chooses its own PIN and signs in with it", () => {
  const db = freshDb();
  assert.throws(
    () => enrolMerchant(db, { name: "No Pin Ltd", type: "shop", phone: "6 79 11 22 33" }),
    /4-digit access PIN/i,
  );
  assert.throws(
    () =>
      enrolMerchant(db, { name: "Bad Pin Ltd", type: "shop", phone: "6 79 11 22 33", pin: "12" }),
    /4-digit access PIN/i,
  );
  assert.throws(
    () =>
      enrolMerchant(db, {
        name: "Mismatch Ltd",
        type: "shop",
        phone: "6 79 11 22 33",
        pin: "1357",
        pinConfirm: "1358",
      }),
    /do not match/i,
  );

  const { merchant } = enrolMerchant(db, {
    name: "Boutique Essos",
    type: "shop",
    city: "Yaoundé",
    phone: "6 79 44 55 66",
    pin: "9081",
    pinConfirm: "9081",
  });
  const stored = db.merchants.find((m) => m.id === merchant.id)!;
  assert.ok(stored.portalPin, "PIN is stored as a hash");
  assert.ok(!JSON.stringify(stored.portalPin).includes("9081"), "plaintext PIN is never stored");

  const found = merchantByCode(db, merchant.code.toLowerCase());
  assert.equal(found?.id, merchant.id, "codes are matched case-insensitively");
  assert.equal(checkPortalPin(found!, "9081"), true);
  assert.equal(checkPortalPin(found!, "2468"), false, "the demo PIN does not open an enrolled payee");
});
