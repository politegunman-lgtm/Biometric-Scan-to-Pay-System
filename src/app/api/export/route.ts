import { readDb } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/export — CSV ledger for the end user's own financial management. */
export function GET() {
  const db = readDb();
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
