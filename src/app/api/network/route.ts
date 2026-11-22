import { mutateDb } from "@/lib/store";
import { setNetworkTier } from "@/lib/service";
import { fail, handleRoute, readBody } from "@/lib/http";
import { TRANSPORT_LADDER } from "@/lib/transport";
import type { NetworkTier } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIERS = Object.keys(TRANSPORT_LADDER) as NetworkTier[];

/** POST /api/network — drive the simulated radio profile. */
export async function POST(req: Request) {
  const body = await readBody<{ tier?: NetworkTier }>(req);
  if (!body.tier || !TIERS.includes(body.tier)) {
    return fail(`tier must be one of ${TIERS.join(", ")}`, 422);
  }
  return handleRoute("network", () => mutateDb((db) => ({ network: setNetworkTier(db, body.tier!) })));
}
