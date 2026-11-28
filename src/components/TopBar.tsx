"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { Icon, type IconName } from "./icons";
import { TRANSPORT_LADDER } from "@/lib/transport";
import type { NetworkTier } from "@/lib/types";

const PAGE_META: Record<string, { icon: IconName; title: string; sub: string }> = {
  "/activity": { icon: "activity", title: "Activity", sub: "Cloud-synced ledger" },
  "/scan": { icon: "scan", title: "Scan to pay", sub: "Point at the merchant code" },
  "/security": { icon: "shield", title: "Security", sub: "Biometrics, risk & limits" },
  "/wallet": { icon: "wallet", title: "Wallet", sub: "Wallets, devices & vault" },
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}

export function TopBar() {
  const { state, setTier, busy, openAlerts } = useApp();
  const pathname = usePathname();
  const [netOpen, setNetOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const meta = PAGE_META[pathname];
  const network = state?.network;

  useEffect(() => {
    if (!netOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setNetOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [netOpen]);

  useEffect(() => setNetOpen(false), [pathname]);

  return (
    <header className="topbar">
      {meta ? (
        <span className="avatar" style={{ background: "rgba(255,255,255,.06)", color: "var(--text)", boxShadow: "none", border: "1px solid var(--line)" }}>
          <Icon name={meta.icon} size={19} />
        </span>
      ) : (
        <Link href="/wallet" className="avatar" aria-label="Your profile">
          {state?.user.initials ?? "NM"}
          <span className="tick">
            <Icon name="check" size={8} strokeWidth={3} />
          </span>
        </Link>
      )}

      <div className="topbar-title">
        {meta ? (
          <>
            <div className="greet">{meta.sub}</div>
            <div className="name">{meta.title}</div>
          </>
        ) : (
          <>
            <div className="greet">{greeting()},</div>
            <div className="name">
              {state?.user.fullName.split(" ")[0] ?? "there"}
              <span className="badge accent" style={{ height: 18, fontSize: 9.5, padding: "0 6px" }}>
                KYC {state?.user.kycLevel ?? 3}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="topbar-actions" ref={wrapRef}>
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="net-chip"
            data-bars={network?.bars ?? 3}
            data-tier={network?.tier ?? "good"}
            onClick={() => setNetOpen((v) => !v)}
            aria-expanded={netOpen}
            aria-label={`Network: ${network?.label ?? "3G"}. Change profile`}
            disabled={busy === "network"}
          >
            <span className="bars">
              <i />
              <i />
              <i />
              <i />
            </span>
            {network?.tier === "offline" ? "Offline" : network?.tier === "excellent" ? "4G" : network?.tier === "weak" ? "EDGE" : "3G"}
          </button>

          {netOpen && (
            <div
              className="card"
              style={{
                position: "absolute",
                right: 0,
                top: 42,
                width: 262,
                zIndex: 50,
                background: "rgba(16,22,26,.98)",
                boxShadow: "var(--shadow-lg)",
                backdropFilter: "blur(18px)",
              }}
            >
              <div className="up" style={{ marginBottom: 8 }}>
                Simulated radio profile
              </div>
              <div className="ladder">
                {(Object.keys(TRANSPORT_LADDER) as NetworkTier[]).map((tier) => {
                  const plan = TRANSPORT_LADDER[tier];
                  const active = network?.tier === tier;
                  return (
                    <button
                      key={tier}
                      type="button"
                      className={`ladder-btn ${active ? "active" : ""}`}
                      data-tier={tier}
                      onClick={() => {
                        setNetOpen(false);
                        void setTier(tier);
                      }}
                    >
                      <span className="lb-dot" />
                      <span style={{ flex: 1 }}>
                        <span style={{ display: "block" }}>{plan.label}</span>
                        <span className="lb-sub">{plan.fallback}</span>
                      </span>
                      {active && <Icon name="check" size={13} strokeWidth={2.4} />}
                    </button>
                  );
                })}
              </div>
              <div className="small muted" style={{ marginTop: 9, lineHeight: 1.4 }}>
                Drives the real sync policy: batch size, gzip delta and whether vouchers are signed offline.
              </div>
            </div>
          )}
        </div>

        <Link href="/security" className={`icon-btn ${openAlerts > 0 ? "badged" : ""}`} aria-label="Security alerts">
          <Icon name="bell" size={17} />
        </Link>
      </div>
    </header>
  );
}
