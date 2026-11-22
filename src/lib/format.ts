import type { MerchantCategory, ProviderId, RiskLevel, TxnStatus } from "./types";

export const money = (n: number, opts: { suffix?: boolean; compact?: boolean } = {}) => {
  const { suffix = true, compact = false } = opts;
  const abs = Math.abs(Math.round(n));
  const formatted = compact && abs >= 1_000_000
    ? `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
    : compact && abs >= 10_000
      ? `${Math.round(abs / 1000)}k`
      : abs.toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " ");
  return `${n < 0 ? "-" : ""}${formatted}${suffix ? " FCFA" : ""}`;
};

export const moneyShort = (n: number) => money(n, { compact: true });

export const CATEGORY_META: Record<MerchantCategory, { label: string; color: string; glyph: string }> = {
  groceries: { label: "Groceries", color: "#5FD3A0", glyph: "basket" },
  "food-drink": { label: "Food & drink", color: "#FFB25A", glyph: "cup" },
  transport: { label: "Transport", color: "#6AA6FF", glyph: "car" },
  telecom: { label: "Telecom", color: "#FFCB05", glyph: "signal" },
  utilities: { label: "Utilities", color: "#8ED9E8", glyph: "bolt" },
  health: { label: "Health", color: "#F98BA0", glyph: "cross" },
  retail: { label: "Retail", color: "#C9A7FF", glyph: "bag" },
  entertainment: { label: "Leisure", color: "#FF8F6B", glyph: "ticket" },
  travel: { label: "Travel", color: "#7FD1C1", glyph: "compass" },
  education: { label: "Education", color: "#A9C0FF", glyph: "book" },
};

export const STATUS_META: Record<TxnStatus, { label: string; tone: string }> = {
  settled: { label: "Settled", tone: "ok" },
  queued: { label: "Queued offline", tone: "warn" },
  syncing: { label: "Syncing", tone: "info" },
  declined: { label: "Blocked", tone: "danger" },
  challenged: { label: "Awaiting PIN", tone: "warn" },
  reversed: { label: "Reversed", tone: "muted" },
};

export const RISK_META: Record<RiskLevel, { label: string; color: string }> = {
  low: { label: "Low risk", color: "#5FD3A0" },
  elevated: { label: "Elevated", color: "#FFC24B" },
  high: { label: "High risk", color: "#FF8A5B" },
  critical: { label: "Critical", color: "#FF5D5D" },
};

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  "mtn-momo": "MTN MoMo",
  "orange-money": "Orange Money",
  "express-union": "Express Union",
};

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const diff = now - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const past = diff >= 0;
  const fmt = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (abs < 45_000) return past ? "just now" : "in a moment";
  if (abs < 3_600_000) return past ? `${fmt(Math.round(abs / 60_000), "min")} ago` : `in ${fmt(Math.round(abs / 60_000), "min")}`;
  if (abs < 86_400_000) return past ? `${fmt(Math.round(abs / 3_600_000), "hour")} ago` : `in ${fmt(Math.round(abs / 3_600_000), "hour")}`;
  if (abs < 7 * 86_400_000) return past ? `${fmt(Math.round(abs / 86_400_000), "day")} ago` : `in ${fmt(Math.round(abs / 86_400_000), "day")}`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function dayKey(iso: string) {
  return new Date(iso).toISOString().slice(0, 10);
}

export function niceDay(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (d.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)) return "Today";
  if (d.toISOString().slice(0, 10) === yesterday.toISOString().slice(0, 10)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export const currency = (n: number) => `${Math.round(n).toLocaleString("fr-FR").replace(/\u202f|\u00a0/g, " ")} FCFA`;
