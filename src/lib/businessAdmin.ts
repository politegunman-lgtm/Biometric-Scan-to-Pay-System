import { cityOptions, normaliseCameroonMsisdn } from "./accounts";
import { catalogueFitsLevel, cohortsFor, cohortsPublished, normaliseCohorts, type CohortCatalogue } from "./cohorts";
import { hashPin, randomId } from "./crypto";
import { pushAudit, type Database } from "./store";
import type { Merchant, SchoolLevel } from "./types";

/**
 * A business editing itself, and leaving the platform.
 *
 * Everything here is called with the merchant already resolved from the portal
 * token, so a payee can only ever change its own record. Edits are validated
 * server-side: the portal is a projection over the payee's own data, never a
 * back door into the directory.
 */

const MAX_NAME = 48;
const MAX_TAGLINE = 70;

export interface BusinessPatch {
  name?: unknown;
  tagline?: unknown;
  phone?: unknown;
  city?: unknown;
  schoolLevel?: unknown;
  cohorts?: unknown;
}

const fold = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function assertNameFree(db: Database, merchant: Merchant, name: string) {
  const wanted = fold(name);
  const clash = db.merchants.find((m) => {
    if (m.id === merchant.id || m.kind === "person") return false;
    const existing = fold(m.name);
    return existing === wanted || existing.includes(wanted) || wanted.includes(existing);
  });
  if (clash) throw new Error(`${clash.name} is already listed — pick a distinct name`);
}

/** Rename / retag / change level or cohort lists. Returns what the portal shows. */
export function updateBusiness(db: Database, merchant: Merchant, patch: BusinessPatch) {
  const changes: string[] = [];

  if (patch.name !== undefined) {
    const name = String(patch.name).trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > MAX_NAME) throw new Error(`Business name must be 2–${MAX_NAME} characters`);
    if (name !== merchant.name) {
      assertNameFree(db, merchant, name);
      merchant.name = name;
      changes.push("name");
    }
  }

  if (patch.tagline !== undefined) {
    const tagline = String(patch.tagline).trim().replace(/\s+/g, " ").slice(0, MAX_TAGLINE);
    if (tagline !== (merchant.tagline ?? "")) {
      merchant.tagline = tagline || undefined;
      changes.push("tagline");
    }
  }

  if (patch.phone !== undefined) {
    const msisdn = normaliseCameroonMsisdn(String(patch.phone));
    if (!msisdn) throw new Error("Enter a Cameroonian mobile number, e.g. 6 55 10 02 00");
    if (msisdn !== merchant.msisdn) {
      const holder = db.merchants.find(
        (m) => m.id !== merchant.id && m.msisdn.replace(/\D/g, "") === msisdn.replace(/\D/g, ""),
      );
      if (holder) throw new Error(`${holder.name} already uses that number`);
      merchant.msisdn = msisdn;
      merchant.ownerMsisdn = msisdn;
      changes.push("phone");
    }
  }

  if (patch.city !== undefined) {
    const city = cityOptions().find((c) => c.toLowerCase() === String(patch.city).trim().toLowerCase());
    if (!city) throw new Error(`Choose a city: ${cityOptions().join(", ")}`);
    if (city !== merchant.geo.city) {
      merchant.geo = { ...merchant.geo, city };
      changes.push("city");
    }
  }

  if (patch.schoolLevel !== undefined) {
    const level = String(patch.schoolLevel) as SchoolLevel;
    if (!["primary", "secondary", "university"].includes(level)) {
      throw new Error("Say whether this is a primary school, secondary school or university");
    }
    if (merchant.category !== "education") throw new Error("Only education payees have a school level");
    if (level !== merchant.schoolLevel) {
      merchant.schoolLevel = level;
      changes.push("school level");
      // A catalogue that no longer fits the level would offer classes to a
      // university (or faculties to a primary school); trim it.
      if (merchant.cohorts) merchant.cohorts = catalogueFitsLevel(merchant.cohorts, level);
    }
  }

  if (patch.cohorts !== undefined) {
    if (merchant.category !== "education") throw new Error("Cohort lists are for schools and universities");
    const catalogue = catalogueFitsLevel(normaliseCohorts(patch.cohorts), merchant.schoolLevel);
    if (merchant.schoolLevel === "university" && catalogue.faculties.length === 0) {
      throw new Error("Add at least one faculty so payers have something to choose");
    }
    merchant.cohorts = catalogue;
    changes.push("cohort lists");
  }

  if (changes.length > 0) {
    pushAudit(
      db,
      {
        actor: `merchant:${merchant.id}`,
        action: "merchant.settings",
        detail: `${merchant.name} updated ${changes.join(", ")}`,
        severity: "info",
      },
      randomId("aud"),
    );
  }

  return businessProfile(merchant);
}

/** What the portal's settings form loads. */
export function businessProfile(merchant: Merchant) {
  return {
    id: merchant.id,
    name: merchant.name,
    code: merchant.code,
    tagline: merchant.tagline ?? "",
    phone: merchant.msisdn,
    city: merchant.geo.city,
    category: merchant.category,
    schoolLevel: merchant.schoolLevel ?? null,
    cohorts: cohortsFor(merchant),
    cohortsPublished: cohortsPublished(merchant),
    closedAt: merchant.closedAt ?? null,
    verified: merchant.verified,
  };
}

/** Stop taking payments, keep every receipt. Reversible. */
export function closeListing(db: Database, merchant: Merchant) {
  if (merchant.closedAt) throw new Error(`${merchant.name} is already closed`);
  merchant.closedAt = new Date().toISOString();
  // Open, unpaid requests must not stay payable after the listing closes.
  let cancelled = 0;
  for (const request of db.requests) {
    if (request.merchantId === merchant.id && request.status === "open") {
      request.status = "cancelled";
      cancelled += 1;
    }
  }
  pushAudit(
    db,
    {
      actor: `merchant:${merchant.id}`,
      action: "merchant.close",
      detail: `${merchant.name} closed its listing${cancelled ? ` · ${cancelled} open request(s) cancelled` : ""}`,
      severity: "warning",
    },
    randomId("aud"),
  );
  return { closedAt: merchant.closedAt, cancelled, message: `${merchant.name} is no longer payable` };
}

export function reopenListing(db: Database, merchant: Merchant) {
  if (!merchant.closedAt) throw new Error(`${merchant.name} is already open`);
  merchant.closedAt = null;
  pushAudit(
    db,
    {
      actor: `merchant:${merchant.id}`,
      action: "merchant.reopen",
      detail: `${merchant.name} reopened its listing`,
      severity: "info",
    },
    randomId("aud"),
  );
  return { message: `${merchant.name} is payable again` };
}

/**
 * Remove the payee from the platform. Receipts and history stay: they carry
 * their own snapshot of the merchant name and code, so a customer's past
 * payments remain readable after the business leaves.
 */
export function deleteListing(db: Database, merchant: Merchant, confirm?: unknown) {
  const typed = String(confirm ?? "").trim();
  if (typed.toLowerCase() !== merchant.name.toLowerCase()) {
    throw new Error(`Type "${merchant.name}" to confirm deletion`);
  }
  const history = db.txns.filter((t) => t.merchantId === merchant.id).length;
  for (const request of db.requests) {
    if (request.merchantId === merchant.id && request.status === "open") request.status = "cancelled";
  }
  db.merchants = db.merchants.filter((m) => m.id !== merchant.id);
  pushAudit(
    db,
    {
      actor: `merchant:${merchant.id}`,
      action: "merchant.delete",
      detail: `${merchant.name} deleted from the platform · ${history} receipt(s) kept in customer history`,
      severity: "warning",
    },
    randomId("aud"),
  );
  return {
    deleted: true,
    receiptsKept: history,
    message: `${merchant.name} was deleted. ${history} past receipt(s) stay in customers' history.`,
  };
}

/** Rotate the portal PIN from inside the portal (the business already signed in). */
export function rotatePortalPin(db: Database, merchant: Merchant, pin: unknown) {
  const value = String(pin ?? "");
  if (!/^\d{4}$/.test(value)) throw new Error("Access PIN must be 4 digits");
  merchant.portalPin = hashPin(value);
  pushAudit(
    db,
    {
      actor: `merchant:${merchant.id}`,
      action: "merchant.pin",
      detail: `${merchant.name} changed its portal PIN`,
      severity: "info",
    },
    randomId("aud"),
  );
  return { message: "PIN updated — use it next time you sign in" };
}
