"use client";

import { useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { TxnRow } from "@/components/TxnRow";
import { AreaChart, Donut } from "@/components/charts";
import { Icon } from "@/components/icons";
import { Disclosure, EmptyState } from "@/components/controls";
import { CATEGORY_META, dayKey, money, niceDay, relativeTime } from "@/lib/format";
import { apiJson } from "@/lib/client";
import type { MerchantCategory, Txn } from "@/lib/types";

type Period = 7 | 30 | 90;
type Filter = "all" | "offline" | "blocked" | "queued";

const PERIODS: { label: string; value: Period }[] = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

const FILTERS: { label: string; value: Filter }[] = [
  { label: "All", value: "all" },
  { label: "Offline", value: "offline" },
  { label: "Blocked", value: "blocked" },
  { label: "Queued", value: "queued" },
];

interface Recipient {
  merchantId: string;
  name: string;
  code: string;
  category: MerchantCategory;
  kind: string;
  payments: number;
  spentXAF: number;
  lastPaidAt: string;
  lastAmountXAF: number;
}

export default function ActivityPage() {
  const { state, sync, busy, openPay, toast } = useApp();
  const [period, setPeriod] = useState<Period>(30);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"payments" | "recipients">("payments");

  // /activity?view=recipients (from the wallet page) opens the recipients tab.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "recipients") setTab("recipients");
  }, []);

  /* Who you paid — the same aggregation as the recipients CSV. */
  const recipients = useMemo<Recipient[]>(() => {
    if (!state) return [];
    const map = new Map<string, Recipient>();
    for (const t of state.txns as Txn[]) {
      if (t.status === "declined") continue;
      const found = map.get(t.merchantId);
      if (found) {
        found.payments += 1;
        if (t.status === "settled") found.spentXAF += t.amountXAF;
        if (t.createdAt > found.lastPaidAt) {
          found.lastPaidAt = t.createdAt;
          found.lastAmountXAF = t.amountXAF;
        }
        continue;
      }
      map.set(t.merchantId, {
        merchantId: t.merchantId,
        name: t.merchantName,
        code: t.merchantCode,
        category: t.category,
        kind: state.merchants.find((m) => m.id === t.merchantId)?.kind ?? "business",
        payments: 1,
        spentXAF: t.status === "settled" ? t.amountXAF : 0,
        lastPaidAt: t.createdAt,
        lastAmountXAF: t.amountXAF,
      });
    }
    return [...map.values()]
      .filter((r) => !query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => (a.lastPaidAt < b.lastPaidAt ? 1 : -1));
  }, [state, query]);

  /* Repeat a payment: mint a fresh signed request, then let biometrics decide. */
  const payAgain = async (recipient: Recipient) => {
    try {
      const res = await apiJson<{ request: { id: string; merchantId: string; merchantName: string; merchantCode: string; amountXAF: number; note?: string; category: MerchantCategory } }>(
        "/api/merchant",
        { method: "POST", body: JSON.stringify({ merchantId: recipient.merchantId, amountXAF: recipient.lastAmountXAF, note: "Repeat payment" }) },
      );
      openPay({
        requestId: res.request.id,
        merchantId: res.request.merchantId,
        merchantName: res.request.merchantName,
        merchantCode: res.request.merchantCode,
        amountXAF: res.request.amountXAF,
        note: res.request.note,
        category: res.request.category,
        channel: "qr-scan",
        source: "request",
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start that payment", "danger");
    }
  };

  const view = useMemo(() => {
    if (!state) return null;
    const days = period;
    const cutoff = Date.now() - days * 86_400_000;
    const inWindow = state.txns.filter((t) => new Date(t.createdAt).getTime() >= cutoff);
    const counted = inWindow.filter((t) => t.status === "settled" || t.status === "queued");
    const spend = counted.reduce((s, t) => s + t.amountXAF, 0);
    const blocked = inWindow.filter((t) => t.status === "declined");
    const offlineCount = counted.filter((t) => t.offline).length;

    const daily = Array.from({ length: days }, (_, i) => {
      const date = new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10);
      const rows = counted.filter((t) => t.createdAt.slice(0, 10) === date);
      return { date, amountXAF: rows.reduce((s, t) => s + t.amountXAF, 0), count: rows.length };
    });

    const catMap = new Map<MerchantCategory, number>();
    counted.forEach((t) => catMap.set(t.category, (catMap.get(t.category) ?? 0) + t.amountXAF));
    const categories = [...catMap.entries()]
      .map(([category, value]) => ({ category, value, label: CATEGORY_META[category].label, color: CATEGORY_META[category].color }))
      .sort((a, b) => b.value - a.value);

    const merchantMap = new Map<string, { name: string; total: number; count: number }>();
    counted.forEach((t) => {
      const cur = merchantMap.get(t.merchantId) ?? { name: t.merchantName, total: 0, count: 0 };
      cur.total += t.amountXAF;
      cur.count += 1;
      merchantMap.set(t.merchantId, cur);
    });
    const merchants = [...merchantMap.values()].sort((a, b) => b.total - a.total).slice(0, 4);

    let rows = inWindow;
    if (filter === "offline") rows = rows.filter((t) => t.offline);
    if (filter === "blocked") rows = rows.filter((t) => t.status === "declined");
    if (filter === "queued") rows = rows.filter((t) => t.status === "queued");
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      rows = rows.filter((t) =>
        [t.merchantName, t.receiptNo, t.ref, t.category, t.geo.city].join(" ").toLowerCase().includes(q),
      );
    }

    const groups: { day: string; rows: typeof rows; total: number }[] = [];
    rows.forEach((t) => {
      const key = dayKey(t.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.day === key) {
        last.rows.push(t);
        if (t.status !== "declined") last.total += t.amountXAF;
      } else {
        groups.push({ day: key, rows: [t], total: t.status === "declined" ? 0 : t.amountXAF });
      }
    });

    return {
      inWindow,
      counted,
      spend,
      blocked,
      offlineCount,
      daily,
      categories,
      merchants,
      groups,
      avg: counted.length ? Math.round(spend / counted.length) : 0,
      peak: daily.reduce((a, b) => (b.amountXAF > a.amountXAF ? b : a), daily[0] ?? { date: "", amountXAF: 0 }),
    };
  }, [state, period, filter, query]);

  if (!state || !view) return null;
  const vault = state.vault;

  return (
    <div className="page">
      <div className="row-between">
        <div>
          <h1 style={{ fontSize: 22 }}>Money trail</h1>
          <p className="small muted" style={{ marginTop: 3 }}>
            Encrypted history mirrored to your cloud vault.
          </p>
        </div>
        <div className="row gap-6">
          <a className="chip" href="/api/export?type=recipients" download>
            <Icon name="download" size={13} />
            Recipients CSV
          </a>
          <a className="chip" href="/api/export" download>
            <Icon name="download" size={13} />
            All payments
          </a>
        </div>
      </div>

      <div className="segmented">
        {(["payments", "recipients"] as const).map((id) => (
          <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {id === "payments" ? "Payments" : `Recipients (${recipients.length})`}
          </button>
        ))}
      </div>

      {tab === "recipients" && (
        <>
          <div className="search">
            <Icon name="search" size={15} />
            <input
              className="input"
              placeholder="Find someone you paid…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search recipients"
            />
          </div>
          {recipients.length === 0 ? (
            <EmptyState icon={<Icon name="user" size={19} />} title="No recipients yet" body="Pay a shop, a biller or a friend and they show up here with their history." />
          ) : (
            <div className="stack gap-8">
              {recipients.map((r) => (
                <div key={r.merchantId} className="card flat" style={{ padding: 12 }}>
                  <div className="row gap-10" style={{ alignItems: "center" }}>
                    <span
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        display: "grid",
                        placeItems: "center",
                        background: "rgba(255,203,5,.1)",
                        color: "var(--accent)",
                        flex: "none",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      {r.name.slice(0, 1)}
                    </span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="truncate" style={{ display: "block", fontSize: 12.5, fontWeight: 500 }}>
                        {r.name}
                      </span>
                      <span className="tiny muted">
                        {CATEGORY_META[r.category].label} · code {r.code} · {r.payments}× · last {relativeTime(r.lastPaidAt)}
                      </span>
                    </span>
                    <span style={{ textAlign: "right" }}>
                      <span className="num" style={{ display: "block", fontSize: 12.5 }}>{money(r.spentXAF, { suffix: false })}</span>
                      <span className="tiny muted">FCFA paid</span>
                    </span>
                    <button className="btn soft xs" type="button" onClick={() => void payAgain(r)}>
                      Pay {money(r.lastAmountXAF, { suffix: false })}
                    </button>
                  </div>
                </div>
              ))}
              <a className="btn ghost sm" href="/api/export?type=recipients" download>
                <Icon name="download" size={13} />
                Download these recipients (CSV)
              </a>
            </div>
          )}
        </>
      )}

      {tab === "payments" && (
      <>
      <div className="card flat" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 9 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 9,
            display: "grid",
            placeItems: "center",
            background: "rgba(127,168,255,.1)",
            color: "var(--blue)",
            flex: "none",
          }}
        >
          <Icon name="cloud" size={14} />
        </span>
        <span className="grow">
          <span style={{ display: "block", fontSize: 11.5 }}>Cloud vault · {vault.region}</span>
          <span className="tiny muted">
            {vault.syncedTxns} receipts · {vault.pendingTxns} pending · {(vault.encryptedBytes / 1024).toFixed(1)} KB encrypted
          </span>
        </span>
        <span className="tiny" style={{ color: "var(--mint)" }}>
          {relativeTime(vault.lastSyncAt)}
        </span>
        <button className="icon-btn" type="button" onClick={() => void sync()} disabled={busy === "sync"} aria-label="Sync now">
          <Icon name="refresh" size={14} className={busy === "sync" ? "spin" : ""} />
        </button>
      </div>

      <div className="segmented">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={period === p.value ? "active" : ""}
            onClick={() => setPeriod(p.value)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="chart-card">
        <div className="row-between" style={{ alignItems: "flex-end", marginBottom: 6 }}>
          <div>
            <div className="up">Total spent</div>
            <div className="num" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.03em" }}>
              {money(view.spend, { suffix: false })}
              <span className="tiny muted" style={{ marginLeft: 5, fontFamily: "var(--font-ui)", letterSpacing: 0 }}>
                FCFA
              </span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="tiny muted">{view.counted.length} payments</div>
            <div className="tiny" style={{ color: "var(--mint)" }}>
              avg {money(view.avg, { suffix: false })}
            </div>
          </div>
        </div>
        <AreaChart data={view.daily} height={92} />
        <div className="row-between tiny muted" style={{ marginTop: 2 }}>
          <span>{view.daily[0] ? new Date(`${view.daily[0].date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}</span>
          <span>
            peak {money(view.peak.amountXAF, { compact: true, suffix: false })} ·{" "}
            {view.peak.date ? new Date(`${view.peak.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
          </span>
          <span>today</span>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="k">Offline share</div>
          <div className="v" style={{ color: "var(--amber)" }}>
            {view.counted.length ? Math.round((view.offlineCount / view.counted.length) * 100) : 0}%
          </div>
          <div className="s">{view.offlineCount} voucher{view.offlineCount === 1 ? "" : "s"} settled late</div>
        </div>
        <div className="stat">
          <div className="k">Fraud prevented</div>
          <div className="v" style={{ color: "var(--coral)" }}>
            {money(view.blocked.reduce((s, t) => s + t.amountXAF, 0), { compact: true, suffix: false })}
          </div>
          <div className="s">{view.blocked.length} blocked attempt{view.blocked.length === 1 ? "" : "s"}</div>
        </div>
        <div className="stat">
          <div className="k">Largest</div>
          <div className="v">
            {money(Math.max(0, ...view.counted.map((t) => t.amountXAF)), { compact: true, suffix: false })}
          </div>
          <div className="s">single payment</div>
        </div>
        <div className="stat">
          <div className="k">Cities</div>
          <div className="v">{new Set(view.inWindow.map((t) => t.geo.city)).size}</div>
          <div className="s">where you paid</div>
        </div>
      </div>

      <div className="card flat">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 13 }}>Where it goes</h2>
          <span className="tiny muted">{period} days</span>
        </div>
        <div className="donut-wrap">
          <Donut items={view.categories.slice(0, 6)} size={98} />
          <div className="legend">
            {view.categories.slice(0, 5).map((c) => (
              <div className="legend-row" key={c.category}>
                <span className="swatch" style={{ background: c.color }} />
                <span className="lg-name">{c.label}</span>
                <span className="lg-val">{money(c.value, { compact: true, suffix: false })}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Disclosure title="Top merchants" meta={`${view.merchants.length} in ${period} days`}>
            {view.merchants.map((m) => (
              <div className="row-between" key={m.name} style={{ padding: "5px 0", fontSize: 11.5 }}>
                <span className="truncate" style={{ color: "var(--text-2)", flex: 1 }}>{m.name}</span>
                <span className="muted" style={{ fontSize: 10.5, marginRight: 8 }}>{m.count}×</span>
                <span className="num" style={{ fontSize: 11.5 }}>{money(m.total, { suffix: false })}</span>
              </div>
            ))}
          </Disclosure>
        </div>
      </div>

      <div className="stack gap-10">
        <div className="search">
          <Icon name="search" size={15} />
          <input
            className="input"
            placeholder="Search merchant, receipt, city…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search transactions"
          />
        </div>
        <div className="row gap-6" style={{ flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              className={`chip ${filter === f.value ? "active" : ""}`}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </button>
          ))}
          <span className="tiny muted" style={{ marginLeft: "auto", alignSelf: "center" }}>
            {view.groups.reduce((s, g) => s + g.rows.length, 0)} rows
          </span>
        </div>
      </div>

      {view.groups.length === 0 ? (
        <EmptyState
          icon={<Icon name="receipt" size={19} />}
          title="Nothing in this view"
          body="Try a wider period or clear the search."
        />
      ) : (
        <div className="stack" style={{ gap: 2 }}>
          {view.groups.map((g) => (
            <div key={g.day}>
              <div className="day-group">
                <span className="day">{niceDay(g.day)}</span>
                <span className="total">{money(g.total, { suffix: false })} FCFA</span>
              </div>
              <div className="list">
                {g.rows.map((t) => (
                  <TxnRow key={t.id} txn={t} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}
