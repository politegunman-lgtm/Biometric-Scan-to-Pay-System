"use client";

import { useApp } from "./AppProvider";
import { Icon } from "./icons";
import { money, relativeTime } from "@/lib/format";

export function QueuePanel({ compact = false }: { compact?: boolean }) {
  const { state, sync, busy } = useApp();
  const queue = state?.queue ?? [];
  const pending = queue.filter((q) => q.status === "queued");
  const rejected = queue.filter((q) => q.status === "rejected");
  const settled = queue.filter((q) => q.status === "settled");
  const offline = (state?.network.tier ?? "good") === "offline";

  if (queue.length === 0) {
    return (
      <div className="stack gap-8" style={{ alignItems: "flex-start" }}>
        <div className="row gap-8 small muted">
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              display: "grid",
              placeItems: "center",
              background: "rgba(75,221,160,.1)",
              color: "var(--mint)",
            }}
          >
            <Icon name="cloud" size={15} />
          </span>
          <span>
            Queue empty.
            <br />
            <span className="tiny" style={{ color: "var(--dim)" }}>
              Payments signed with no data land here.
            </span>
          </span>
        </div>
        {!compact && (
          <button className="btn ghost xs" type="button" onClick={() => void sync({ replay: true })} disabled={busy === "sync"}>
            <Icon name="flask" size={12} />
            Replay drill
          </button>
        )}
      </div>
    );
  }

  const rows = [...pending, ...rejected, ...settled].slice(0, compact ? 5 : 20);

  return (
    <div className="stack gap-8">
      {rows.map((v) => {
        const badge =
          v.status === "queued"
            ? { cls: "warn", label: "queued" }
            : v.status === "settled"
              ? { cls: "ok", label: "settled" }
              : v.status === "rejected"
                ? { cls: "danger", label: "rejected" }
                : { cls: "info", label: "syncing" };
        return (
          <div className="queue-item" key={v.txnId}>
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                display: "grid",
                placeItems: "center",
                flex: "none",
                background: "rgba(255,255,255,.05)",
                color: v.status === "rejected" ? "var(--coral)" : v.status === "settled" ? "var(--mint)" : "var(--amber)",
              }}
            >
              <Icon name={v.status === "rejected" ? "alert" : v.status === "settled" ? "check" : "cloud"} size={13} />
            </span>
            <span className="qi-main">
              <span className="row-between" style={{ gap: 6 }}>
                <span className="qi-name truncate">{v.merchantName}</span>
                <span className="amount" style={{ fontSize: 11.5 }}>
                  {money(v.amountXAF, { suffix: false })}
                </span>
              </span>
              <span className="qi-sub">
                #{v.counter} · {relativeTime(v.issuedAt)} · {v.channel === "offline-sms" ? "SMS" : "QR"}
              </span>
              {!compact && v.status === "rejected" && v.lastError && (
                <span className="tiny" style={{ color: "var(--coral)", display: "block", marginTop: 2 }}>
                  {v.lastError}
                </span>
              )}
              {!compact && v.status === "queued" && (
                <span className="mono tiny" style={{ color: "var(--dim)", display: "block", marginTop: 2, wordBreak: "break-all" }}>
                  {v.smsToken}
                </span>
              )}
            </span>
            <span className={`badge ${badge.cls}`} style={{ height: 18, fontSize: 9.5, flex: "none" }}>
              {badge.label}
            </span>
          </div>
        );
      })}

      <div className="row gap-6" style={{ marginTop: 2 }}>
        <button
          className="btn soft xs"
          type="button"
          onClick={() => void sync()}
          disabled={busy === "sync" || offline || pending.length === 0}
          title={offline ? "Radio is offline" : undefined}
        >
          <Icon name="refresh" size={12} className={busy === "sync" ? "spin" : ""} />
          {offline ? "Waiting for data" : "Settle now"}
        </button>
        <button className="btn ghost xs" type="button" onClick={() => void sync({ replay: true })} disabled={busy === "sync" || offline || settled.length === 0}>
          <Icon name="flask" size={12} />
          Replay drill
        </button>
        <span className="tiny muted" style={{ marginLeft: "auto", alignSelf: "center" }}>
          {pending.length} pending
        </span>
      </div>
    </div>
  );
}
