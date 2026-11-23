import { mutateDb, readDb } from "@/lib/store";
import { linkWallet, setPrimaryWallet, walletPublic } from "@/lib/accounts";
import { handleRoute, readBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/wallets — linked provider accounts. */
export async function GET() {
  return handleRoute("wallets", () => {
    const db = readDb();
    return { ok: true, wallets: db.wallets.map(walletPublic) };
  });
}

interface WalletAction {
  action?: "primary" | "link";
  walletId?: string;
  provider?: string;
  msisdn?: string;
}

/**
 * POST /api/wallets — two account-side actions:
 *   { action: "primary", walletId }   choose the default funding wallet
 *   { action: "link", provider, msisdn } link another provider account
 */
export async function POST(req: Request) {
  const body = await readBody<WalletAction>(req);
  return handleRoute("wallets", () =>
    mutateDb((db) => {
      if (body.action === "primary") {
        const result = setPrimaryWallet(db, String(body.walletId ?? ""));
        return {
          ok: true,
          ...result,
          message: result.changed ? "Default wallet updated" : "That wallet already pays by default",
        };
      }
      if (body.action === "link") {
        const result = linkWallet(db, { provider: body.provider, msisdn: body.msisdn });
        return { ok: true, ...result, message: `${result.wallet.providerName} linked` };
      }
      throw new Error("Unknown wallet action");
    }),
  );
}
