"use client";

import { useEffect, useRef, useState } from "react";
import { useApp } from "./AppProvider";
import { Icon } from "./icons";
import { money } from "@/lib/format";

export const SESSION_KEY = "bsp.session";
const MAX_ATTEMPTS = 3;

type Step = "number" | "code" | "biometric";

/**
 * Sign-in.
 *
 * The question this answers: if a fingerprint already authorises every payment,
 * why sign in at all? Because they prove different things. Sign-in proves *who
 * is holding the account* (phone number + OTP, the same primitive MTN MoMo and
 * Orange Money already use) and binds this browser to that account. The
 * fingerprint then authorises *each payment* — possession plus intent, per
 * transaction. Skip sign-in and a stolen unlocked phone is a wallet; skip the
 * fingerprint and a shoulder-surfed PIN is one.
 *
 * It is deliberately short: one number, one code, one optional biometric
 * enrolment. Once the device is trusted, reopening the app lands straight on
 * the balance — the same trade-off as "remember this device".
 */
export function LoginScreen({ onDone }: { onDone: () => void }) {
  const { state, toast } = useApp();
  const [step, setStep] = useState<Step>("number");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [sending, setSending] = useState(false);
  const [enableBiometrics, setEnableBiometrics] = useState(true);
  const codeRef = useRef<HTMLInputElement>(null);

  const accountNumber = (state?.wallets[0]?.msisdn ?? state?.user.phone ?? "677 12 34 56").replace(/[^\d ]/g, "");
  const digits = phone.replace(/\D/g, "");
  const numberValid = digits.length >= 8;

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const sendCode = () => {
    if (!numberValid) return;
    setSending(true);
    window.setTimeout(() => {
      setSending(false);
      setStep("code");
      toast("Code sent by SMS — demo code is 123456", "info");
    }, 700);
  };

  const verify = (value: string) => {
    setCode(value);
    if (value.length !== 6) return;
    if (value === "123456" || value === "000000") {
      setStep("biometric");
      return;
    }
    const next = attempts + 1;
    setAttempts(next);
    window.setTimeout(() => setCode(""), 320);
    toast(next >= MAX_ATTEMPTS ? "Wrong code too many times — resend a new one" : "That code is not right", "danger");
  };

  const finish = () => {
    try {
      localStorage.setItem(SESSION_KEY, "1");
      localStorage.setItem("bsp.biometrics", enableBiometrics ? "1" : "0");
    } catch {
      /* private mode: session lasts for this tab */
    }
    onDone();
  };

  return (
    <div className="login">
      <div className="login-head">
        <span className="login-mark">
          <Icon name="fingerprint" size={22} />
        </span>
        <div className="login-brand">
          Scan<span>to</span>Pay
        </div>
        <div className="tiny muted">MTN Mobile Money · Cameroon</div>
      </div>

      <div className="login-body">
        {step === "number" && (
          <>
            <h1 className="login-title">Sign in</h1>
            <p className="small muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>
              Use the number your mobile money account is registered to. We send a one-time code — no password to
              remember.
            </p>

            <label className="login-label" htmlFor="login-phone">
              Mobile money number
            </label>
            <div className="login-field">
              <span className="login-prefix">+237</span>
              <input
                id="login-phone"
                className="login-input"
                inputMode="tel"
                autoComplete="tel"
                placeholder={accountNumber}
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/[^\d ]/g, "").slice(0, 12))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendCode();
                }}
              />
            </div>

            <button
              className="btn primary"
              type="button"
              style={{ width: "100%", marginTop: 14 }}
              disabled={!numberValid || sending}
              onClick={sendCode}
            >
              {sending ? "Sending code…" : "Send code"}
              <Icon name="chevron" size={14} />
            </button>

            <button className="link-button" type="button" onClick={() => setPhone(accountNumber)}>
              Use {accountNumber}
            </button>

            <div className="login-note">
              <Icon name="lock" size={12} />
              <span>
                The code proves you hold the SIM. Your fingerprint is what authorises each payment — that second step
                never leaves the device.
              </span>
            </div>
          </>
        )}

        {step === "code" && (
          <>
            <button className="login-back" type="button" onClick={() => setStep("number")}>
              <Icon name="chevron" size={13} /> Back
            </button>
            <h1 className="login-title">Enter the code</h1>
            <p className="small muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>
              Sent to +237 {phone || accountNumber}. Demo code: <strong>123456</strong>.
            </p>

            <input
              ref={codeRef}
              className="login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              aria-label="Six digit code"
              onChange={(e) => verify(e.target.value.replace(/\D/g, "").slice(0, 6))}
            />

            <div className="login-code-hint">
              <span className="tiny muted">{attempts > 0 ? `${MAX_ATTEMPTS - Math.min(attempts, MAX_ATTEMPTS)} attempts left` : "Waiting for the SMS"}</span>
              <button className="link-button" type="button" onClick={() => verify("123456")}>
                Use demo code
              </button>
            </div>

            <div className="login-note">
              <Icon name="shield" size={12} />
              <span>Codes expire after 2 minutes and work once. Three wrong tries and we send a new one.</span>
            </div>
          </>
        )}

        {step === "biometric" && (
          <>
            <h1 className="login-title">Add your fingerprint</h1>
            <p className="small muted" style={{ marginBottom: 16, lineHeight: 1.5 }}>
              Signed in as +237 {phone || accountNumber}. Turn on fingerprint payments so you never type a PIN at the
              counter again.
            </p>

            <div className="login-bio">
              <span className={`login-bio-ring ${enableBiometrics ? "on" : ""}`}>
                <Icon name="fingerprint" size={30} />
              </span>
              <div className="grow">
                <div style={{ fontSize: 13, fontWeight: 500 }}>Fingerprint payments</div>
                <div className="tiny muted" style={{ lineHeight: 1.45 }}>
                  {enableBiometrics
                    ? "Hold-to-pay, with liveness and a PIN fallback for large amounts."
                    : "PIN only. You can enrol later in Security."}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enableBiometrics}
                aria-label="Fingerprint payments"
                className="switch"
                onClick={() => setEnableBiometrics((v) => !v)}
              />
            </div>

            <div className="login-summary">
              <div className="row-between">
                <span className="tiny muted">Wallet</span>
                <span className="tiny">{money(state?.wallets[0]?.balanceXAF ?? 0)}</span>
              </div>
              <div className="row-between">
                <span className="tiny muted">Device</span>
                <span className="tiny">{state?.devices.find((d) => d.trusted)?.label ?? "Pixel 8"} · {state?.user.city ?? "Yaoundé"}</span>
              </div>
            </div>

            <button className="btn primary" type="button" style={{ width: "100%", marginTop: 14 }} onClick={finish}>
              {enableBiometrics ? "Enrol and open wallet" : "Open wallet"}
              <Icon name="check" size={14} />
            </button>
          </>
        )}
      </div>

      <div className="login-foot">
        <button className="link-button" type="button" onClick={finish}>
          Skip for now
        </button>
        <span className="tiny" style={{ color: "var(--dim)" }}>
          Demo app · no real money moves
        </span>
      </div>
    </div>
  );
}
