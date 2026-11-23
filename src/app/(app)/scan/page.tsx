"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { MerchantAvatar } from "@/components/MerchantAvatar";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/controls";
import { apiJson, sleep } from "@/lib/client";
import { CATEGORY_META, money, relativeTime } from "@/lib/format";
import type { PaymentRequest } from "@/lib/types";

export default function ScanPage() {
  const { state, openPay, refresh, toast } = useApp();
  const [scanning, setScanning] = useState(false);
  const [detected, setDetected] = useState<PaymentRequest | null>(null);
  const [merchantId, setMerchantId] = useState("");
  const [amount, setAmount] = useState("");
  const deepLinkHandled = useRef(false);

  /*
   * Merchant QR codes encode /scan?req=<id>. Scanning one with the phone
   * camera lands here: open the sheet for that exact request instead of
   * making the customer hunt for it in the list.
   */
  useEffect(() => {
    if (deepLinkHandled.current || !state) return;
    const id = new URLSearchParams(window.location.search).get("req");
    if (!id) return;
    deepLinkHandled.current = true;
    window.history.replaceState({}, "", "/scan");
    const request = state.requests.find((r) => r.id === id);
    if (!request) {
      toast("That payment link is not valid any more", "danger");
      return;
    }
    if (request.status !== "open") {
      toast(`Request ${request.ref} is already ${request.status}`, "warn");
      void refresh();
      return;
    }
    openPay({
      requestId: request.id,
      merchantId: request.merchantId,
      merchantName: request.merchantName,
      merchantCode: request.merchantCode,
      amountXAF: request.amountXAF,
      note: request.note,
      category: request.category,
      channel: "qr-scan",
      source: "request",
    });
  }, [state, openPay, toast, refresh]);

  if (!state) return null;
  const requests = state.requests.filter((r) => r.status === "open");
  const offline = state.network.tier === "offline";

  const scan = async () => {
    if (scanning) return;
    setScanning(true);
    setDetected(null);
    try {
      await sleep(650);
      let request = requests[Math.floor(Math.random() * requests.length)];
      if (!request) {
        const merchant = state.merchants.find((m) => !m.flagged) ?? state.merchants[0];
        const res = await apiJson<{ request: PaymentRequest }>("/api/merchant", {
          method: "POST",
          body: JSON.stringify({ merchantId: merchant.id, amountXAF: 4_500, note: "Counter sale" }),
        });
        request = res.request;
        await refresh();
      }
      setDetected(request);
      await sleep(520);
      openPay({
        requestId: request.id,
        merchantId: request.merchantId,
        merchantName: request.merchantName,
        merchantCode: request.merchantCode,
        amountXAF: request.amountXAF,
        note: request.note,
        category: request.category,
        channel: offline ? "offline-qr" : "qr-scan",
        source: "request",
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Scanner unavailable", "danger");
    } finally {
      setScanning(false);
      setDetected(null);
    }
  };

  const manualAmount = Number(amount.replace(/\s/g, ""));
  const selected = state.merchants.find((m) => m.id === merchantId);

  return (
    <div className="page">
      <div>
        <h1 style={{ fontSize: 22 }}>Scan to pay</h1>
        <p className="small muted" style={{ marginTop: 4 }}>
          The QR is a signed payment request — the amount, merchant and nonce are verified before the sensor opens.
        </p>
      </div>

      <div className={`scanner ${scanning ? "detected" : ""}`}>
        <span className="grid-bg" />
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
        <span className="laser" />
        <div className="scan-cta">
          <span className="qr-glyph">
            <Icon name={detected ? "check" : "qr"} size={detected ? 40 : 44} strokeWidth={1.3} />
          </span>
          <span style={{ fontSize: 12.5, fontWeight: 500, color: detected ? "var(--mint)" : "var(--text-2)" }}>
            {detected ? detected.merchantName : scanning ? "Reading merchant code…" : "Camera ready"}
          </span>
          <span className="tiny muted">
            {detected ? `${money(detected.amountXAF)} · ${detected.ref}` : "Simulated viewfinder — no camera permission needed"}
          </span>
        </div>
        {offline && (
          <span className="badge warn" style={{ position: "absolute", top: 12, right: 12 }}>
            <Icon name="cloud" size={10} /> offline
          </span>
        )}
      </div>

      <button className="btn primary block" type="button" onClick={() => void scan()} disabled={scanning}>
        <Icon name="scan" size={17} />
        {scanning ? "Scanning…" : "Simulate a scan"}
      </button>

      <section>
        <div className="section-head" style={{ marginBottom: 9 }}>
          <h2>Nearby requests</h2>
          <span className="badge muted">{requests.length}</span>
        </div>
        <div className="stack gap-8">
          {requests.length === 0 && (
            <EmptyState
              icon={<Icon name="store" size={19} />}
              title="No open requests"
              body="Open the merchant terminal to mint a signed payment request, then it appears here."
              action={
                <a className="btn soft xs" href="/merchant" target="_blank" rel="noreferrer">
                  <Icon name="store" size={12} /> Merchant terminal
                </a>
              }
            />
          )}
          {requests.map((r) => {
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
                    channel: offline ? "offline-qr" : "qr-scan",
                    source: "request",
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

      <section className="card flat">
        <div className="section-head" style={{ marginBottom: 10 }}>
          <h2 style={{ fontSize: 13 }}>Enter a code manually</h2>
          <Icon name="pin" size={14} style={{ color: "var(--muted)" }} />
        </div>
        <div className="stack gap-10">
          <div className="field">
            <label htmlFor="m">Merchant</label>
            <select id="m" className="select" value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
              <option value="">Choose a merchant…</option>
              {state.merchants.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.geo.city}
                  {m.flagged ? " (flagged)" : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="a">Amount (FCFA)</label>
            <input
              id="a"
              className="input"
              inputMode="numeric"
              placeholder="5 000"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
            />
          </div>
          {selected && (
            <div className="row gap-8 tiny muted" style={{ lineHeight: 1.45 }}>
              <Icon name={selected.flagged ? "alert" : "info"} size={13} style={{ color: selected.flagged ? "var(--coral)" : "var(--muted)", flex: "none" }} />
              {selected.flagged
                ? "This merchant is flagged by the acquirer — the engine will block the payment."
                : `${CATEGORY_META[selected.category].label} · ${selected.geo.city} · acquirer risk ${selected.riskScore}/100`}
            </div>
          )}
          <button
            className="btn soft block"
            type="button"
            disabled={!selected || manualAmount < 100}
            onClick={() =>
              selected &&
              openPay({
                merchantId: selected.id,
                merchantName: selected.name,
                merchantCode: selected.code,
                amountXAF: manualAmount,
                category: selected.category,
                channel: offline ? "offline-qr" : "qr-scan",
                source: "manual",
              })
            }
          >
            <Icon name="arrow-right" size={16} />
            Continue
          </button>
        </div>
      </section>
    </div>
  );
}
