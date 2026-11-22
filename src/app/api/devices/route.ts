import { mutateDb } from "@/lib/store";
import { trustDevice } from "@/lib/service";
import { fail, handleRoute, readBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/devices — trust or revoke a paired device (revoking kills its vouchers). */
export async function POST(req: Request) {
  const body = await readBody<{ deviceId?: string; trusted?: boolean }>(req);
  if (!body.deviceId || typeof body.trusted !== "boolean") {
    return fail("deviceId and trusted required", 422);
  }
  return handleRoute("devices", () =>
    mutateDb((db) => {
      const device = trustDevice(db, body.deviceId!, body.trusted!);
      return {
        ok: true,
        device,
        message: device.trusted
          ? `${device.label} trusted for payments`
          : `${device.label} revoked — offline vouchers from it will be rejected`,
      };
    }),
  );
}
