import { mutateDb } from "@/lib/store";
import { updateSettings } from "@/lib/service";
import { handleRoute, readBody } from "@/lib/http";
import type { UserSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/settings — step-up threshold, offline caps, liveness, SMS fallback. */
export async function POST(req: Request) {
  const body = await readBody<Partial<UserSettings>>(req);
  return handleRoute("settings", () =>
    mutateDb((db) => {
      const settings = updateSettings(db, body);
      return { ok: true, settings, message: "Protection settings saved" };
    }),
  );
}
