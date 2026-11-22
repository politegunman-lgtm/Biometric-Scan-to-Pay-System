import type { DashboardStats, MerchantCategory, Txn } from "./types";
import { CATEGORY_META } from "./format";

const DAY = 86_400_000;

export function computeStats(txns: Txn[], now = Date.now()): DashboardStats {
  const windowStart = now - 30 * DAY;
  const in30 = txns.filter((t) => new Date(t.createdAt).getTime() >= windowStart);
  const counted = in30.filter((t) => t.status === "settled" || t.status === "queued");
  const spend = counted.reduce((s, t) => s + t.amountXAF, 0);
  const declined = in30.filter((t) => t.status === "declined");

  const catMap = new Map<MerchantCategory, { amountXAF: number; count: number }>();
  counted.forEach((t) => {
    const cur = catMap.get(t.category) ?? { amountXAF: 0, count: 0 };
    cur.amountXAF += t.amountXAF;
    cur.count += 1;
    catMap.set(t.category, cur);
  });
  const topCategories = [...catMap.entries()]
    .map(([category, v]) => ({ category, label: CATEGORY_META[category].label, ...v }))
    .sort((a, b) => b.amountXAF - a.amountXAF)
    .slice(0, 6);

  const daily: DashboardStats["daily"] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    const key = d.toISOString().slice(0, 10);
    const dayTxns = counted.filter((t) => t.createdAt.slice(0, 10) === key);
    daily.push({
      date: key,
      amountXAF: dayTxns.reduce((s, t) => s + t.amountXAF, 0),
      count: dayTxns.length,
    });
  }

  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: counted.filter((t) => new Date(t.createdAt).getHours() === hour).length,
  }));

  const merchantMap = new Map<string, { name: string; amountXAF: number; count: number }>();
  counted.forEach((t) => {
    const cur = merchantMap.get(t.merchantId) ?? { name: t.merchantName, amountXAF: 0, count: 0 };
    cur.amountXAF += t.amountXAF;
    cur.count += 1;
    merchantMap.set(t.merchantId, cur);
  });
  const merchants = [...merchantMap.entries()]
    .map(([merchantId, v]) => ({ merchantId, ...v }))
    .sort((a, b) => b.amountXAF - a.amountXAF)
    .slice(0, 5);

  const riskTrend: DashboardStats["riskTrend"] = [];
  for (let i = 13; i >= 0; i--) {
    const key = new Date(now - i * DAY).toISOString().slice(0, 10);
    const dayTxns = txns.filter((t) => t.createdAt.slice(0, 10) === key);
    const avg = dayTxns.length
      ? dayTxns.reduce((s, t) => s + t.risk.score, 0) / dayTxns.length
      : 0;
    riskTrend.push({ date: key, score: Math.round(avg) });
  }

  const offlineCount = counted.filter((t) => t.offline).length;

  return {
    spend30dXAF: spend,
    spend30dCount: counted.length,
    avgTicketXAF: counted.length ? Math.round(spend / counted.length) : 0,
    offlineSharePct: counted.length ? Math.round((offlineCount / counted.length) * 100) : 0,
    settledPct: in30.length ? Math.round((counted.length / in30.length) * 100) : 100,
    blockedCount: declined.length,
    savingsXAF: declined.reduce((s, t) => s + t.amountXAF, 0),
    topCategories,
    daily,
    hourly,
    merchants,
    riskTrend,
  };
}
