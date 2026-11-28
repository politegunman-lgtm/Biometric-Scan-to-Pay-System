import { mutateDb } from "@/lib/store";
import { authorizePayment } from "@/lib/service";
import { fail, handleRoute, readBody } from "@/lib/http";
import type { PayInput } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/pay — authorize a payment.
 * Body: PayInput (request id or merchant + amount, biometric sample + liveness
 * telemetry, device id, optional offline flag and step-up PIN).
 */
export async function POST(req: Request) {
  const body = await readBody<PayInput>(req);
  if (!body.requestId && !body.merchantId) {
    return fail("Provide requestId or merchantId", 422);
  }
  if (!body.sample || !Array.isArray(body.sample)) {
    return fail("Biometric sample missing", 422);
  }
  return handleRoute("pay", async () => {
    const outcome = await mutateDb((db) => authorizePayment(db, body));
    return outcome;
  });
}
