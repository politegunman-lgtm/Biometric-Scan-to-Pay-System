import type { ProviderAdapter, ProviderId } from "./types";

/**
 * Mobile-money provider adapters.
 *
 * MTN MoMo is implemented against the shape of the real MoMo Open API
 * (Collections: requestToPay → status poll, with X-Reference-Id as the
 * idempotency key). The sandbox adapter here runs in-process so the demo works
 * without operator credentials, but the interface is the integration contract:
 * swap `mockNetwork` for `fetch("https://proxy.momoapi.mtn.com/collection/v1_0/requesttopay")`
 * and nothing above this layer changes.
 *
 * Adding Orange Money or Express Union is a new adapter + a wallet row, which is
 * the point: the biometric + fraud + offline layers are operator-independent.
 */

export interface ChargeInput {
  msisdn: string;
  amountXAF: number;
  reference: string;
  idempotencyKey: string;
}

export interface ChargeResult {
  ok: boolean;
  operatorRef: string;
  balanceAfterXAF: number;
}

const idempotencyCache = new Map<string, ChargeResult>();

function operatorRefFor(idempotencyKey: string) {
  return `MP${new Date().getFullYear()}${idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(-10).toUpperCase()}`;
}

function simulateCharge(operator: string, input: ChargeInput, balanceXAF: number): ChargeResult {
  const cached = idempotencyCache.get(input.idempotencyKey);
  if (cached) return cached; // replay-safe: the operator returns the original result
  const ok = input.amountXAF <= balanceXAF;
  const result: ChargeResult = {
    ok,
    operatorRef: `${operator}-${operatorRefFor(input.idempotencyKey)}`,
    balanceAfterXAF: ok ? balanceXAF - input.amountXAF : balanceXAF,
  };
  idempotencyCache.set(input.idempotencyKey, result);
  return result;
}

/**
 * Sandbox balances are owned by the store, so adapters receive a live balance
 * through a closure set by the service layer at call time.
 */
let balanceResolver: (provider: ProviderId) => number = () => 0;
export function bindBalanceResolver(fn: (provider: ProviderId) => number) {
  balanceResolver = fn;
}

export const mtnMomo: ProviderAdapter = {
  id: "mtn-momo",
  name: "MTN Mobile Money",
  shortName: "MoMo",
  accent: "#FFCB05",
  async charge(input) {
    return simulateCharge("MP", input, balanceResolver("mtn-momo"));
  },
  async reverse(input) {
    return { ok: input.amountXAF > 0 };
  },
};

export const orangeMoney: ProviderAdapter = {
  id: "orange-money",
  name: "Orange Money",
  shortName: "OM",
  accent: "#FF7900",
  async charge(input) {
    return simulateCharge("OM", input, balanceResolver("orange-money"));
  },
  async reverse() {
    return { ok: true };
  },
};

export const expressUnion: ProviderAdapter = {
  id: "express-union",
  name: "Express Union Mobile",
  shortName: "EU",
  accent: "#38BDF8",
  async charge(input) {
    return simulateCharge("EU", input, balanceResolver("express-union"));
  },
  async reverse() {
    return { ok: true };
  },
};

export const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  "mtn-momo": mtnMomo,
  "orange-money": orangeMoney,
  "express-union": expressUnion,
};

export const PROVIDER_META: Record<ProviderId, { name: string; shortName: string; accent: string }> = {
  "mtn-momo": { name: "MTN Mobile Money", shortName: "MoMo", accent: "#FFCB05" },
  "orange-money": { name: "Orange Money", shortName: "OM", accent: "#FF7900" },
  "express-union": { name: "Express Union Mobile", shortName: "EU", accent: "#38BDF8" },
};
