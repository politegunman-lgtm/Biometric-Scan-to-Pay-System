import os from "node:os";
import { mutateDb } from "@/lib/store";
import { createPaymentRequest, ensureOpenRequests } from "@/lib/service";
import { fail, handleRoute, readBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The address a phone can actually reach.
 *
 * The terminal usually runs on the merchant's computer at localhost, so a QR
 * built from `location.origin` would point at the phone's own loopback. When
 * the request arrives over loopback we substitute the machine's LAN address;
 * behind a proxy we keep whatever host the browser used.
 */
function phoneOrigin(req: Request): string {
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const hostname = host.split(":")[0];
  const loopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  if (!loopback) return `${proto}://${host}`;

  const addresses: string[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      if (info.address.startsWith("169.254.")) continue;
      addresses.push(info.address);
    }
  }
  const lan =
    addresses.find((a) => a.startsWith("192.168.")) ??
    addresses.find((a) => a.startsWith("10.")) ??
    addresses.find((a) => !/^172\.(1[6-9]|2\d|3[01])\./.test(a)) ??
    addresses[0];
  const port = host.split(":")[1] ?? "3000";
  return lan ? `${proto}://${lan}:${port}` : `${proto}://${host}`;
}

interface Body {
  action?: "create" | "cancel";
  merchantId?: string;
  amountXAF?: number;
  note?: string;
  ttlMinutes?: number;
  requestId?: string;
  reasonId?: string;
  payerFor?: string;
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
        reasonId: body.reasonId,
        payerFor: body.payerFor,
      });
      const origin = phoneOrigin(req);
      return {
        ok: true,
        request,
        // Deep link the merchant's QR encodes: scanning it with a phone camera
        // opens this exact request inside the app.
        phoneUrl: `${origin}/scan?req=${encodeURIComponent(request.id)}`,
        message: `Request ${request.ref} live for 20 minutes`,
      };
    }),
  );
}
