import { readDb } from "@/lib/store";
import { fail, handleRoute, readBody } from "@/lib/http";
import { matchContacts, searchDirectory, selfEntry } from "@/lib/directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Payee directory.
 *
 * GET  /api/directory?q=chant          → people + services matching a name or number
 * POST /api/directory { numbers: [] }  → which contact numbers are on the platform
 */
export function GET(req: Request) {
  return handleRoute("directory:get", () => {
    const db = readDb();
    const q = new URL(req.url).searchParams.get("q") ?? "";
    return { ok: true, query: q, ...searchDirectory(db, q), me: selfEntry(db) };
  });
}

export async function POST(req: Request) {
  const body = await readBody<{ numbers?: string[] }>(req);
  if (!Array.isArray(body.numbers)) return fail("numbers[] required", 422);
  return handleRoute("directory:contacts", () => {
    const db = readDb();
    return { ok: true, ...matchContacts(db, body.numbers!) };
  });
}
