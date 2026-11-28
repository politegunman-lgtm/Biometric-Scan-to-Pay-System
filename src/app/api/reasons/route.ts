import { mutateDb, readDb, pushAudit } from "@/lib/store";
import { normaliseReasons, reasonsFor } from "@/lib/reasons";
import { randomId } from "@/lib/crypto";
import { handleRoute, readBody } from "@/lib/http";
import type { PaymentReason } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reasons?merchantId=…  — the catalogue a payee publishes.
 * POST /api/reasons { merchantId, reasons[] } — replace it (business side).
 *
 * Only payees that customers can pay from the directory may publish reasons;
 * peers (person-to-person) cannot.
 */
export async function GET(req: Request) {
  return handleRoute("reasons:get", () => {
    const db = readDb();
    const merchantId = new URL(req.url).searchParams.get("merchantId") ?? "";
    const merchant = db.merchants.find((m) => m.id === merchantId);
    if (!merchant) throw new Error("Unknown payee");
    return {
      ok: true,
      merchant: { id: merchant.id, name: merchant.name, kind: merchant.kind, category: merchant.category, code: merchant.code },
      reasons: reasonsFor(merchant),
      customised: Boolean(merchant.paymentReasons),
      canCustomise: merchant.kind !== "person",
    };
  });
}

interface Body {
  merchantId?: string;
  reasons?: unknown;
}

export async function POST(req: Request) {
  const body = await readBody<Body>(req);
  return handleRoute("reasons:post", () =>
    mutateDb((db) => {
      const merchant = db.merchants.find((m) => m.id === String(body.merchantId ?? ""));
      if (!merchant) throw new Error("Unknown payee");
      if (merchant.kind === "person") throw new Error("People cannot publish payment reasons");

      const reasons: PaymentReason[] = normaliseReasons(body.reasons ?? []);
      merchant.paymentReasons = reasons;
      pushAudit(
        db,
        {
          actor: `merchant:${merchant.id}`,
          action: "merchant.reasons",
          detail: reasons.length ? `${merchant.name} publishes ${reasons.map((r) => r.label).join(", ")}` : `${merchant.name} cleared its payment reasons`,
          severity: "info",
        },
        randomId("aud"),
      );
      return { ok: true, reasons, message: reasons.length ? "Reasons saved" : "Reasons removed" };
    }),
  );
}
