import { readDb } from "@/lib/store";
import { recipientsCsv, recipientsOf } from "@/lib/accounts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/export — CSV for the end user's own records.
 *   ?type=ledger      every payment (default)
 *   ?type=recipients  who you paid, how often and how much
 */
export function GET(req: Request) {
  const db = readDb();
  const dataset = new URL(req.url).searchParams.get("type") ?? "ledger";

  if (dataset === "recipients") {
    const csv = recipientsCsv(recipientsOf(db));
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="scan-to-pay-recipients-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  const header = [
    "receipt",
    "created_at",
    "merchant",
    "merchant_code",
    "category",
    "amount_xaf",
    "status",
    "channel",
    "offline",
    "provider",
    "risk_score",
    "risk_decision",
    "biometric_score",
    "city",
    "reason",
    "paid_for",
  ];
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = db.txns.map((t) =>
    [
      t.receiptNo,
      t.createdAt,
      t.merchantName,
      t.merchantCode,
      t.category,
      t.amountXAF,
      t.status,
      t.channel,
      t.offline ? "yes" : "no",
      t.provider,
      t.risk.score,
      t.risk.decision,
      t.auth.matchScore,
      t.geo.city,
      t.reason ?? "",
      t.payerFor ?? "",
    ]
      .map(escape)
      .join(","),
  );
  const csv = [header.join(","), ...rows].join("\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="biometric-scan-to-pay-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
