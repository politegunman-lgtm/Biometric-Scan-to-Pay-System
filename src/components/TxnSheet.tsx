"use client";

import { useApp } from "./AppProvider";
import { MerchantAvatar } from "./MerchantAvatar";
import { RiskSummary } from "./Risk";
import { Icon } from "./icons";
import { CATEGORY_META, PROVIDER_LABEL, STATUS_META, money, relativeTime, timeLabel } from "@/lib/format";

export function TxnSheet() {
  const { activeTxn, setActiveTxn, state, toast } = useApp();
  if (!activeTxn) return null;

  const txn = state?.txns.find((t) => t.id === activeTxn.id) ?? activeTxn;
  const merchant = state?.merchants.find((m) => m.id === txn.merchantId);
  const wallet = state?.wallets.find((w) => w.id === txn.walletId);
  const status = STATUS_META[txn.status];
  const voucher = state?.queue.find((q) => q.txnId === txn.id);

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Transaction receipt"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setActiveTxn(null);
      }}
    >
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div>
            <div className="up">Receipt</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, marginTop: 2 }}>
              {txn.receiptNo}
            </div>
          </div>
          <button className="icon-btn" type="button" onClick={() => setActiveTxn(null)} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="stack gap-10" style={{ alignItems: "center" }}>
          <MerchantAvatar name={txn.merchantName} hue={merchant?.logoHue ?? 42} />
          <div className="pay-amount" style={{ fontSize: 32 }}>
            {money(txn.amountXAF, { suffix: false })}
            <span className="cur">FCFA</span>
          </div>
          <div className="row gap-6" style={{ justifyContent: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{txn.merchantName}</span>
            <span className={`badge ${status.tone}`}>{status.label}</span>
            {txn.offline && (
              <span className="badge info">
                <Icon name="cloud" size={10} /> offline
              </span>
            )}
          </div>
          <div className="tiny muted">
            {new Date(txn.createdAt).toLocaleString("en-GB", {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            · {txn.geo.city}
          </div>
        </div>

        <div className="receipt" style={{ marginTop: 14 }}>
          <div className="receipt-row">
            <span className="k">Merchant</span>
            <span className="v">
              {txn.merchantCode} · {CATEGORY_META[txn.category].label}
            </span>
          </div>
          <div className="receipt-row">
            <span className="k">Wallet</span>
            <span className="v">
              {wallet ? `${PROVIDER_LABEL[wallet.provider]} · ${wallet.msisdn}` : PROVIDER_LABEL[txn.provider]}
            </span>
          </div>
          <div className="receipt-row">
            <span className="k">Reference</span>
            <span className="v mono" style={{ fontSize: 11 }}>{txn.ref}</span>
          </div>
          <div className="receipt-row">
            <span className="k">Channel</span>
            <span className="v">
              {txn.channel === "nfc-tap"
                ? "NFC tap"
                : txn.channel === "qr-scan"
                  ? "QR scan"
                  : txn.channel === "offline-sms"
                    ? "SMS/USSD fallback"
                    : "Offline QR voucher"}
            </span>
          </div>
          <div className="receipt-row">
            <span className="k">Device</span>
            <span className="v">{txn.deviceLabel}</span>
          </div>
          <div className="receipt-row">
            <span className="k">Authorised</span>
            <span className="v">
              {txn.auth.fingerLabel} · {(txn.auth.matchScore * 100).toFixed(1)}%
              {txn.auth.stepUp ? " · PIN" : ""}
            </span>
          </div>
          <div className="receipt-row">
            <span className="k">Liveness</span>
            <span className="v" style={{ color: txn.auth.livenessPassed ? "var(--mint)" : "var(--coral)" }}>
              {txn.auth.livenessPassed ? "passed" : "failed"} · {txn.auth.holdMs} ms
            </span>
          </div>
          <div className="receipt-row">
            <span className="k">Cloud sync</span>
            <span className="v">
              {txn.cloudSynced ? `synced ${relativeTime(txn.syncedAt)}` : `pending · ${txn.syncAttempts} attempt(s)`}
            </span>
          </div>
          {txn.note && (
            <div className="receipt-row">
              <span className="k">Note</span>
              <span className="v">{txn.note}</span>
            </div>
          )}
          {txn.reason && (
            <div className="receipt-row">
              <span className="k">Reason</span>
              <span className="v">{txn.reason}</span>
            </div>
          )}
          {txn.payerFor && (
            <div className="receipt-row">
              <span className="k">Paid for</span>
              <span className="v">{txn.payerFor}</span>
            </div>
          )}
        </div>

        {voucher && (
          <div className="card flat" style={{ marginTop: 10, padding: 12 }}>
            <div className="row-between" style={{ marginBottom: 5 }}>
              <span className="up">Offline voucher</span>
              <span className={`badge ${voucher.status === "rejected" ? "danger" : voucher.status === "settled" ? "ok" : "warn"}`}>
                {voucher.status}
              </span>
            </div>
            <div className="mono tiny" style={{ wordBreak: "break-all", color: "var(--text-2)", lineHeight: 1.5 }}>
              {voucher.smsToken}
            </div>
            <div className="tiny muted" style={{ marginTop: 5 }}>
              counter {voucher.counter} · issued {timeLabel(voucher.issuedAt)} · expires{" "}
              {new Date(voucher.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              {voucher.rejectedReason && ` · rejected: ${voucher.rejectedReason}`}
            </div>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <RiskSummary risk={txn.risk} amountXAF={txn.amountXAF} />
        </div>

        {txn.status === "queued" && (
          <div className="row gap-6 tiny" style={{ marginTop: 10, color: "var(--amber)", lineHeight: 1.4 }}>
            <Icon name="info" size={13} style={{ flex: "none" }} />
            Funds are reserved in the app but only leave your wallet when the voucher settles.
          </div>
        )}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(txn.receiptNo);
              toast("Receipt number copied", "ok");
            }}
          >
            <Icon name="copy" size={14} />
            Copy
          </button>
          <button
            className="btn soft"
            type="button"
            onClick={() => {
              toast("Dispute opened — the acquirer will respond within 48h", "info");
              setActiveTxn(null);
            }}
          >
            <Icon name="alert" size={14} />
            Dispute
          </button>
        </div>
      </div>
    </div>
  );
}
