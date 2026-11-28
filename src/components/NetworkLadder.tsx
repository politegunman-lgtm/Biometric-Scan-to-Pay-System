"use client";

import { useApp } from "./AppProvider";
import { Icon } from "./icons";
import { TRANSPORT_LADDER } from "@/lib/transport";
import type { NetworkTier } from "@/lib/types";
import { relativeTime } from "@/lib/format";

const TIERS: NetworkTier[] = ["excellent", "good", "weak", "offline"];

export function NetworkLadder({ compact = false, showSync = true }: { compact?: boolean; showSync?: boolean }) {
  const { state, setTier, sync, busy } = useApp();
  const network = state?.network;
  const active = network?.tier ?? "good";
  const plan = TRANSPORT_LADDER[active];
  const pending = state?.queue.filter((q) => q.status === "queued").length ?? 0;

  return (
    <div className="stack gap-10">
      <div className="ladder">
        {TIERS.map((tier) => {
          const p = TRANSPORT_LADDER[tier];
          const isActive = active === tier;
          return (
            <button
              key={tier}
              type="button"
              className={`ladder-btn ${isActive ? "active" : ""}`}
              data-tier={tier}
              onClick={() => void setTier(tier)}
              disabled={busy === "network"}
              aria-pressed={isActive}
            >
              <span className="lb-dot" />
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontWeight: isActive ? 600 : 400 }}>{p.label}</span>
                <span className="lb-sub">{p.tier === "offline" ? "vouchers + SMS/USSD" : `${p.batchSize} per batch${p.compress ? " · gzip" : ""}`}</span>
              </span>
              {isActive && <Icon name="check" size={13} strokeWidth={2.4} />}
            </button>
          );
        })}
      </div>

      {!compact && (
        <div className="stack gap-6" style={{ padding: "10px 11px", borderRadius: 12, background: "rgba(255,255,255,.03)", border: "1px solid var(--line)" }}>
          <div className="row gap-6 small" style={{ color: "var(--text-2)" }}>
            <Icon name="info" size={13} />
            {plan.description}
          </div>
          <div className="row gap-6 tiny muted" style={{ flexWrap: "wrap" }}>
            <span>latency {network?.latencyMs ?? 0} ms</span>
            <span>·</span>
            <span>loss {network?.packetLoss ?? 0}%</span>
            <span>·</span>
            <span>timeout {(plan.timeoutMs / 1000).toFixed(0)}s</span>
            <span>·</span>
            <span>backoff {plan.retryBackoffMs.length ? `${plan.retryBackoffMs.join("/")} ms` : "n/a"}</span>
          </div>
        </div>
      )}

      {showSync && (
        <div className="btn-row">
          <button className="btn soft sm" type="button" onClick={() => void sync()} disabled={busy === "sync" || active === "offline"}>
            <Icon name="refresh" size={14} className={busy === "sync" ? "spin" : ""} />
            {pending > 0 ? `Sync ${pending} voucher${pending === 1 ? "" : "s"}` : "Sync ledger"}
          </button>
          {!compact && (
            <span className="tiny muted" style={{ alignSelf: "center" }}>
              last {relativeTime(state?.vault.lastSyncAt)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
