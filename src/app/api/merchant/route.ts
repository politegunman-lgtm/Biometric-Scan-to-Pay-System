import { mutateDb } from "@/lib/store";
import { createPaymentRequest, ensureOpenRequests } from "@/lib/service";
import { fail, handleRoute, readBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  action?: "create" | "cancel";
  merchantId?: string;
  amountXAF?: number;
  note?: string;
  ttlMinutes?: number;
  requestId?: string;
}

/** GET /api/merchant — merchant terminal view: open requests + today's takings. */
export function GET() {
  return handleRoute("merchant:get", () =>
    mutateDb((db) => {
    ensureOpenRequests(db);
    const today = new Date().toISOString().slice(0, 10);
    const todayTxns = db.txns.filter(
      (t) => t.createdAt.slice(0, 10) === today && (t.status === "settled" || t.status === "queued"),
    );
    return {
      merchants: db.merchants,
      requests: db.requests.filter((r) => r.status === "open" || r.status === "paid").slice(0, 12),
      today: {
        count: todayTxns.length,
        volumeXAF: todayTxns.reduce((s, t) => s + t.amountXAF, 0),
        pendingXAF: db.txns
          .filter((t) => t.status === "queued")
          .reduce((s, t) => s + t.amountXAF, 0),
      },
      recent: todayTxns.slice(0, 8),
      network: db.network,
    };
  }));
}

/** POST /api/merchant — mint a signed payment request (the QR the phone scans). */
export async function POST(req: Request) {
  const body = await readBody<Body>(req);
  return handleRoute("merchant:post", () =>
    mutateDb((db) => {
      ensureOpenRequests(db);
      if (body.action === "cancel" && body.requestId) {
        const request = db.requests.find((r) => r.id === body.requestId);
        if (!request) return fail("Request not found", 404);
        request.status = "cancelled";
        return { ok: true, message: "Request cancelled" };
      }
      if (!body.merchantId) throw new Error("merchantId required");
      const request = createPaymentRequest(db, {
        merchantId: body.merchantId,
        amountXAF: Number(body.amountXAF ?? 0),
        note: body.note,
        ttlMinutes: body.ttlMinutes,
      });
      return { ok: true, request, message: `Request ${request.ref} live for 20 minutes` };
    }),
  );
}
