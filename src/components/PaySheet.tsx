"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "./AppProvider";
import { BiometricPad, type PadStatus } from "./BiometricPad";
import { MerchantAvatar } from "./MerchantAvatar";
import { RiskSummary } from "./Risk";
import { Icon } from "./icons";
import { apiJson, haptic, sleep } from "@/lib/client";
import { CATEGORY_META, PROVIDER_LABEL, RISK_META, money, timeLabel } from "@/lib/format";
import { sensorCapture, sensorLiveness, type LivenessProof } from "@/lib/sensor";
import type { PayOutcome } from "@/lib/service";

type Stage = "review" | "verifying" | "challenge" | "result";

interface Capture {
  sample: number[];
  liveness: LivenessProof;
  quality: number;
}

export function PaySheet() {
  const { payTarget, closePay, state, refresh, toast, sensorSeed, setActiveTxn } = useApp();
  const [stage, setStage] = useState<Stage>("review");
  const [result, setResult] = useState<PayOutcome | null>(null);
  const [walletId, setWalletId] = useState<string>("");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [sim, setSim] = useState({ impostor: false, spoof: false, dry: false });
  const [smsRelay, setSmsRelay] = useState(false);
  const [capture, setCapture] = useState<Capture | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const tier = state?.network.tier ?? "good";
  const isOffline = tier === "offline";
  const wallet = useMemo(
    () => state?.wallets.find((w) => w.id === walletId) ?? state?.wallets.find((w) => w.primary) ?? state?.wallets[0],
    [state, walletId],
  );
  const merchant = useMemo(
    () => state?.merchants.find((m) => m.id === payTarget?.merchantId),
    [state, payTarget?.merchantId],
  );
  const finger = state?.biometric.fingers[0];
  const settings = state?.user.settings;

  const targetKey = `${payTarget?.requestId ?? payTarget?.merchantId}-${payTarget?.amountXAF}`;

  useEffect(() => {
    setStage("review");
    setResult(null);
    setPin("");
    setPinError(false);
    setCapture(null);
    setSmsRelay(false);
    setSubmitting(false);
    if (state) setWalletId(state.wallets.find((w) => w.primary)?.id ?? state.wallets[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  useEffect(() => {
    if (isOffline && settings && payTarget && payTarget.amountXAF > 10_000) setSmsRelay(false);
  }, [isOffline, settings, payTarget]);

  const submit = useCallback(
    async (args: { sample: number[]; liveness: LivenessProof; pin?: string }) => {
      if (!payTarget) return;
      setSubmitting(true);
      setStage("verifying");
      haptic(6);
      const latency = tier === "weak" ? 900 : tier === "good" ? 380 : 160;
      await sleep(latency);

      try {
        const payload = {
          requestId: payTarget.requestId,
          merchantId: payTarget.merchantId,
          amountXAF: payTarget.amountXAF,
          walletId: wallet?.id,
          fingerId: finger?.id,
          sample: args.sample,
          liveness: args.liveness,
          deviceId: "dev_pixel",
          offline: isOffline,
          channel: isOffline
            ? smsRelay
              ? "offline-sms"
              : "offline-qr"
            : payTarget.requestId
              ? "qr-scan"
              : "nfc-tap",
          pin: args.pin,
        };
        const res = await apiJson<PayOutcome>("/api/pay", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setResult(res);
        if (res.status === "challenged") {
          setPin("");
          setPinError(false);
          setStage("challenge");
          haptic([12, 40, 12]);
        } else if (res.status === "declined" && res.errorCode === "bad-pin") {
          // Stay on the keypad so the customer can retype instead of losing context.
          setResult((prev) => ({ ...res, risk: res.risk ?? prev?.risk }));
          setPin("");
          setPinError(true);
          setStage("challenge");
          haptic([24, 50, 24]);
        } else {
          setStage("result");
          haptic(res.status === "settled" ? [10, 30, 14] : res.status === "queued" ? [8, 50, 8] : [26, 60, 26]);
          if (res.status === "settled" || res.status === "queued") {
            void refresh();
          }
        }
      } catch (err) {
        setResult({
          status: "error",
          message: err instanceof Error ? err.message : "The payment could not be authorised",
        });
        setStage("result");
        haptic([30, 60, 30]);
      } finally {
        setSubmitting(false);
      }
    },
    [payTarget, tier, wallet?.id, finger?.id, isOffline, smsRelay, refresh],
  );

  const onCapture = useCallback(
    async ({ holdMs, stability }: { holdMs: number; stability: number }) => {
      if (!payTarget || !sensorSeed || !finger) {
        toast("Sensor not ready — try again in a moment", "warn");
        return;
      }
      const baseQuality = 0.8 + 0.18 * stability;
      const quality = sim.dry ? baseQuality * 0.56 : baseQuality;
      const sample = await sensorCapture({
        seed: sensorSeed,
        fingerId: finger.id,
        quality,
        impostor: sim.impostor,
      });
      const liveness = sensorLiveness(holdMs, sim.spoof);
      setCapture({ sample, liveness, quality });
      await submit({ sample, liveness });
    },
    [payTarget, sensorSeed, finger, sim, submit, toast],
  );

  const onPinKey = (digit: string) => {
    if (submitting || !capture) return;
    if (digit === "del") {
      setPin((p) => p.slice(0, -1));
      setPinError(false);
      return;
    }
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    setPinError(false);
    if (next.length === 4) {
      void submit({ ...capture, pin: next });
      if (result?.errorCode === "bad-pin") setPinError(true);
    }
  };

  if (!payTarget) return null;

  const status: PadStatus =
    stage === "verifying"
      ? "verifying"
      : stage === "result"
        ? result?.status === "declined" || result?.status === "error"
          ? "error"
          : "success"
        : "idle";

  const needsStepUp = (settings?.stepUpThresholdXAF ?? 50_000) <= payTarget.amountXAF;
  const overBalance = wallet ? payTarget.amountXAF > wallet.balanceXAF : false;
  const offlineCap = settings?.offlinePerTxnXAF ?? 10_000;
  const overOfflineCap = isOffline && payTarget.amountXAF > offlineCap;
  const canClose = stage !== "verifying";

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Payment authorisation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && canClose) closePay();
      }}
    >
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />

        <div className="sheet-head">
          <div>
            <div className="up">{stage === "result" ? "Payment result" : stage === "challenge" ? "Step-up check" : "Authorise payment"}</div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 17, fontWeight: 600, marginTop: 2 }}>
              {stage === "result"
                ? result?.status === "settled"
                  ? "Payment complete"
                  : result?.status === "queued"
                    ? "Queued for settlement"
                    : result?.status === "challenged"
                      ? "Extra verification"
                      : "Payment stopped"
                : payTarget.merchantName}
            </div>
          </div>
          <button className="icon-btn" type="button" onClick={closePay} disabled={!canClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* ---------------- review & biometric ---------------- */}
        {(stage === "review" || stage === "verifying") && (
          <>
            <div className="pay-merchant">
              <MerchantAvatar name={payTarget.merchantName} hue={merchant?.logoHue ?? 42} />
              <div className="pay-amount">
                {money(payTarget.amountXAF, { suffix: false })}
                <span className="cur">FCFA</span>
              </div>
              <div className="pay-meta">
                <span>{CATEGORY_META[payTarget.category].label}</span>
                {payTarget.note && (
                  <>
                    <span>·</span>
                    <span className="truncate" style={{ maxWidth: 220 }}>{payTarget.note}</span>
                  </>
                )}
                <span>·</span>
                <span className="mono" style={{ fontSize: 10.5 }}>
                  {payTarget.requestId ? "signed QR request" : "in-store NFC"}
                </span>
              </div>
            </div>

            <div className="stack gap-8" style={{ marginTop: 14 }}>
              {state && state.wallets.length > 1 ? (
                <div className="row gap-6" style={{ justifyContent: "center", flexWrap: "wrap" }}>
                  {state.wallets.filter((w) => w.status === "active").map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      className="chip"
                      style={
                        w.id === wallet?.id
                          ? { borderColor: "rgba(255,203,5,.4)", background: "rgba(255,203,5,.08)", color: "var(--text)" }
                          : undefined
                      }
                      onClick={() => setWalletId(w.id)}
                    >
                      <span
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 5,
                          display: "grid",
                          placeItems: "center",
                          fontSize: 7,
                          fontWeight: 700,
                          color: "#171200",
                          background: w.accent,
                        }}
                      >
                        {w.provider === "mtn-momo" ? "M" : w.provider === "orange-money" ? "O" : "E"}
                      </span>
                      {PROVIDER_LABEL[w.provider]}
                      <span className="muted" style={{ fontSize: 10.5 }}>
                        {money(w.balanceXAF, { suffix: false })}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                wallet && (
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <span className="wallet-pill">
                      <span className="provider-logo" style={{ width: 22, height: 22, borderRadius: 7, background: wallet.accent }}>
                        M
                      </span>
                      {wallet.providerName}
                      <span className="muted">· {money(wallet.balanceXAF)}</span>
                    </span>
                  </div>
                )
              )}

              {isOffline && (
                <div
                  className="card flat"
                  style={{ padding: 11, borderColor: "rgba(255,189,74,.22)", background: "rgba(255,189,74,.05)" }}
                >
                  <div className="row gap-8 small" style={{ color: "var(--amber)", fontWeight: 500 }}>
                    <Icon name="cloud" size={15} />
                    No data — this will be signed offline
                  </div>
                  <div className="tiny muted" style={{ marginTop: 3, lineHeight: 1.45 }}>
                    A device-signed voucher settles when you reconnect. Offline cap {money(offlineCap)} per payment,{" "}
                    {money(settings?.offlineDailyXAF ?? 25_000)} per day.
                  </div>
                  {settings?.smsFallback && payTarget.amountXAF <= 10_000 && (
                    <button
                      type="button"
                      className={`sim-toggle ${smsRelay ? "amber" : ""}`}
                      aria-pressed={smsRelay}
                      style={{ marginTop: 8 }}
                      onClick={() => setSmsRelay((v) => !v)}
                    >
                      <Icon name="send" size={11} />
                      {smsRelay ? "SMS/USSD relay on" : "Use SMS/USSD relay"}
                    </button>
                  )}
                </div>
              )}

              {needsStepUp && !isOffline && (
                <div className="row gap-6 tiny" style={{ justifyContent: "center", color: "var(--amber)" }}>
                  <Icon name="lock" size={12} />
                  Above {money(settings?.stepUpThresholdXAF ?? 50_000)} · PIN required after the scan
                </div>
              )}
              {overBalance && (
                <div className="row gap-6 tiny" style={{ justifyContent: "center", color: "var(--coral)" }}>
                  <Icon name="alert" size={12} />
                  Balance {money(wallet?.balanceXAF ?? 0)} may not cover this amount
                </div>
              )}
              {overOfflineCap && (
                <div className="row gap-6 tiny" style={{ justifyContent: "center", color: "var(--coral)" }}>
                  <Icon name="alert" size={12} />
                  Above the offline cap — this payment will be refused
                </div>
              )}
            </div>

            {!finger ? (
              <div className="card flat center" style={{ marginTop: 8, padding: 18 }}>
                <div style={{ color: "var(--amber)", display: "flex", justifyContent: "center", marginBottom: 6 }}>
                  <Icon name="fingerprint" size={26} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>No fingerprint enrolled</div>
                <div className="tiny muted" style={{ marginTop: 3, marginBottom: 10 }}>
                  Enrol a finger in Security before paying with a scan.
                </div>
                <Link href="/security" onClick={closePay} className="btn soft sm">
                  <Icon name="shield" size={13} />
                  Open Security
                </Link>
              </div>
            ) : (
            <BiometricPad
              status={status}
              disabled={stage === "verifying" || submitting}
              onCapture={onCapture}
              onCancel={() => toast("Keep your finger on the sensor until the ring closes", "warn")}
              hint={
                stage === "verifying" ? (
                  <>
                    Matching sealed template…
                    <br />
                    <span className="tiny">Your print never leaves the sensor.</span>
                  </>
                ) : (
                  <>
                    <strong>Hold the finger sensor</strong> to pay
                    <br />
                    <span className="tiny">{finger.label} · {tier === "offline" ? "offline authorisation" : "liveness enforced"}</span>
                  </>
                )
              }
            />
            )}

            <div className="sim-strip" style={{ marginTop: 4 }}>
              <div className="sim-head">
                <span>
                  <Icon name="flask" size={10} style={{ marginRight: 4, verticalAlign: -1 }} />
                  Sensor simulator
                </span>
                <span>demo only</span>
              </div>
              <div className="sim-toggles">
                <button
                  type="button"
                  className="sim-toggle"
                  aria-pressed={sim.impostor}
                  onClick={() => setSim((s) => ({ ...s, impostor: !s.impostor }))}
                >
                  Impostor finger
                </button>
                <button
                  type="button"
                  className="sim-toggle"
                  aria-pressed={sim.spoof}
                  onClick={() => setSim((s) => ({ ...s, spoof: !s.spoof }))}
                >
                  Spoof / no pulse
                </button>
                <button
                  type="button"
                  className="sim-toggle amber"
                  aria-pressed={sim.dry}
                  onClick={() => setSim((s) => ({ ...s, dry: !s.dry }))}
                >
                  Dry finger
                </button>
              </div>
              <div className="tiny" style={{ color: "var(--dim)" }}>
                {sim.impostor
                  ? "A different finger will be presented — expect a rejection."
                  : sim.spoof
                    ? "Static ridge pattern, no sub-dermal pulse — liveness should fail."
                    : sim.dry
                      ? "Low-quality capture, like dusty or dry skin — expect a weak score."
                      : "Genuine capture. Production binds this to Android BiometricPrompt / iOS LocalAuthentication."}
              </div>
            </div>

            <div className="btn-row" style={{ marginTop: 12 }}>
              <button type="button" className="btn ghost" onClick={closePay} disabled={stage === "verifying"}>
                Cancel
              </button>
            </div>
          </>
        )}

        {/* ---------------- challenge ---------------- */}
        {stage === "challenge" && result?.risk && (
          <>
            <div className="stack gap-12" style={{ alignItems: "center", marginBottom: 8 }}>
              <div className="result-badge warn">
                <Icon name="shield" size={28} />
              </div>
              <div className="center">
                <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600 }}>
                  Confirm with your MoMo PIN
                </div>
                <div className="small muted" style={{ marginTop: 3, maxWidth: 300 }}>
                  {result.risk.summary}
                </div>
              </div>
            </div>

            <div className="row-between" style={{ padding: "0 4px", marginBottom: 2 }}>
              <span className="badge accent">{RISK_META[result.risk.level].label} · {result.risk.score}/100</span>
              <span className="tiny muted">
                {result.biometric?.score
                  ? `fingerprint matched ${(result.biometric.score * 100).toFixed(1)}%`
                  : "fingerprint not scored"}
              </span>
            </div>

            <div className={`pin-dots ${pinError ? "error" : ""}`}>
              {[0, 1, 2, 3].map((i) => (
                <i key={i} className={i < pin.length ? "filled" : ""} />
              ))}
            </div>
            {pinError && (
              <div className="tiny center" style={{ color: "var(--coral)", marginTop: -10, marginBottom: 10 }}>
                Incorrect PIN. Try again.
              </div>
            )}

            <div className="keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button key={d} type="button" className="key" onClick={() => onPinKey(d)} disabled={submitting}>
                  {d}
                </button>
              ))}
              <button type="button" className="key fn" onClick={closePay} disabled={submitting}>
                Cancel
              </button>
              <button type="button" className="key" onClick={() => onPinKey("0")} disabled={submitting}>
                0
              </button>
              <button type="button" className="key fn" onClick={() => onPinKey("del")} disabled={submitting}>
                <Icon name="chevron-left" size={18} />
              </button>
            </div>
            <div className="tiny center muted" style={{ marginTop: 10 }}>
              Demo PIN <span className="mono" style={{ color: "var(--text-2)" }}>2580</span> · your step-up threshold is{" "}
              {money(settings?.stepUpThresholdXAF ?? 50_000)}
            </div>
          </>
        )}

        {/* ---------------- result ---------------- */}
        {stage === "result" && result && (
          <>
            <div className="stack gap-12" style={{ alignItems: "center" }}>
              <div className={`result-badge ${result.status === "declined" || result.status === "error" ? "danger" : result.status === "queued" ? "warn" : "ok"}`}>
                <Icon
                  name={result.status === "declined" || result.status === "error" ? "x" : result.status === "queued" ? "cloud" : "check"}
                  size={30}
                  strokeWidth={2.2}
                />
              </div>
              <div className="center">
                <div className="pay-amount" style={{ fontSize: 30 }}>
                  {money(payTarget.amountXAF, { suffix: false })}
                  <span className="cur">FCFA</span>
                </div>
                <div className="row gap-6" style={{ justifyContent: "center", marginTop: 6 }}>
                  <MerchantAvatar name={payTarget.merchantName} hue={merchant?.logoHue ?? 42} size="sm" />
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{payTarget.merchantName}</span>
                </div>
                <div className="small muted" style={{ marginTop: 8, maxWidth: 310, lineHeight: 1.5 }}>
                  {result.message}
                </div>
              </div>
            </div>

            {result.status === "queued" && result.voucher && (
              <div className="card flat" style={{ marginTop: 12, padding: 12 }}>
                <div className="row-between" style={{ marginBottom: 6 }}>
                  <span className="up">Signed voucher · counter {result.voucher.counter}</span>
                  <span className="badge warn">offline</span>
                </div>
                <div className="mono tiny" style={{ color: "var(--text-2)", wordBreak: "break-all", lineHeight: 1.5 }}>
                  {result.voucher.smsToken}
                </div>
                <div className="row-between" style={{ marginTop: 8 }}>
                  <span className="tiny muted">Ed25519 · settles on next network</span>
                  <button
                    className="btn ghost xs"
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(result.voucher!.smsToken);
                      toast("Voucher token copied", "ok");
                    }}
                  >
                    <Icon name="copy" size={11} /> Copy
                  </button>
                </div>
              </div>
            )}

            {result.txn && (
              <div className="receipt" style={{ marginTop: 12 }}>
                <div className="receipt-row">
                  <span className="k">Receipt</span>
                  <span className="v mono">{result.txn.receiptNo}</span>
                </div>
                <div className="receipt-row">
                  <span className="k">Reference</span>
                  <span className="v mono">{result.txn.ref}</span>
                </div>
                <div className="receipt-row">
                  <span className="k">Time</span>
                  <span className="v">{timeLabel(result.txn.createdAt)} · {result.txn.deviceLabel}</span>
                </div>
                <div className="receipt-row">
                  <span className="k">Authorised by</span>
                  <span className="v">
                    {result.txn.auth.fingerLabel} · {(result.txn.auth.matchScore * 100).toFixed(1)}%
                    {result.txn.auth.stepUp ? " + PIN" : ""}
                  </span>
                </div>
                <div className="receipt-row">
                  <span className="k">Liveness</span>
                  <span className="v" style={{ color: result.txn.auth.livenessPassed ? "var(--mint)" : "var(--coral)" }}>
                    {result.txn.auth.livenessPassed ? "passed" : "failed"} · {result.txn.auth.holdMs} ms hold
                  </span>
                </div>
              </div>
            )}

            {result.risk && (result.risk.score >= 25 || result.status !== "settled") && (
              <div style={{ marginTop: 12 }}>
                <RiskSummary risk={result.risk} amountXAF={payTarget.amountXAF} />
              </div>
            )}

            {result.risk && result.status === "settled" && result.risk.score < 25 && (
              <div className="row gap-6 tiny muted" style={{ justifyContent: "center", marginTop: 10 }}>
                <Icon name="shield-check" size={12} style={{ color: "var(--mint)" }} />
                Risk {result.risk.score}/100 · evaluated in {result.risk.evaluatedInMs.toFixed(1)} ms
              </div>
            )}

            <div className="btn-row" style={{ marginTop: 14 }}>
              {result.txn && (
                <button
                  className="btn soft"
                  type="button"
                  onClick={() => {
                    setActiveTxn(result.txn!);
                    closePay();
                  }}
                >
                  <Icon name="receipt" size={14} />
                  Receipt
                </button>
              )}
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  closePay();
                  if (result.status === "queued") toast("Voucher queued — settle it from Wallet or the ops console", "info");
                }}
              >
                Done
              </button>
            </div>

            {(result.status === "declined" || result.status === "error") && (
              <div className="center" style={{ marginTop: 10 }}>
                <button
                  className="btn ghost xs"
                  type="button"
                  onClick={() => {
                    setStage("review");
                    setResult(null);
                    setPin("");
                  }}
                >
                  <Icon name="refresh" size={12} />
                  Try a different finger
                </button>
              </div>
            )}

            {result.status === "queued" && (
              <div className="center tiny muted" style={{ marginTop: 10 }}>
                <Link href="/wallet" onClick={closePay} style={{ color: "var(--accent)" }}>
                  Open settlement queue →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
