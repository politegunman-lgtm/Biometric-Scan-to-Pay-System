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
  assert.throws(() => enrolMerchant(db, { name: "Shop", type: "shop", phone: "12345" }), /phone number/i);
  assert.throws(() => enrolMerchant(db, { name: "Nope", type: "spaceship", phone: "677000111" }), /kind of business/i);
  // "ENEO" must collide with the seeded "ENEO Electricity".
  assert.throws(() => enrolMerchant(db, { name: "ENEO", type: "utility", phone: "677000222" }), /already on Scan to Pay/i);
  // Same name twice is a duplicate too.
  enrolMerchant(db, { name: "Boulangerie du Rond Point", type: "shop", phone: "677000333" });
  assert.throws(
    () => enrolMerchant(db, { name: "boulangerie du rond point", type: "other", phone: "677000444" }),
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
