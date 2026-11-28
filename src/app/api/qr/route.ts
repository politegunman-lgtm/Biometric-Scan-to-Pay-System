import QRCode from "qrcode";

export const runtime = "nodejs";

/**
 * GET /api/qr?data=... → SVG QR. Merchant terminals render the signed payment
 * request payload as a real QR; the phone scans/receives it and posts it back
 * for signature verification before a single cedi moves.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const data = url.searchParams.get("data") ?? "";
  if (!data || data.length > 1200) {
    return new Response("data parameter required (max 1200 chars)", { status: 400 });
  }
  const svg = await QRCode.toString(data, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#0B0D0F", light: "#FFFFFF" },
  });
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=300",
    },
  });
}
