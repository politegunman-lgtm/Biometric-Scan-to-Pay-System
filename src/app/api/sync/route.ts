import { mutateDb, readDb } from "@/lib/store";
import { syncQueue } from "@/lib/service";
import { handleRoute, readBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/sync — settlement feed + queue snapshot. */
export function GET() {
  return handleRoute("sync:get", () => {
    const db = readDb();
    return {
      syncLog: db.syncLog,
      queue: db.queue,
      network: db.network,
      vault: db.vault,
      transport: db.network.tier,
    };
  });
}

/** POST /api/sync — flush signed offline vouchers. `{ replay: true }` runs the double-spend drill. */
export async function POST(req: Request) {
  const body = await readBody<{ replay?: boolean }>(req);
  return handleRoute("sync:post", () => mutateDb((db) => syncQueue(db, { replay: Boolean(body.replay) })));
}
