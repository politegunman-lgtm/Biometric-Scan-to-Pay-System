"use client";

import Link from "next/link";
import { useApp } from "./AppProvider";
import { NetworkLadder } from "./NetworkLadder";
import { QueuePanel } from "./QueuePanel";
import { Bars } from "./charts";
import { Icon } from "./icons";
import { RISK_META, money, relativeTime } from "@/lib/format";

export function SideRail() {
  const { state, reseedDemo, busy, openAlerts } = useApp();
  const trend = state?.stats.riskTrend.map((r) => r.score) ?? [];
  const alerts = state?.alerts.slice(0, 2) ?? [];
  const pending = state?.queue.filter((q) => q.status === "queued").length ?? 0;
  const synced = state?.syncLog.slice(0, 4) ?? [];

  return (
    <aside className="rail" aria-label="Operations console">
      <div className="rail-card" style={{ padding: 18 }}>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div className="row gap-8">
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                display: "grid",
                placeItems: "center",
                background: "linear-gradient(160deg, #FFE270, #FFCB05)",
                color: "#171200",
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              SP
            </span>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14, lineHeight: 1.1 }}>
                Scan to Pay
              </div>
              <div className="tiny muted">Biometric rail for mobile money</div>
            </div>
          </div>
          <span className="badge accent" style={{ height: 20 }}>
            Cameroon
          </span>
        </div>
        <p className="small muted" style={{ lineHeight: 1.5 }}>
          This console drives the same APIs the phone UI calls: radio profile, settlement queue and the fraud engine.
          Try a payment with the radio off, then settle it.
        </p>
        <div className="row gap-6" style={{ marginTop: 12 }}>
          <Link href="/merchant" className="btn soft xs" style={{ flex: 1 }}>
            <Icon name="store" size={13} />
            Merchant terminal
          </Link>
          <Link href="/docs" className="btn ghost xs" style={{ flex: 1 }}>
            <Icon name="layers" size={13} />
            Architecture
          </Link>
        </div>
      </div>

      <div className="rail-card">
        <div className="rail-head">
          <h3>
            <Icon name="signal" size={14} style={{ color: "var(--accent)" }} />
            Network &amp; sync
          </h3>
          <span className="tag">live</span>
        </div>
        <NetworkLadder />
        <div className="hairline" style={{ margin: "12px 0 6px" }} />
        <div className="up" style={{ marginBottom: 4 }}>
          transport log
        </div>
        {synced.length === 0 && <div className="tiny muted">No sync events yet.</div>}
        {synced.map((e) => (
          <div className="log-line" key={e.id} data-kind={e.kind}>
            <span className="time">{relativeTime(e.at)}</span>
            <span style={{ minWidth: 0 }}>
              <span className="msg">{e.message}</span>
              {e.detail && <span className="det" style={{ display: "block" }}>{e.detail}</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="rail-card">
        <div className="rail-head">
          <h3>
            <Icon name="cloud" size={14} style={{ color: "var(--amber)" }} />
            Offline vouchers
          </h3>
          <span className="tag">{pending} pending</span>
        </div>
        <QueuePanel compact />
      </div>

      <div className="rail-card">
        <div className="rail-head">
          <h3>
            <Icon name="shield" size={14} style={{ color: "var(--mint)" }} />
            Fraud pulse
          </h3>
          <Link href="/security" className="tag" style={{ color: "var(--accent)" }}>
            {openAlerts} open
          </Link>
        </div>
        <div className="row-between" style={{ marginBottom: 4 }}>
          <span className="tiny muted">14-day risk trend</span>
          <span style={{ color: "var(--mint)", display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
            <Icon name="shield-check" size={12} /> engine live
          </span>
        </div>
        <Bars values={trend.map((t) => Math.max(6, t))} height={34} />
        <div className="hairline" style={{ margin: "10px 0 6px" }} />
        {alerts.map((a) => (
          <Link
            key={a.id}
            href="/security"
            className="log-line"
            style={{ textDecoration: "none", display: "block" }}
          >
            <span className="row gap-6" style={{ alignItems: "flex-start" }}>
              <span
                className="badge"
                style={{
                  height: 18,
                  fontSize: 9,
                  flex: "none",
                  color: RISK_META[a.severity === "critical" ? "critical" : "elevated"].color,
                  background: "rgba(255,255,255,.05)",
                  borderColor: "var(--line)",
                }}
              >
                {a.decision}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="msg" style={{ display: "block", fontSize: 11.5 }}>
                  {a.title}
                </span>
                <span className="det">
                  {money(a.amountXAF, { suffix: false })} · {relativeTime(a.createdAt)}
                </span>
              </span>
            </span>
          </Link>
        ))}
        <Link href="/security" className="btn ghost xs" style={{ width: "100%", marginTop: 8 }}>
          <Icon name="flask" size={12} />
          Run fraud scenarios
        </Link>
      </div>

      <div className="row-between" style={{ padding: "0 6px", fontSize: 10.5, color: "var(--dim)" }}>
        <span>Prototype · MTN MoMo case study</span>
        <button
          type="button"
          onClick={() => void reseedDemo()}
          disabled={busy === "reset"}
          style={{ color: "var(--dim)", textDecoration: "underline", display: "flex", gap: 4, alignItems: "center" }}
        >
          <Icon name="refresh" size={11} />
          Reseed demo
        </button>
      </div>
    </aside>
  );
}
