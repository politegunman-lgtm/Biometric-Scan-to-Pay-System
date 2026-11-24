"use client";

import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/AppProvider";
import { QueuePanel } from "@/components/QueuePanel";
import { Icon } from "@/components/icons";
import { money, relativeTime } from "@/lib/format";

const PROVIDERS = [
  { id: "mtn-momo", name: "MTN Mobile Money", accent: "#FFCB05" },
  { id: "orange-money", name: "Orange Money", accent: "#FF7900" },
  { id: "express-union", name: "Express Union Mobile", accent: "#38BDF8" },
];

export default function WalletPage() {
  const { state, sync, busy, trustDevice, reseedDemo, rotateSensor, toast, makePrimaryWallet, linkWallet } = useApp();
  const [linkOpen, setLinkOpen] = useState(false);
  const [provider, setProvider] = useState("mtn-momo");
  const [msisdn, setMsisdn] = useState("");

  if (!state) return null;

  const vault = state.vault;
  const queuePending = state.queue.filter((q) => q.status === "queued");
  const reserved = queuePending.reduce((s, q) => s + q.amountXAF, 0);
  const offline = state.network.tier === "offline";
  const primary = state.wallets.find((w) => w.primary) ?? state.wallets[0];

  return (
    <div className="page">
      <div>
        <h1 style={{ fontSize: 22 }}>Wallet</h1>
        <p className="small muted" style={{ marginTop: 3 }}>
          {state.user.fullName} · KYC level {state.user.kycLevel} · member since {state.user.memberSince.slice(0, 4)}
        </p>
      </div>

      <div className="stack gap-9">
        {state.wallets.map((w) => (
          <div
            key={w.id}
            className="card"
            style={{
              padding: 14,
              borderColor: w.primary ? "rgba(255,203,5,.22)" : "var(--line)",
              background: w.primary
                ? "radial-gradient(120% 130% at 100% 0%, rgba(255,203,5,.1), transparent 55%), rgba(255,255,255,.02)"
                : undefined,
            }}
          >
            <div className="row-between">
              <div className="row gap-9">
                <span className="provider-logo" style={{ background: w.accent }}>
                  {w.provider === "mtn-momo" ? "M" : w.provider === "orange-money" ? "O" : "E"}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{w.providerName}</div>
                  <div className="tiny muted">{w.msisdn}</div>
                </div>
              </div>
              <div className="row gap-6">
                {w.primary ? (
                  <span className="badge accent">default</span>
                ) : (
                  <button
                    className="btn ghost xs"
                    type="button"
                    onClick={() => void makePrimaryWallet(w.id)}
                    disabled={busy === "wallet" || w.status !== "active"}
                  >
                    Make primary
                  </button>
                )}
                <span className={`badge ${w.status === "active" ? "ok" : "danger"}`}>{w.status}</span>
              </div>
            </div>
            <div className="row-between" style={{ marginTop: 12, alignItems: "flex-end" }}>
              <div>
                <div className="up" style={{ marginBottom: 3 }}>balance</div>
                <div className="num" style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.03em" }}>
                  {money(w.balanceXAF, { suffix: false })}
                  <span className="tiny muted" style={{ fontFamily: "var(--font-ui)", marginLeft: 4 }}>
                    FCFA
                  </span>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="tiny muted">
                  per txn {money(w.perTxnLimitXAF, { compact: true, suffix: false })}
                </div>
                <div className="tiny" style={{ color: w.offlineFloatXAF > 0 ? "var(--amber)" : "var(--dim)" }}>
                  offline float {money(w.offlineFloatXAF, { suffix: false })}
                </div>
              </div>
            </div>
            {w.primary && reserved > 0 && (
              <div className="tiny" style={{ marginTop: 6, color: "var(--amber)" }}>
                {money(reserved)} reserved by {queuePending.length} queued voucher{queuePending.length === 1 ? "" : "s"}
              </div>
            )}
          </div>
        ))}
      </div>

      <section className="card flat">
        <div className="section-head" style={{ marginBottom: 6 }}>
          <h2 style={{ fontSize: 13.5 }}>Payment options</h2>
          <span className="badge muted">{state.wallets.length} linked</span>
        </div>
        <p className="tiny muted" style={{ marginBottom: 10, lineHeight: 1.5 }}>
          The default wallet funds every payment unless you pick another one on the pay sheet. Linking a number here creates a
          sandbox account with a 20 000 FCFA float so you can try it.
        </p>
        {!linkOpen ? (
          <button className="btn ghost sm" type="button" style={{ justifyContent: "flex-start" }} onClick={() => setLinkOpen(true)}>
            <Icon name="plus" size={14} />
            Link another mobile-money account
          </button>
        ) : (
          <div className="stack gap-10">
            <div className="field">
              <label htmlFor="provider">Provider</label>
              <select id="provider" className="select" value={provider} onChange={(e) => setProvider(e.target.value)}>
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="wallet-msisdn">Number</label>
              <input
                id="wallet-msisdn"
                className="input"
                inputMode="tel"
                placeholder="6 55 77 88 99"
                value={msisdn}
                onChange={(e) => setMsisdn(e.target.value)}
              />
            </div>
            <div className="btn-row">
              <button
                className="btn primary sm"
                type="button"
                disabled={busy === "wallet" || msisdn.replace(/\D/g, "").length < 8}
                onClick={async () => {
                  const ok = await linkWallet(provider, msisdn);
                  if (ok) {
                    setMsisdn("");
                    setLinkOpen(false);
                  }
                }}
              >
                <Icon name="plus" size={13} />
                Link wallet
              </button>
              <button className="btn ghost sm" type="button" onClick={() => setLinkOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="card flat">
        <div className="section-head" style={{ marginBottom: 4 }}>
          <h2 style={{ fontSize: 13.5 }}>Offline settlement</h2>
          <span className={`badge ${offline ? "warn" : "ok"}`}>{offline ? "radio off" : "online"}</span>
        </div>
        <div className="row gap-8" style={{ marginBottom: 12 }}>
          <div className="stat" style={{ flex: 1 }}>
            <div className="k">Per payment</div>
            <div className="v" style={{ fontSize: 15 }}>{money(state.user.settings.offlinePerTxnXAF, { suffix: false })}</div>
          </div>
          <div className="stat" style={{ flex: 1 }}>
            <div className="k">Daily cap</div>
            <div className="v" style={{ fontSize: 15 }}>{money(state.user.settings.offlineDailyXAF, { suffix: false })}</div>
          </div>
          <div className="stat" style={{ flex: 1 }}>
            <div className="k">Queued</div>
            <div className="v" style={{ fontSize: 15, color: queuePending.length ? "var(--amber)" : undefined }}>
              {queuePending.length}
            </div>
          </div>
        </div>
        <QueuePanel />
        <div className="tiny muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
          Each queued payment is an Ed25519-signed voucher with a monotonic counter. The settlement server rejects replays,
          expired vouchers and anything above your caps. <Link href="/docs#offline" style={{ color: "var(--accent)" }}>Protocol →</Link>
        </div>
      </section>

      <section className="card flat">
        <div className="section-head" style={{ marginBottom: 6 }}>
          <h2 style={{ fontSize: 13.5 }}>Trusted devices</h2>
          <span className="badge muted">{state.devices.filter((d) => d.trusted).length} active</span>
        </div>
        {state.devices.map((d) => (
          <div className="device-row" key={d.id}>
            <span className="device-icon">
              <Icon name={d.platform === "web" ? "globe" : "device"} size={16} />
            </span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row gap-6">
                <span style={{ fontSize: 12.5, fontWeight: 500 }}>{d.label}</span>
                {d.platform === "android-enclave" && <span className="badge accent" style={{ height: 17, fontSize: 8.5 }}>secure element</span>}
              </div>
              <div className="tiny muted">
                {d.status === "revoked" ? "revoked" : `seen ${relativeTime(d.lastSeenAt)}`} · key {d.keyHandle.slice(0, 10)}… · fp {d.fingerprint}
              </div>
            </div>
            <button
              className={`btn ${d.trusted ? "ghost" : "soft"} xs`}
              type="button"
              onClick={() => void trustDevice(d.id, !d.trusted)}
            >
              {d.trusted ? "Revoke" : "Trust"}
            </button>
          </div>
        ))}
        <div className="tiny muted" style={{ marginTop: 8, lineHeight: 1.45 }}>
          Revoking a device invalidates its settlement vouchers immediately — the counter and signature checks run against
          the live trust list.
        </div>
      </section>

      <section className="card flat">
        <div className="section-head" style={{ marginBottom: 10 }}>
          <h2 style={{ fontSize: 13.5 }}>Cloud vault</h2>
          <span className="badge info">encrypted</span>
        </div>
        <div className="row-between" style={{ marginBottom: 12 }}>
          <div className="vault-stat">
            <span className="v">{vault.syncedTxns}</span>
            <span className="k">receipts</span>
          </div>
          <div className="vault-stat">
            <span className="v" style={{ color: vault.pendingTxns ? "var(--amber)" : undefined }}>{vault.pendingTxns}</span>
            <span className="k">pending</span>
          </div>
          <div className="vault-stat">
            <span className="v">{(vault.encryptedBytes / 1024).toFixed(1)}<span className="tiny muted"> KB</span></span>
            <span className="k">at rest</span>
          </div>
          <div className="vault-stat">
            <span className="v" style={{ fontSize: 12 }}>{relativeTime(vault.lastSyncAt)}</span>
            <span className="k">last sync</span>
          </div>
        </div>
        <div className="row-between" style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}>
          <span className="tiny muted">Region · {vault.region}</span>
          <span className="tiny muted">AES-256-GCM · per-user key</span>
        </div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn soft sm" type="button" onClick={() => void sync()} disabled={busy === "sync" || offline}>
            <Icon name="refresh" size={13} className={busy === "sync" ? "spin" : ""} />
            Sync now
          </button>
          <a className="btn ghost sm" href="/api/export" download>
            <Icon name="download" size={13} />
            Export CSV
          </a>
        </div>
      </section>

      <section className="card flat">
        <div className="section-head" style={{ marginBottom: 8 }}>
          <h2 style={{ fontSize: 13.5 }}>Account</h2>
          <span className="badge ok">verified</span>
        </div>
        <div className="receipt-row">
          <span className="k">Phone</span>
          <span className="v">{state.user.phone}</span>
        </div>
        <div className="receipt-row">
          <span className="k">Email</span>
          <span className="v">{state.user.email}</span>
        </div>
        <div className="receipt-row">
          <span className="k">Home city</span>
          <span className="v">{state.user.city}, Cameroon</span>
        </div>
        <div className="receipt-row">
          <span className="k">Primary wallet</span>
          <span className="v">{primary.providerName}</span>
        </div>
        <div className="hairline" style={{ margin: "10px 0" }} />
        <div className="stack gap-8">
          <Link href="/security" className="btn ghost sm" style={{ justifyContent: "flex-start" }}>
            <Icon name="shield" size={14} />
            Security &amp; biometrics
          </Link>
          <Link href="/activity?view=recipients" className="btn ghost sm" style={{ justifyContent: "flex-start" }}>
            <Icon name="user" size={14} />
            Recipients &amp; downloads
          </Link>
          <Link href="/business" className="btn ghost sm" style={{ justifyContent: "flex-start" }}>
            <Icon name="store" size={14} />
            Business portal (payee sign-in)
          </Link>
          <Link href="/merchant" className="btn ghost sm" style={{ justifyContent: "flex-start" }}>
            <Icon name="qr" size={14} />
            Counter terminal
          </Link>
          <Link href="/docs" className="btn ghost sm" style={{ justifyContent: "flex-start" }}>
            <Icon name="layers" size={14} />
            Architecture &amp; API
          </Link>
        </div>
      </section>

      <section className="card" style={{ borderStyle: "dashed" }}>
        <div className="up" style={{ marginBottom: 8 }}>demo controls</div>
        <div className="stack gap-8">
          <button
            className="btn ghost sm"
            type="button"
            style={{ justifyContent: "flex-start" }}
            onClick={() => void rotateSensor()}
            disabled={busy === "enroll"}
          >
            <Icon name="key" size={14} />
            Rotate sensor secret (re-bind templates)
          </button>
          <button
            className="btn ghost sm"
            type="button"
            style={{ justifyContent: "flex-start" }}
            onClick={() => {
              try {
                localStorage.removeItem("bsp.session");
              } catch {
                /* ignore */
              }
              window.location.reload();
            }}
          >
            <Icon name="lock" size={14} />
            Lock app and sign out
          </button>
          <button
            className="btn ghost sm"
            type="button"
            style={{ justifyContent: "flex-start" }}
            onClick={() => void reseedDemo()}
            disabled={busy === "reset"}
          >
            <Icon name="refresh" size={14} />
            Reseed 90-day demo data
          </button>
        </div>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          Rotating the sensor generates a new device secret and re-binds every enrolled finger — the same ceremony a hardware
          swap would force.
        </div>
      </section>
    </div>
  );
}
