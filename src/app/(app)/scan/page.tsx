"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { MerchantAvatar } from "@/components/MerchantAvatar";
import { Icon } from "@/components/icons";
import { EmptyState } from "@/components/controls";
import { apiJson, sleep } from "@/lib/client";
import { reasonsFor } from "@/lib/reasons";
import { CATEGORY_META, money, relativeTime } from "@/lib/format";
import type { PaymentRequest } from "@/lib/types";

interface Payee {
  id: string;
  name: string;
  initials: string;
  kind: "business" | "person" | "service";
  category: keyof typeof CATEGORY_META;
  tagline: string | null;
  logoHue: number;
  verified: boolean;
  code: string;
  msisdnMasked: string;
  isNew?: boolean;
  reasons: { id: string; label: string; askStudent?: boolean }[];
}

interface Directory {
  people: Payee[];
  services: Payee[];
  counts: { people: number; services: number };
  me: Payee | null;
}

type Tab = "scan" | "people" | "services";

const QUICK_AMOUNTS = [1_000, 2_000, 5_000, 10_000];

export default function ScanPage() {
  const { state, openPay, refresh, toast } = useApp();
  const [tab, setTab] = useState<Tab>("scan");

  // scanner
  const [scanning, setScanning] = useState(false);
  const [detected, setDetected] = useState<PaymentRequest | null>(null);
  const [merchantId, setMerchantId] = useState("");
  const [amount, setAmount] = useState("");

  // directory
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [query, setQuery] = useState("");
  const [payee, setPayee] = useState<Payee | null>(null);
  const [sendAmount, setSendAmount] = useState("");
  const [reasonId, setReasonId] = useState<string>("");
  const [payerFor, setPayerFor] = useState("");
  const [sending, setSending] = useState(false);
  const [origin, setOrigin] = useState("");

  const deepLinkHandled = useRef(false);
  const composerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    // /scan?tab=people|services — the home screen's shortcut buttons land here.
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("tab");
    if (wanted === "people" || wanted === "services") setTab(wanted);
    const preset = params.get("q");
    if (preset) setQuery(preset);
  }, []);

  const loadDirectory = useCallback(async (q: string) => {
    try {
      const data = await apiJson<Directory & { ok: boolean }>(`/api/directory?q=${encodeURIComponent(q)}`);
      setDirectory(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => void loadDirectory(query), query ? 220 : 0);
    return () => window.clearTimeout(id);
  }, [query, loadDirectory]);

  /* Merchant QR: /scan?req=<id>  ·  Person QR: /scan?to=<payeeId> */
  useEffect(() => {
    if (!state || deepLinkHandled.current) return;
    const params = new URLSearchParams(window.location.search);

    const requestId = params.get("req");
    const toId = params.get("to");
    if (!requestId && !toId) return;
    deepLinkHandled.current = true;
    window.history.replaceState({}, "", "/scan");

    if (requestId) {
      const request = state.requests.find((r) => r.id === requestId);
      if (!request) return void toast("That payment link is not valid any more", "danger");
      if (request.status !== "open") return void toast(`Request ${request.ref} is already ${request.status}`, "warn");
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
      return;
    }

    // Person QR: open the send composer for that payee.
    setTab("people");
    void (async () => {
      const data = (await loadDirectory("")) ?? directory;
      const found =
        data?.people.find((p) => p.id === toId) ??
        (data?.me && data.me.id === toId ? data.me : null);
      if (found) {
        setPayee(found);
        window.setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
      } else {
        toast("That person is not on Scan to Pay yet", "warn");
      }
    })();
  }, [state, openPay, toast, loadDirectory, directory]);

  if (!state) return null;

  const requests = state.requests.filter((r) => r.status === "open");
  const offline = state.network.tier === "offline";
  const manualAmount = Number(amount.replace(/\s/g, ""));
  const selected = state.merchants.find((m) => m.id === merchantId);

  const scan = async () => {
    if (scanning) return;
    setScanning(true);
    setDetected(null);
    try {
      await sleep(650);
      let request = requests[Math.floor(Math.random() * requests.length)];
      if (!request) {
        const merchant = state.merchants.find((m) => !m.flagged && m.kind !== "person") ?? state.merchants[0];
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

  const startPayment = async (target: Payee, value: number, note: string) => {
    if (!Number.isFinite(value) || value < 100) {
      toast("Enter at least 100 FCFA", "warn");
      return;
    }
    const reason = target.reasons.find((r) => r.id === reasonId);
    if (reason?.askStudent && payerFor.trim().length < 2) {
      toast(`Enter the student's name for "${reason.label}"`, "warn");
      return;
    }
    setSending(true);
    try {
      const res = await apiJson<{ request: PaymentRequest }>("/api/merchant", {
        method: "POST",
        body: JSON.stringify({
          merchantId: target.id,
          amountXAF: Math.round(value),
          note,
          reasonId: reasonId || undefined,
          payerFor: reason?.askStudent ? payerFor.trim() : undefined,
        }),
      });
      await refresh();
      setPayee(null);
      setSendAmount("");
      setReasonId("");
      setPayerFor("");
      openPay({
        requestId: res.request.id,
        merchantId: res.request.merchantId,
        merchantName: res.request.merchantName,
        merchantCode: res.request.merchantCode,
        amountXAF: res.request.amountXAF,
        note: res.request.note,
        category: res.request.category,
        channel: offline ? "offline-qr" : "qr-scan",
        source: "request",
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not start the payment", "danger");
    } finally {
      setSending(false);
    }
  };

  const myLink = directory?.me ? `${origin}/scan?to=${encodeURIComponent(directory.me.id)}` : "";

  return (
    <div className="page">
      <div>
        <h1 style={{ fontSize: 22 }}>Pay</h1>
        <p className="small muted" style={{ marginTop: 4 }}>
          Scan a code, pay a bill, or send money to someone on the network.
        </p>
      </div>

      <div className="segmented">
        {(
          [
            { id: "scan" as Tab, label: "Scan", icon: "qr" as const },
            { id: "people" as Tab, label: "People", icon: "send" as const },
            { id: "services" as Tab, label: "Bills", icon: "bolt" as const },
          ]
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
          >
            <Icon name={item.icon} size={13} />
            {item.label}
          </button>
        ))}
      </div>

      {tab === "scan" && (
        <>
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
                {detected ? detected.merchantName : scanning ? "Reading code…" : "Camera ready"}
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
                <label htmlFor="m">Payee</label>
                <select id="m" className="select" value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
                  <option value="">Choose a shop or biller…</option>
                  {state.merchants
                    .filter((m) => m.kind !== "person")
                    .map((m) => (
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
            </div>
            <button
              className="btn soft block"
              type="button"
              style={{ marginTop: 12 }}
              disabled={!selected || manualAmount < 100}
              onClick={() => {
                if (!selected) return;
                void startPayment(
                  {
                    id: selected.id,
                    name: selected.name,
                    initials: selected.name.slice(0, 1),
                    kind: "business",
                    category: selected.category,
                    tagline: null,
                    logoHue: selected.logoHue,
                    verified: selected.verified,
                    code: selected.code,
                    msisdnMasked: "",
                    reasons: reasonsFor(selected),
                  },
                  manualAmount,
                  "Manual entry",
                );
              }}
            >
              <Icon name="fingerprint" size={15} />
              Continue to authorise {manualAmount >= 100 ? money(manualAmount) : ""}
            </button>
          </section>
        </>
      )}

      {tab !== "scan" && (
        <>
          <div className="search">
            <Icon name="search" size={14} />
            <input
              className="input"
              placeholder={tab === "people" ? "Search a name or a phone number…" : "Search a biller or shop…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search directory"
            />
          </div>

          {payee && (
            <div className="card compose" ref={composerRef}>
              <div className="row gap-10" style={{ alignItems: "center" }}>
                <MerchantAvatar name={payee.name} hue={payee.logoHue} />
                <div className="grow">
                  <div className="truncate" style={{ fontSize: 13.5, fontWeight: 500 }}>{payee.name}</div>
                  <div className="tiny muted truncate">
                    {payee.kind === "person" ? payee.msisdnMasked : `${CATEGORY_META[payee.category].label} · ${payee.tagline ?? ""}`}
                  </div>
                </div>
                <button className="btn ghost xs" type="button" onClick={() => setPayee(null)} aria-label="Cancel">
                  <Icon name="x" size={12} />
                </button>
              </div>

              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="send">
                  {payee.kind === "person" ? "Amount to send" : "Amount to pay"} (FCFA)
                </label>
                <input
                  id="send"
                  className="input amount-input"
                  inputMode="numeric"
                  autoFocus
                  placeholder="5 000"
                  value={sendAmount}
                  onChange={(e) => setSendAmount(e.target.value.replace(/[^\d]/g, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void startPayment(payee, Number(sendAmount), payee.kind === "person" ? "P2P transfer" : "Bill payment");
                  }}
                />
              </div>
              <div className="chip-row" style={{ marginTop: 8 }}>
                {QUICK_AMOUNTS.map((value) => (
                  <button key={value} type="button" className="chip" onClick={() => setSendAmount(String(value))}>
                    {money(value, { suffix: false })}
                  </button>
                ))}
              </div>

              {payee.reasons.length > 0 && (
                <>
                  <div className="field" style={{ marginTop: 12 }}>
                    <label htmlFor="reason">Reason for payment</label>
                    <select
                      id="reason"
                      className="select"
                      value={reasonId}
                      onChange={(e) => {
                        setReasonId(e.target.value);
                        const next = payee.reasons.find((r) => r.id === e.target.value);
                        if (!next?.askStudent) setPayerFor("");
                      }}
                    >
                      <option value="">Choose a reason (optional)…</option>
                      {payee.reasons.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {payee.reasons.find((r) => r.id === reasonId)?.askStudent && (
                    <div className="field" style={{ marginTop: 10 }}>
                      <label htmlFor="payer-for">Student name</label>
                      <input
                        id="payer-for"
                        className="input"
                        placeholder="e.g. Marie Claire Ngo"
                        value={payerFor}
                        maxLength={60}
                        onChange={(e) => setPayerFor(e.target.value)}
                      />
                      <span className="tiny muted">Appears on the receipt so the school can match the payment to a student.</span>
                    </div>
                  )}
                </>
              )}

              <button
                className="btn primary block"
                type="button"
                style={{ marginTop: 12 }}
                disabled={sending || Number(sendAmount) < 100}
                onClick={() => void startPayment(payee, Number(sendAmount), payee.kind === "person" ? "P2P transfer" : "Bill payment")}
              >
                <Icon name="fingerprint" size={15} />
                {sending ? "Preparing…" : `Send ${Number(sendAmount) >= 100 ? money(Number(sendAmount)) : ""}`}
              </button>
              <div className="tiny muted" style={{ marginTop: 8, lineHeight: 1.45 }}>
                The request is signed first; your fingerprint authorises it. {payee.kind === "person" ? "Transfers arrive instantly." : "Bills post to the operator."}
              </div>
            </div>
          )}

          {tab === "people" && (
            <>
              <section>
                <div className="section-head" style={{ marginBottom: 9 }}>
                  <h2>On Scan to Pay</h2>
                  <span className="badge muted">{directory?.counts.people ?? 0}</span>
                </div>
                <div className="stack gap-8">
                  {(directory?.people ?? []).map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      className="merchant-request"
                      onClick={() => {
                        setPayee(person);
                        setSendAmount("");
                        setReasonId("");
                        setPayerFor("");
                        window.setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
                      }}
                    >
                      <MerchantAvatar name={person.name} hue={person.logoHue} />
                      <span className="grow">
                        <span className="truncate" style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{person.name}</span>
                        <span className="tiny muted truncate" style={{ display: "block" }}>
                          {person.msisdnMasked} · {person.tagline}
                        </span>
                      </span>
                      <span className="badge ok" style={{ height: 18, fontSize: 9 }}>on app</span>
                      <Icon name="send" size={14} className="arrow" />
                    </button>
                  ))}
                  {directory && directory.people.length === 0 && (
                    <EmptyState
                      icon={<Icon name="user" size={19} />}
                      title="Nobody found"
                      body="Try a different name, or the phone number they registered with."
                    />
                  )}
                </div>
              </section>

              {directory?.me && (
                <section className="card">
                  <div className="section-head" style={{ marginBottom: 10 }}>
                    <h2 style={{ fontSize: 13 }}>Your code</h2>
                    <span className="badge accent" style={{ height: 18, fontSize: 9 }}>receive</span>
                  </div>
                  <div className="row gap-12" style={{ alignItems: "center" }}>
                    <span className="qr-mini">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/qr?data=${encodeURIComponent(myLink)}`} alt="Your payment code" width={96} height={96} />
                    </span>
                    <div className="grow">
                      <div style={{ fontSize: 12.5, fontWeight: 500 }}>{directory.me.name}</div>
                      <div className="tiny muted" style={{ marginTop: 2 }}>{directory.me.msisdnMasked}</div>
                      <div className="tiny muted" style={{ marginTop: 6, lineHeight: 1.4 }}>
                        Anyone can scan this to send you money. It carries no amount — they choose it.
                      </div>
                      <button
                        className="btn ghost xs"
                        type="button"
                        style={{ marginTop: 8 }}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(myLink);
                            toast("Your payment link is copied", "ok");
                          } catch {
                            toast(myLink, "info");
                          }
                        }}
                      >
                        <Icon name="copy" size={11} />
                        Copy link
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {tab === "services" && (
            <section>
              <div className="section-head" style={{ marginBottom: 9 }}>
                <h2>Bills &amp; shops</h2>
                <span className="badge muted">{directory?.counts.services ?? 0}</span>
              </div>
              <div className="stack gap-8">
                {(directory?.services ?? []).map((service) => (
                  <button
                    key={service.id}
                    type="button"
                    className="merchant-request"
                    onClick={() => {
                      setPayee(service);
                      setSendAmount("");
                      setReasonId("");
                      setPayerFor("");
                      window.setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
                    }}
                  >
                    <MerchantAvatar name={service.name} hue={service.logoHue} />
                    <span className="grow">
                      <span className="truncate" style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{service.name}</span>
                      <span className="tiny muted truncate" style={{ display: "block" }}>
                        {service.tagline ?? CATEGORY_META[service.category].label}
                      </span>
                    </span>
                    {service.isNew ? (
                      <span className="badge accent" style={{ height: 18, fontSize: 9 }}>new</span>
                    ) : (
                      <span
                        className="badge muted"
                        style={{ height: 18, fontSize: 9, color: CATEGORY_META[service.category].color }}
                      >
                        {CATEGORY_META[service.category].label}
                      </span>
                    )}
                    <Icon name="chevron" size={14} className="arrow" />
                  </button>
                ))}
                {directory && directory.services.length === 0 && (
                  <EmptyState icon={<Icon name="bolt" size={19} />} title="Nothing matches" body="Try 'electricity', 'airtime' or 'school'." />
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
