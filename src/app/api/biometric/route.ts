import { mutateDb, readDb } from "@/lib/store";
import { enrollFinger, removeFinger, setPin, verifyBiometricOnly } from "@/lib/service";
import { fail, handleRoute, readBody } from "@/lib/http";
import type { LivenessProof } from "@/lib/biometrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  action: "enroll" | "verify" | "remove" | "pin" | "reset-lockout";
  fingerId?: string;
  label?: string;
  sample?: number[];
  quality?: number;
  liveness?: LivenessProof;
  pin?: string;
}

/** GET /api/biometric — enrollment metadata (templates stay sealed server-side). */
export function GET() {
  return handleRoute("biometric:get", () => {
    const db = readDb();
    return {
      biometric: {
        ...db.biometric,
        fingers: db.biometric.fingers.map((f) => ({ ...f, sealedTemplate: "[sealed]" })),
      },
      pinSet: db.user.pinSet,
      sensorSeed: db.secrets.sensorSeed,
    };
  });
}

export async function POST(req: Request) {
  const body = await readBody<Body>(req);
  if (!body.action) return fail("action required", 422);

  return handleRoute("biometric:post", () =>
    mutateDb((db) => {
      switch (body.action) {
        case "enroll": {
          if (!body.sample) throw new Error("Template capture required");
          const biometric = enrollFinger(db, {
            fingerId: body.fingerId ?? "right-index",
            label: body.label ?? "Fingerprint",
            sample: body.sample,
            quality: body.quality,
          });
          return {
            ok: true,
            message: `${body.label ?? "Fingerprint"} enrolled — template sealed locally, raw scan discarded`,
            biometric: {
              ...biometric,
              fingers: biometric.fingers.map((f) => ({ ...f, sealedTemplate: "[sealed]" })),
            },
          };
        }
        case "verify": {
          const result = verifyBiometricOnly(db, {
            fingerId: body.fingerId,
            sample: body.sample,
            liveness: body.liveness,
          });
          return { ok: result.matched, ...result };
        }
        case "remove": {
          if (!body.fingerId) throw new Error("fingerId required");
          const biometric = removeFinger(db, body.fingerId);
          return {
            ok: true,
            message: "Template deleted from sealed storage",
            biometric: {
              ...biometric,
              fingers: biometric.fingers.map((f) => ({ ...f, sealedTemplate: "[sealed]" })),
            },
          };
        }
        case "pin": {
          const res = setPin(db, body.pin ?? "");
          return { ...res, message: "PIN updated" };
        }
        case "reset-lockout": {
          db.biometric.failedAttempts = 0;
          db.biometric.lockedUntil = null;
          return { ok: true, message: "Matcher unlocked" };
        }
        default:
          throw new Error(`Unknown action ${body.action}`);
      }
    }),
  );
}
