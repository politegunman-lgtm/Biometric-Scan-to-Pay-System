"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { MerchantAvatar } from "@/components/MerchantAvatar";
import { Icon } from "@/components/icons";
import { apiJson } from "@/lib/client";
import { CATEGORY_META, PROVIDER_LABEL, money, relativeTime, timeLabel } from "@/lib/format";
import type { Merchant, PaymentReason, PaymentRequest, Txn } from "@/lib/types";

interface TerminalData {
  merchants: Merchant[];
  requests: PaymentRequest[];
  today: { count: number; volumeXAF: number; pendingXAF: number };
  recent: Txn[];
  network: { tier: string; label: string; bars: number; online: boolean };
}

export default function MerchantTerminalPage() {
  const { state, toast, refresh } = useApp();
  const [data, setData] = useState<TerminalData | null>(null);
  const [merchantId, setMerchantId] = useState("mer_mfoundi");
  const [amount, setAmount] = useState("7500");
  const [note, setNote] = useState("Counter sale");
  const [active, setActive] = useState<PaymentRequest | null>(null);
  const [phoneUrl, setPhoneUrl] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [reasons, setReasons] = useState<PaymentReason[]>([]);
  const [reasonLabel, setReasonLabel] = useState("");
  const [reasonAsksStudent, setReasonAsksStudent] = useState(false);
  const [reasonsBusy, setReasonsBusy] = useState(false);

  const loadReasons = useCallback(async (id: string) => {
    try {
      const res = await apiJson<{ reasons: PaymentReason[] }>(`/api/reasons?merchantId=${encodeURIComponent(id)}`);
      setReasons(res.reasons);
    } catch {
      setReasons([]);
    }
  }, []);

  useEffect(() => {
    if (merchantId) void loadReasons(merchantId);
  }, [merchantId, loadReasons]);

  const saveReasons = async () => {
    setReasonsBusy(true);
    try {
      const res = await apiJson<{ message: string }>("/api/reasons", {
        method: "POST",
        body: JSON.stringify({ merchantId, reasons }),
      });
      toast(res.message, "ok");
      // Re-read so ids match what the server stored (it slugifies labels).
      await loadReasons(merchantId);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save reasons", "danger");
    } finally {
      setReasonsBusy(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const next = await apiJson<TerminalData>("/api/merchant");
      setData(next);
      setActive((cur) => (cur ? next.requests.find((r) => r.id === cur.id) ?? cur : cur));
    } catch {
      /* terminal keeps last known state */
    }
  }, []);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => void load(), 3000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [load]);

  // People are payees for transfers, not terminals — only businesses and
  // service desks can mint a signed request here.
  const merchants = (data?.merchants ?? state?.merchants ?? []).filter((m) => m.kind !== "person");
  const merchant = merchants.find((m) => m.id === merchantId);
  const amountNumber = Number(amount.replace(/[^\d]/g, "")) || 0;

  // The QR is a phone-openable deep link, not raw protocol bytes: scanning it
  // with the camera app launches the wallet straight into this request.
  const qrData = useMemo(() => {
    if (!active) return null;
    if (phoneUrl) return encodeURIComponent(phoneUrl);
    const payload = ["BSP1", active.id, active.merchantId, String(active.amountXAF), active.nonce, String(new Date(active.expiresAt).getTime()), active.signature].join("|");
    return encodeURIComponent(payload);
  }, [active, phoneUrl]);

  const remaining = active ? Math.max(0, new Date(active.expiresAt).getTime() - now) : 0;
  const mm = Math.floor(remaining / 60_000);
  const ss = Math.floor((remaining % 60_000) / 1000);
  const paid = active?.status === "paid";
  const paidTxn = paid ? data?.recent.find((t) => t.id === active?.paidTxnId) ?? state?.txns.find((t) => t.id === active?.paidTxnId) : undefined;

  const create = async () => {
    if (!merchant || amountNumber < 100) return;
    setCreating(true);
    try {
      const res = await apiJson<{ request: PaymentRequest; phoneUrl?: string }>("/api/merchant", {
        method: "POST",
        body: JSON.stringify({ merchantId, amountXAF: amountNumber, note }),
      });
      setActive(res.request);
      setPhoneUrl(res.phoneUrl ?? null);
      await load();
      void refresh();
      toast("Signed payment request live — scan it in the app", "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create request", "danger");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="merchant-shell">
      <div className="merchant-header">
        <div className="row gap-11">
          <span
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              display: "grid",
              placeItems: "center",
              background: "linear-gradient(160deg,#FFE270,#FFCB05)",
              color: "#171200",
            }}
          >
            <Icon name="store" size={20} />
          </span>
          <div>
            <div className="up">Merchant terminal</div>
            <h1 style={{ fontSize: 21, marginTop: 1 }}>{merchant?.name ?? "Select a merchant"}</h1>
          </div>
        </div>
        <div className="row gap-8">
          <span className="net-chip" data-bars={data?.network.bars ?? 3} data-tier={data?.network.tier ?? "good"}>
            <span className="bars">
              <i />
              <i />
              <i />
              <i />
            </span>
            {data?.network.label ?? "3G"}
          </span>
          <Link href="/business" className="btn ghost sm">
            <Icon name="store" size={13} />
            Business portal
          </Link>
          <Link href="/" className="btn ghost sm">
            <Icon name="chevron-left" size={14} />
            Wallet app
          </Link>
        </div>
      </div>

      <div className="merchant-grid">
        <section className="panel">
          <div className="row-between" style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 15 }}>New payment request</h2>
            <span className="badge accent">signed QR</span>
          </div>

          <div className="stack gap-12">
            <div className="field">
              <label htmlFor="merchant">Payee profile</label>
              <select id="merchant" className="select" value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
                {merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} · {m.geo.city} {m.flagged ? "· flagged" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="amount">Amount (FCFA)</label>
              <input
                id="amount"
                className="input"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                style={{ fontFamily: "var(--font-display)", fontSize: 22, height: 58, letterSpacing: "-0.02em" }}
              />
            </div>

            <div className="row gap-6" style={{ flexWrap: "wrap" }}>
              {[1_000, 3_500, 7_500, 12_000, 25_000].map((v) => (
                <button key={v} type="button" className="chip" onClick={() => setAmount(String(v))}>
                  {money(v, { suffix: false })}
                </button>
              ))}
            </div>

            <div className="field">
              <label htmlFor="note">Reference note</label>
              <input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={48} />
            </div>

            <button className="btn primary block" type="button" onClick={() => void create()} disabled={creating || !merchant}>
              <Icon name="qr" size={17} />
              {creating ? "Signing…" : "Generate QR request"}
            </button>
          </div>

          <div className="hairline" style={{ margin: "18px 0 14px" }} />

          {active && qrData ? (
            <div className="stack gap-10" style={{ alignItems: "center" }}>
              <div className="qr-frame" style={{ position: "relative", opacity: paid ? 0.4 : 1 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/qr?data=${qrData}`} alt={`Payment QR for ${money(active.amountXAF)}`} width={230} height={230} />
                {paid && (
                  <span
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      background: "rgba(255,255,255,.7)",
                      borderRadius: 16,
                    }}
                  >
                    <span className="badge ok" style={{ height: 30, fontSize: 12 }}>
                      <Icon name="check" size={14} /> PAID
                    </span>
                  </span>
                )}
              </div>
              <div className="center">
                <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>
                  {money(active.amountXAF)}
                </div>
                <div className="tiny muted" style={{ marginTop: 2 }}>
                  {active.ref} · {active.note ?? "Payment request"}
                </div>
                {active.reason && (
                  <div className="tiny" style={{ marginTop: 3, color: "var(--accent)" }}>
                    {active.reason}
                    {active.payerFor ? ` · ${active.payerFor}` : ""}
                  </div>
                )}
                <div className="row gap-6" style={{ justifyContent: "center", marginTop: 7 }}>
                  {paid ? (
                    <span className="badge ok">settled {paidTxn ? timeLabel(paidTxn.settledAt ?? paidTxn.createdAt) : ""}</span>
                  ) : (
                    <span className="badge warn">
                      expires in {mm}:{String(ss).padStart(2, "0")}
                    </span>
                  )}
                  <span className="badge muted">{merchant?.code}</span>
                </div>
              </div>
              {!paid && (
                <>
                  {phoneUrl && (
                    <button
                      type="button"
                      className="chip"
                      style={{ maxWidth: "100%" }}
                      onClick={async () => {
                        // navigator.clipboard needs a secure context; over plain
                        // http LAN we fall back to showing the link.
                        try {
                          if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
                          await navigator.clipboard.writeText(phoneUrl);
                          toast("Payment link copied — paste it in the phone browser", "ok");
                        } catch {
                          toast(phoneUrl, "info");
                        }
                      }}
                    >
                      <Icon name="link" size={12} />
                      <span className="truncate">{phoneUrl.replace(/^https?:\/\//, "")}</span>
                      <Icon name="copy" size={12} />
                    </button>
                  )}
                  <p className="tiny muted center" style={{ maxWidth: 300, lineHeight: 1.5 }}>
                    Point the phone camera at this code, or open the link above on the phone. It lands directly on this
                    request — the signature is verified before the sensor opens.
                  </p>
                </>
              )}
              {paid && (
                <div className="btn-row" style={{ width: "100%" }}>
                  <button className="btn soft sm" type="button" onClick={() => setActive(null)}>
                    <Icon name="plus" size={13} />
                    New sale
                  </button>
                  <button className="btn ghost sm" type="button" onClick={() => void load()}>
                    <Icon name="refresh" size={13} />
                    Refresh
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div
              className="stack gap-8"
              style={{
                alignItems: "center",
                padding: "26px 16px",
                border: "1px dashed rgba(255,255,255,.12)",
                borderRadius: 16,
                textAlign: "center",
              }}
            >
              <span style={{ color: "var(--dim)" }}>
                <Icon name="qr" size={38} strokeWidth={1.2} />
              </span>
              <div className="small muted">Your signed QR appears here.</div>
              <div className="tiny" style={{ color: "var(--dim)" }}>
                Merchant {merchant?.code} · acquirer risk {merchant?.riskScore}/100
              </div>
            </div>
          )}
        </section>

        <section className="stack gap-14" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="panel">
            <div className="row-between" style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 15 }}>Today</h2>
              <span className="badge ok">
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--mint)" }} />
                live
              </span>
            </div>
            <div className="stat-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
              <div className="stat">
                <div className="k">Payments</div>
                <div className="v">{data?.today.count ?? 0}</div>
              </div>
              <div className="stat">
                <div className="k">Volume</div>
                <div className="v" style={{ fontSize: 15 }}>
                  {money(data?.today.volumeXAF ?? 0, { compact: true, suffix: false })}
                </div>
              </div>
              <div className="stat">
                <div className="k">Queued</div>
                <div className="v" style={{ fontSize: 15, color: (data?.today.pendingXAF ?? 0) > 0 ? "var(--amber)" : undefined }}>
                  {money(data?.today.pendingXAF ?? 0, { compact: true, suffix: false })}
                </div>
              </div>
            </div>
            {(data?.today.pendingXAF ?? 0) > 0 && (
              <div className="tiny" style={{ marginTop: 8, color: "var(--amber)", lineHeight: 1.45 }}>
                Offline vouchers are guaranteed by the issuer and settle when the customer reconnects — no chargeback risk to
                the merchant below the cap.
              </div>
            )}

            <div className="hairline" style={{ margin: "14px 0 10px" }} />
            <div className="up" style={{ marginBottom: 6 }}>recent payments</div>
            {(data?.recent ?? []).length === 0 && <div className="small muted">No payments yet today.</div>}
            {(data?.recent ?? []).map((t) => (
              <div className="row" key={t.id} style={{ padding: "7px 0", gap: 9 }}>
                <MerchantAvatar name={t.merchantName} hue={merchants.find((m) => m.id === t.merchantId)?.logoHue ?? 42} size="sm" />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontSize: 12 }}>{t.merchantName}</div>
                  <div className="tiny muted">
                    {timeLabel(t.createdAt)} · {PROVIDER_LABEL[t.provider]} {t.offline ? "· offline" : ""}
                  </div>
                  {(t.reason || t.payerFor) && (
                    <div className="tiny" style={{ color: "var(--text-2)" }}>
                      {t.reason ?? "Payment"}
                      {t.payerFor ? ` · ${t.payerFor}` : ""}
                    </div>
                  )}
                </div>
                <span className={`badge ${t.status === "settled" ? "ok" : t.status === "queued" ? "warn" : "danger"}`}>
                  {money(t.amountXAF, { suffix: false })}
                </span>
              </div>
            ))}
          </div>

          <div className="panel">
            <div className="row-between" style={{ marginBottom: 6 }}>
              <h2 style={{ fontSize: 15 }}>Payment reasons</h2>
              <span className="badge muted">{reasons.length}</span>
            </div>
            <p className="tiny muted" style={{ marginBottom: 10, lineHeight: 1.5 }}>
              Reasons customers can pick when they pay {merchant?.name ?? "this payee"} from the app. Schools and clinics use
              them to reconcile fees; reasons flagged <em>asks student</em> also prompt for the student&rsquo;s name.
            </p>
            <div className="row gap-6" style={{ flexWrap: "wrap", marginBottom: 10 }}>
              {reasons.map((r) => (
                <span key={r.id} className="chip active" style={{ gap: 6 }}>
                  {r.label}
                  {r.askStudent && <span className="tiny" style={{ opacity: 0.7 }}>· student</span>}
                  <button
                    type="button"
                    aria-label={`Remove ${r.label}`}
                    onClick={() => setReasons((list) => list.filter((x) => x.id !== r.id))}
                    style={{ background: "none", border: "none", color: "inherit", padding: 0, cursor: "pointer" }}
                  >
                    <Icon name="x" size={10} />
                  </button>
                </span>
              ))}
              {reasons.length === 0 && <span className="tiny muted">No reasons published yet.</span>}
            </div>
            <div className="stack gap-8">
              <div className="row gap-8">
                <input
                  className="input"
                  placeholder="Add a reason, e.g. Library books"
                  value={reasonLabel}
                  maxLength={40}
                  onChange={(e) => setReasonLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && reasonLabel.trim().length >= 2) {
                      setReasons((list) => [
                        ...list,
                        { id: `draft_${list.length + 1}`, label: reasonLabel.trim(), askStudent: reasonAsksStudent },
                      ]);
                      setReasonLabel("");
                    }
                  }}
                />
                <button
                  className="btn ghost sm"
                  type="button"
                  disabled={reasonLabel.trim().length < 2 || reasons.length >= 8}
                  onClick={() => {
                    setReasons((list) => [
                      ...list,
                      { id: `draft_${list.length + 1}`, label: reasonLabel.trim(), askStudent: reasonAsksStudent },
                    ]);
                    setReasonLabel("");
                  }}
                >
                  <Icon name="plus" size={13} />
                  Add
                </button>
              </div>
              <label className="row gap-8 tiny muted" style={{ alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={reasonAsksStudent}
                  onChange={(e) => setReasonAsksStudent(e.target.checked)}
                />
                Ask for the student&rsquo;s name when this reason is chosen
              </label>
              <button
                className="btn soft sm"
                type="button"
                onClick={() => void saveReasons()}
                disabled={reasonsBusy || merchant?.kind === "person"}
              >
                <Icon name="check" size={13} />
                {reasonsBusy ? "Saving…" : "Save reasons"}
              </button>
              <span className="tiny muted">
                Customers see the saved list the next time they pick this payee. Up to 8 reasons.
              </span>
            </div>
          </div>

          <div className="panel">
            <div className="row-between" style={{ marginBottom: 10 }}>
              <h2 style={{ fontSize: 15 }}>Open requests</h2>
              <span className="badge muted">{data?.requests.filter((r) => r.status === "open").length ?? 0}</span>
            </div>
            <div className="stack" style={{ gap: 0 }}>
              {(data?.requests ?? []).slice(0, 7).map((r) => (
                <div className={`pay-request-row ${r.status === "paid" ? "paid" : ""}`} key={r.id}>
                  <span
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      display: "grid",
                      placeItems: "center",
                      background: r.status === "paid" ? "rgba(75,221,160,.12)" : "rgba(255,203,5,.1)",
                      color: r.status === "paid" ? "var(--mint)" : "var(--accent)",
                      flex: "none",
                    }}
                  >
                    <Icon name={r.status === "paid" ? "check" : "clock"} size={14} />
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 500 }} className="truncate">
                      {r.merchantName}
                    </div>
                    <div className="tiny muted">
                      {r.ref} · {r.note ?? "no note"} · {r.status === "paid" ? "paid" : `expires ${relativeTime(r.expiresAt)}`}
                    </div>
                  </div>
                  <span style={{ textAlign: "right" }}>
                    <span className="num" style={{ fontSize: 12.5 }}>{money(r.amountXAF, { suffix: false })}</span>
                    <span className="tiny muted" style={{ display: "block" }}>FCFA</span>
                  </span>
                </div>
              ))}
              {(data?.requests ?? []).length === 0 && <div className="small muted">No requests yet — generate one on the left.</div>}
            </div>
          </div>

          <div className="panel" style={{ padding: 16 }}>
            <div className="row gap-9">
              <span style={{ color: "var(--mint)" }}>
                <Icon name="shield-check" size={18} />
              </span>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>Acquirer protections</div>
                <div className="tiny muted" style={{ lineHeight: 1.5 }}>
                  Signed requests, amount-bound QR, replay-proof nonces, and offline vouchers guaranteed up to the customer
                  cap. Merchant fee 1.5% — waived on offline settlement.
                </div>
              </div>
            </div>
            <div className="hairline" style={{ margin: "12px 0 8px" }} />
            <div className="row-between tiny muted">
              <span>{CATEGORY_META[merchant?.category ?? "groceries"].label}</span>
              <span>risk {merchant?.riskScore ?? 0}/100 {merchant?.flagged ? "· FLAGGED" : ""}</span>
              <span>{merchant?.geo.city}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
