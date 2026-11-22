"use client";

import { useApp } from "./AppProvider";
import { BottomNav } from "./BottomNav";
import { PaySheet } from "./PaySheet";
import { SideRail } from "./SideRail";
import { ToastHost } from "./ToastHost";
import { TopBar } from "./TopBar";
import { TxnSheet } from "./TxnSheet";
import { Icon } from "./icons";

function BootScreen({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div
      style={{
        minHeight: 420,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 32,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 54,
          height: 54,
          borderRadius: 17,
          display: "grid",
          placeItems: "center",
          background: "linear-gradient(160deg, #FFE270, #FFCB05)",
          color: "#171200",
          animation: "pulse 1.6s ease-in-out infinite",
        }}
      >
        <Icon name={error ? "alert" : "fingerprint"} size={26} />
      </div>
      <div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 15 }}>
          {error ? "Wallet service unreachable" : "Opening secure channel"}
        </div>
        <div className="small muted" style={{ marginTop: 4, maxWidth: 260 }}>
          {error ?? "Verifying device key and syncing the encrypted ledger…"}
        </div>
      </div>
      {error && (
        <button type="button" className="btn soft sm" onClick={onRetry}>
          <Icon name="refresh" size={14} />
          Retry
        </button>
      )}
      <style>{`@keyframes pulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.06);opacity:1}}`}</style>
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const { state, error, refresh } = useApp();

  return (
    <div className="app">
      <div className="shell">
        <div className="device-wrap">
          <div className="device">
            <div className="screen">
              <TopBar />
              <div className="screen-scroll" id="app-scroll">
                {state ? children : <BootScreen error={error} onRetry={() => void refresh()} />}
              </div>
              <BottomNav />
              <PaySheet />
              <TxnSheet />
              <ToastHost />
            </div>
          </div>
        </div>
        <SideRail />
      </div>
    </div>
  );
}
