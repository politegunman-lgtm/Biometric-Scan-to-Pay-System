import { mutateDb } from "@/lib/store";
import { resolveAlert, simulateScenario } from "@/lib/service";
import { fail, handleRoute, readBody } from "@/lib/http";
import type { FraudAlert } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  scenario?: string;
  alertId?: string;
  status?: FraudAlert["status"];
}

/** POST /api/fraud — dry-run a fraud scenario through the live engine. */
export async function POST(req: Request) {
  const body = await readBody<Body>(req);
  if (!body.scenario) return fail("scenario required", 422);
  return handleRoute("fraud:post", () => mutateDb((db) => simulateScenario(db, body.scenario!)));
}

/** PATCH /api/fraud — close or dismiss an alert (feeds the outcome back into tuning). */
export async function PATCH(req: Request) {
  const body = await readBody<Body>(req);
  if (!body.alertId || !body.status) return fail("alertId and status required", 422);
  return handleRoute("fraud:patch", () =>
    mutateDb((db) => {
      const alert = resolveAlert(db, body.alertId!, body.status!);
      return { ok: true, alert, message: `Alert marked ${body.status}` };
    }),
  );
}
