import { resetDb, readDb } from "@/lib/store";
import { handleRoute } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Demo plumbing — not part of the product surface.
 * The simulated capacitive sensor derives its enrolment template from a device
 * secret. In a real handset that secret lives in StrongBox / the Secure Enclave
 * and never reaches JavaScript; here the simulator needs it to produce a
 * matching capture. Clearly labelled so nobody mistakes it for production auth.
 */
export function GET() {
  return handleRoute("demo:get", () => {
    const db = readDb();
    return {
      sensorSeed: db.secrets.sensorSeed,
      mode: "simulated-sensor",
      note: "Demo sensor seed. Production replaces this with Android BiometricPrompt / iOS LocalAuthentication.",
      seededAt: db.seededAt,
    };
  });
}

/** POST /api/demo — reseed the whole environment (90 days of history). */
export function POST() {
  return handleRoute("demo:reset", () => {
    resetDb();
    return { ok: true, message: "Demo environment reseeded" };
  });
}
