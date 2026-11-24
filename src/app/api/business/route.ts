import {
  businessProfile,
  closeListing,
  deleteListing,
  reopenListing,
  rotatePortalPin,
  updateBusiness,
  type BusinessPatch,
} from "@/lib/businessAdmin";
import { mutateDb } from "@/lib/store";
import { checkPortalPin, issuePortalToken, merchantByCode, portalView, readPortalToken, type PortalFilters } from "@/lib/portal";
import { handleRoute, readBody } from "@/lib/http";
import type { PayerField } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SignInBody {
  code?: string;
  pin?: string;
}

/**
 * GET /api/business — the two seeded demo logins, so the portal page can show
 * how to get in without leaking every payee's code. Real integrations would
 * email the code to the registered number instead.
 */
export function GET() {
  return handleRoute("business:get", () =>
    mutateDb((db) => ({
      ok: true,
      demo: db.merchants
        .filter((m) => ["svc_lycee", "svc_uy1", "svc_eneo"].includes(m.id))
        .map((m) => ({ id: m.id, name: m.name, code: m.code, category: m.category })),
    })),
  );
}

/**
 * POST /api/business — every action is scoped to the payee the token names:
 *   { code, pin }                  sign in, returns a scoped 8-hour token
 *   { action:"data", token, filters }  read this payee's records
 *   { action:"settings", token, patch } edit the business, its level and its cohort lists
 *   { action:"pin", token, pin }   rotate the access PIN
 *   { action:"close" | "reopen", token }  pause / resume taking payments
 *   { action:"delete", token, confirm }   remove the listing (receipts are kept)
 */
export async function POST(req: Request) {
  const body = await readBody<{
    action?: "signin" | "data" | "settings" | "pin" | "close" | "reopen" | "delete";
    code?: string;
    pin?: string;
    token?: string;
    filters?: PortalFilters;
    patch?: BusinessPatch;
    confirm?: string;
  }>(req);

  return handleRoute("business:post", () =>
    mutateDb((db) => {
      // Everything below reads the payee from the token, never from the body.
      const scoped = () => {
        const merchantId = readPortalToken(db, body.token);
        if (!merchantId) throw new Error("Your portal session expired — sign in again");
        const merchant = db.merchants.find((m) => m.id === merchantId);
        if (!merchant) throw new Error("Payee no longer listed");
        return merchant;
      };

      if (body.action === "settings") {
        const merchant = scoped();
        const profile = updateBusiness(db, merchant, body.patch ?? {});
        return { ok: true, profile, message: "Business details updated" };
      }
      if (body.action === "pin") {
        const merchant = scoped();
        return { ok: true, ...rotatePortalPin(db, merchant, body.pin) };
      }
      if (body.action === "close") {
        const merchant = scoped();
        const result = closeListing(db, merchant);
        return { ok: true, ...result, profile: businessProfile(merchant) };
      }
      if (body.action === "reopen") {
        const merchant = scoped();
        const result = reopenListing(db, merchant);
        return { ok: true, ...result, profile: businessProfile(merchant) };
      }
      if (body.action === "delete") {
        const merchant = scoped();
        const result = deleteListing(db, merchant, body.confirm);
        return { ok: true, ...result };
      }

      if (body.action === "data") {
        const merchantId = readPortalToken(db, body.token);
        if (!merchantId) throw new Error("Your portal session expired — sign in again");
        const merchant = db.merchants.find((m) => m.id === merchantId);
        if (!merchant) throw new Error("Payee no longer listed");
        const filters = body.filters ?? {};
        const clean: PortalFilters = {
          q: typeof filters.q === "string" ? filters.q.slice(0, 60) : undefined,
          reason: typeof filters.reason === "string" ? filters.reason : undefined,
          status: typeof filters.status === "string" ? filters.status : undefined,
          field: (filters.field as PayerField | "any") ?? "any",
          value: typeof filters.value === "string" ? filters.value : undefined,
          groupBy: filters.groupBy ?? "reason",
          from: typeof filters.from === "string" ? filters.from : undefined,
          to: typeof filters.to === "string" ? filters.to : undefined,
        };
        return portalView(db, merchant, clean);
      }

      const merchant = merchantByCode(db, String(body.code ?? ""));
      if (!merchant) throw new Error("No payee uses that code");
      if (!/^\d{4}$/.test(String(body.pin ?? ""))) throw new Error("Access PIN must be 4 digits");
      if (!checkPortalPin(merchant, String(body.pin))) throw new Error("Wrong access PIN for that payee");

      const { token, expiresAt } = issuePortalToken(db, merchant.id);
      return {
        ok: true,
        token,
        expiresAt,
        message: `Signed in as ${merchant.name}`,
        payee: { id: merchant.id, name: merchant.name, code: merchant.code, city: merchant.geo.city },
      };
    }),
  );
}
