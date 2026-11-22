import { mutateDb } from "@/lib/store";
import { buildAppState } from "@/lib/service";
import { handleRoute } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Full client bootstrap: profile, wallets, history, queue, risk feed, network. */
export function GET() {
  return handleRoute("state", () => mutateDb((db) => buildAppState(db)));
}
