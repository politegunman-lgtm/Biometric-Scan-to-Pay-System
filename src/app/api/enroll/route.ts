import { mutateDb, readDb } from "@/lib/store";
import { ENROL_TYPES, SCHOOL_LEVELS, cityOptions, enrolMerchant, type EnrolInput } from "@/lib/accounts";
import { handleRoute, readBody } from "@/lib/http";
import { toEntry } from "@/lib/directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/enroll — the form's vocabulary plus the newest payees. */
export async function GET() {
  return handleRoute("enroll", () => {
    const db = readDb();
    const newest = db.merchants
      .filter((m) => m.enrolledAt && m.kind !== "person")
      .sort((a, b) => (a.enrolledAt! < b.enrolledAt! ? 1 : -1))
      .slice(0, 6)
      .map(toEntry);
    return { ok: true, types: ENROL_TYPES, levels: SCHOOL_LEVELS, cities: cityOptions(), newest };
  });
}

/** POST /api/enroll — a business lists itself so customers can pay it in-app. */
export async function POST(req: Request) {
  const body = await readBody<EnrolInput>(req);
  return handleRoute("enroll", () => mutateDb((db) => ({ ok: true, ...enrolMerchant(db, body) })));
}
