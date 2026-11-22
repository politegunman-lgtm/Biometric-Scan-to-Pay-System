"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AppProvider";
import { TxnRow } from "@/components/TxnRow";
import { MerchantAvatar } from "@/components/MerchantAvatar";
import { Icon } from "@/components/icons";
import { money, relativeTime } from "@/lib/format";

export default function HomePage() {
  const { state, openPay, setTier, toast, sync, busy } = useApp();
  const router = useRouter();
  if (!state) return null;

  const primary = state.wallets.find((w) => w.primary) ?? state.wallets[0];
  const requests = state.requests.filter((r) => r.status === "open");
  const pending = state.queue.filter((q) => q.status === "queued");
  const pendingTotal = pending.reduce((s, q) => s + q.amountXAF, 0);
  const offline = state.network.tier === "offline";
  const openAlerts = state.alerts.filter((a) => a.status === "open").length;
  const finger = state.biometric.fingers[0];

  const startOfflineDemo = async () => {
    if (!requests.length) {
      router.push("/scan");
      return;
    }
    // Pick a request the offline float can actually authorise, so the demo
    // shows the happy path instead of immediately tripping the per-txn cap.
    const cap = state.user.settings.offlinePerTxnXAF;
    const pick = requests.find((r) => r.amountXAF <= cap) ?? requests[0];
    if (!offline) {
      await setTier("offline");
      toast("Radio is off — this payment will be signed offline", "warn");
    }
    openPay({
      requestId: pick.id,
      merchantId: pick.merchantId,
      merchantName: pick.merchantName,
      amountXAF: pick.amountXAF,
      note: pick.note,
      category: pick.category,
      channel: "offline-qr",
      source: "request",
    });
  };

  return (
    <div className="page">
      {pending.length > 0 && (
        <div
          className="card"
          style={{
            padding: 12,
            borderColor: "rgba(255,189,74,.24)",
            background: "rgba(255,189,74,.06)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              display: "grid",
              placeItems: "center",
              background: "rgba(255,189,74,.12)",
              color: "var(--amber)",
              flex: "none",
            }}
          >
            <Icon name="cloud" size={16} />
          </span>
          <div className="grow">
            <div style={{ fontSize: 12.5, fontWeight: 500 }}>
              {pending.length} payment{pending.length === 1 ? "" : "s"} waiting to settle
            </div>
            <div className="tiny muted">
              {money(pendingTotal)} signed offline · sync when you have data
            </div>
          </div>
          <button
            className="btn primary xs"
            type="button"
            onClick={() => (offline ? void setTier("good") : void sync())}
            disabled={busy === "sync" || busy === "network"}
          >
            {offline ? "Go online" : "Settle"}
          </button>
        </div>
      )}

      <section className="balance-card">
        <div className="provider-row">
          <span className="provider-logo" style={{ background: primary.accent }}>
            M
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{primary.providerName}</span>
          <span className="badge accent" style={{ marginLeft: "auto", height: 20, fontSize: 9.5 }}>
            PRIMARY
          </span>
        </div>
        <div className="balance-label">Available balance</div>
        <div className="balance-amount">
          {money(primary.balanceXAF, { suffix: false })}
          <span className="cur">FCFA</span>
        </div>
        <div className="balance-meta">
          <span className="badge muted" style={{ background: "rgba(255,255,255,.06)" }}>
            <Icon name="device" size={10} /> {primary.msisdn}
          </span>
          <span className="dot" />
          <span className="tiny" style={{ color: "rgba(255,240,180,.6)" }}>
            offline float {money(state.wallets[0].offlineFloatXAF, { suffix: false })}
          </span>
        </div>
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              const target = requests[0];
              if (target) {
                openPay({
                  requestId: target.id,
                  merchantId: target.merchantId,
                  merchantName: target.merchantName,
                  amountXAF: target.amountXAF,
                  note: target.note,
                  category: target.category,
                  channel: "nfc-tap",
                });
              } else {
                router.push("/scan");
              }
            }}
          >
            <Icon name="nfc" size={16} />
            Tap to pay
          </button>
          <button className="btn soft" type="button" onClick={() => router.push("/scan")}>
            <Icon name="qr" size={16} />
            Scan
          </button>
        </div>
      </section>

      <div className="quick-actions">
        <button className="quick-action" type="button" onClick={() => router.push("/scan")}>
          <span className="glyph">
            <Icon name="qr" size={16} />
          </span>
          <span className="label">Scan QR</span>
          <span className="sub">Merchant code</span>
        </button>
        <button className="quick-action" type="button" onClick={() => void startOfflineDemo()}>
          <span className="glyph mint">
            <Icon name="cloud" size={16} />
          </span>
          <span className="label">Offline test</span>
          <span className="sub">Signed voucher</span>
        </button>
        <button className="quick-action" type="button" onClick={() => router.push("/merchant")}>
          <span className="glyph blue">
            <Icon name="store" size={16} />
          </span>
          <span className="label">Merchant</span>
          <span className="sub">Take a payment</span>
        </button>
      </div>

      <section>
        <div className="section-head" style={{ marginBottom: 9 }}>
          <h2>Waiting at the counter</h2>
          <Link href="/scan" className="link">
            Scan <Icon name="chevron" size={11} />
          </Link>
        </div>
        <div className="stack gap-8">
          {requests.length === 0 && (
            <div className="card flat small muted" style={{ textAlign: "center", padding: 16 }}>
              No open requests. Create one in the merchant terminal, or scan any code.
            </div>
          )}
          {requests.slice(0, 3).map((r) => {
            const merchant = state.merchants.find((m) => m.id === r.merchantId);
            return (
              <button
                key={r.id}
                type="button"
                className="merchant-request"
                onClick={() =>
                  openPay({
                    requestId: r.id,
                    merchantId: r.merchantId,
                    merchantName: r.merchantName,
                    merchantCode: r.merchantCode,
                    amountXAF: r.amountXAF,
                    note: r.note,
                    category: r.category,
                    channel: "qr-scan",
                  })
                }
              >
                <MerchantAvatar name={r.merchantName} hue={merchant?.logoHue ?? 42} />
                <span className="grow">
                  <span className="truncate" style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{r.merchantName}</span>
                  <span className="tiny muted truncate" style={{ display: "block" }}>
                    {r.note ?? "Payment request"} · expires {relativeTime(r.expiresAt)}
                  </span>
                </span>
                <span style={{ textAlign: "right" }}>
                  <span className="amount">{money(r.amountXAF, { suffix: false })}</span>
                  <span className="tiny muted" style={{ display: "block" }}>FCFA</span>
                </span>
                <Icon name="chevron" size={15} className="arrow" />
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="section-head" style={{ marginBottom: 2 }}>
          <h2>Recent activity</h2>
          <Link href="/activity" className="link">
            See all <Icon name="chevron" size={11} />
          </Link>
        </div>
        <div className="list">
          {state.txns.slice(0, 5).map((txn) => (
            <TxnRow key={txn.id} txn={txn} />
          ))}
        </div>
      </section>

      <Link
        href="/security"
        className="card"
        style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}
      >
        <span
          style={{
            width: 38,
            height: 38,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            background: "rgba(75,221,160,.1)",
            color: "var(--mint)",
            flex: "none",
          }}
        >
          <Icon name="shield-check" size={18} />
        </span>
        <span className="grow">
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 500 }}>
            Protection active · {openAlerts === 0 ? "no open alerts" : `${openAlerts} alert${openAlerts === 1 ? "" : "s"}`}
          </span>
          <span className="tiny muted">
            {finger?.label ?? "Fingerprint"} · liveness {state.biometric.livenessEnabled ? "on" : "off"} · step-up{" "}
            {money(state.user.settings.stepUpThresholdXAF)}
          </span>
        </span>
        <Icon name="chevron" size={15} style={{ color: "var(--dim)" }} />
      </Link>

      <div className="row gap-6" style={{ justifyContent: "center", paddingBottom: 4 }}>
        <span className="tiny" style={{ color: "var(--dim)" }}>
          Cloud vault synced {relativeTime(state.vault.lastSyncAt)} · {state.vault.syncedTxns} receipts
        </span>
      </div>
    </div>
  );
}
