import { readDb } from "@/lib/store";
import { portalCsv, portalView, readPortalToken, type PortalFilters } from "@/lib/portal";
import { fail } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/business/export?token=…&q=…&reason=… — the current view as CSV. */
export function GET(req: Request) {
  const db = readDb();
  const url = new URL(req.url);
  const merchantId = readPortalToken(db, url.searchParams.get("token"));
  if (!merchantId) return fail("Your portal session expired — sign in again", 401);
  const merchant = db.merchants.find((m) => m.id === merchantId);
  if (!merchant) return fail("Payee no longer listed", 404);

  const filters: PortalFilters = {
    q: url.searchParams.get("q") ?? undefined,
    reason: url.searchParams.get("reason") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    field: (url.searchParams.get("field") as PortalFilters["field"]) ?? "any",
    value: url.searchParams.get("value") ?? undefined,
    groupBy: (url.searchParams.get("groupBy") as PortalFilters["groupBy"]) ?? "reason",
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  };
  const csv = portalCsv(portalView(db, merchant, filters));
  const slug = merchant.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${slug || "payments"}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
