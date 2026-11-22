"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/components/AppProvider";
import { Icon, type IconName } from "@/components/icons";
import { RangeRow, ToggleRow } from "@/components/controls";
import { RiskSummary } from "@/components/Risk";
import { apiJson } from "@/lib/client";
import { money, relativeTime } from "@/lib/format";
import type { ScenarioResult } from "@/lib/service";
import type { RiskLevel, RiskSignal } from "@/lib/types";

const SCENARIOS: { id: string; label: string; icon: IconName; note: string }[] = [
  { id: "impossible-travel", label: "Impossible travel", icon: "globe", note: "Douala → Garoua in 12 min" },
  { id: "velocity-burst", label: "Velocity burst", icon: "bolt", note: "6 payments in 5 min" },
  { id: "amount-spike", label: "Amount spike", icon: "chart", note: "285 000 on a 9 000 average" },
  { id: "stolen-device", label: "Stolen device + spoof", icon: "device", note: "Unknown device, no pulse" },
  { id: "flagged-merchant", label: "Flagged merchant", icon: "alert", note: "Acquirer risk 88/100" },
  { id: "offline-cap", label: "Offline cap breach", icon: "cloud", note: "42 000 voucher, 10 000 cap" },
];

export default function SecurityPage() {
  const {
    state,
    saveSettings,
    simulate,
    busy,
    sensorSeed,
    enrollFinger,
    removeFinger,
    resolveAlert,
    setPin,
    refresh,
    toast,
  } = useApp();
  const [simResult, setSimResult] = useState<ScenarioResult | null>(null);
  const [activeScenario, setActiveScenario] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState("");
  const [pinOpen, setPinOpen] = useState(false);

  const score = useMemo(() => {
    if (!state) return 0;
    let s = 100;
    if (state.biometric.fingers.length === 0) s -= 45;
    if (!state.biometric.livenessEnabled) s -= 14;
    if (!state.user.pinSet) s -= 10;
    if (state.user.settings.stepUpThresholdXAF > 100_000) s -= 6;
    s -= state.alerts.filter((a) => a.status === "open").length * 3;
    return Math.max(35, Math.min(100, s));
  }, [state]);

  if (!state) return null;

  const settings = state.user.settings;
  const locked = state.biometric.lockedUntil && new Date(state.biometric.lockedUntil).getTime() > Date.now();
  const openAlerts = state.alerts.filter((a) => a.status === "open");
  const ringLen = 2 * Math.PI * 26;

  const run = async (id: string) => {
    setActiveScenario(id);
    const res = await simulate(id);
    setSimResult(res);
    setActiveScenario(null);
  };

  return (
    <div className="page">
      <div>
        <h1 style={{ fontSize: 22 }}>Security centre</h1>
        <p className="small muted" style={{ marginTop: 3 }}>
          Biometrics, risk policy and the offline exposure you are willing to carry.
        </p>
      </div>

      <div className={`hero-stat ${score < 80 ? "warn" : ""}`}>
        <div className="ring-score" style={{ width: 62, height: 62 }}>
          <svg width="62" height="62" viewBox="0 0 62 62">
            <defs>
              <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#4BDDA0" />
                <stop offset="100%" stopColor="#FFCB05" />
              </linearGradient>
            </defs>
            <circle className="ring-track" cx="31" cy="31" r="26" />
            <circle
              className="ring-val"
              cx="31"
              cy="31"
              r="26"
              strokeDasharray={ringLen}
              strokeDashoffset={ringLen * (1 - score / 100)}
            />
          </svg>
          <span className="score-num">{score}</span>
        </div>
        <div className="grow">
          <div style={{ fontFamily: "var(--font-display)", fontSize: 15, fontWeight: 600 }}>
            {score >= 90 ? "Strong protection" : score >= 75 ? "Good, with gaps" : "Needs attention"}
          </div>
          <div className="small muted" style={{ marginTop: 2, lineHeight: 1.45 }}>
            {state.biometric.fingers.length} biometric template
            {state.biometric.fingers.length === 1 ? "" : "s"} · liveness {state.biometric.livenessEnabled ? "enforced" : "off"} ·{" "}
            {state.user.pinSet ? "PIN set" : "no PIN"}
          </div>
          <div className="row gap-6" style={{ marginTop: 6, flexWrap: "wrap" }}>
            <span className="badge ok">{state.biometric.totalAuths} auths</span>
            <span className="badge muted">avg match {(state.biometric.scoreBaseline * 100).toFixed(1)}%</span>
            {openAlerts.length > 0 && <span className="badge warn">{openAlerts.length} open</span>}
          </div>
        </div>
      </div>

      {/* ---------------- biometrics ---------------- */}
      <section className="card flat">
        <div className="section-head" style={{ marginBottom: 10 }}>
          <h2 style={{ fontSize: 13.5 }}>Biometric credentials</h2>
          <span className={`badge ${locked ? "danger" : state.biometric.fingers.length ? "ok" : "warn"}`}>
            {locked ? "locked" : state.biometric.fingers.length ? "enrolled" : "none"}
          </span>
        </div>

        <div className="stack">
          {state.biometric.fingers.map((f) => (
            <div className="switch-row" key={f.id}>
              <span className="row gap-9" style={{ minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(255,203,5,.1)",
                    color: "var(--accent)",
                    flex: "none",
                  }}
                >
                  <Icon name="fingerprint" size={16} />
                </span>
                <span style={{ minWidth: 0 }}>
                  <span className="sr-title" style={{ display: "block" }}>{f.label}</span>
                  <span className="sr-sub">
                    quality {Math.round(f.quality * 100)}% · used {f.useCount}× · {relativeTime(f.lastUsedAt)}
                  </span>
                </span>
              </span>
              <button
                type="button"
                className="icon-btn"
                style={{ width: 28, height: 28 }}
                onClick={() => void removeFinger(f.id)}
                aria-label={`Remove ${f.label}`}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>
          ))}
        </div>

        <div className="btn-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn soft sm"
            disabled={!sensorSeed || busy === "enroll"}
            onClick={() => void enrollFinger("right-index", "Right index")}
          >
            <Icon name="plus" size={13} />
            {state.biometric.fingers.some((f) => f.id === "right-index") ? "Re-enrol right index" : "Enrol right index"}
          </button>
          <button
            type="button"
            className="btn ghost sm"
            disabled={!sensorSeed || busy === "enroll"}
            onClick={() => void enrollFinger("left-thumb", "Left thumb")}
          >
            <Icon name="plus" size={13} />
            Left thumb
          </button>
        </div>

        <div className="tiny muted" style={{ marginTop: 8, lineHeight: 1.45 }}>
          Templates are 128-dimension embeddings sealed with AES-256-GCM and bound to your account. The raw ridge image is
          never stored — in production the matcher runs inside the secure enclave and returns a signed assertion.
        </div>

        {locked && (
          <div className="row-between" style={{ marginTop: 10, padding: 10, borderRadius: 12, background: "rgba(255,106,90,.08)", border: "1px solid rgba(255,106,90,.22)" }}>
            <span className="small" style={{ color: "#ff9a8e" }}>
              Matcher locked until {new Date(state.biometric.lockedUntil!).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </span>
            <button
              className="btn ghost xs"
              type="button"
              onClick={async () => {
                await apiJson("/api/biometric", { method: "POST", body: JSON.stringify({ action: "reset-lockout" }) });
                await refresh();
                toast("Matcher unlocked", "ok");
              }}
            >
              Unlock
            </button>
          </div>
        )}

        <div className="hairline" style={{ margin: "12px 0 4px" }} />
        <ToggleRow
          title="Liveness detection"
          sub="Require pulse, micro-motion and contact depth — blocks photo / lifted-print spoofs."
          checked={settings.requireLiveness}
          onChange={(v) => void saveSettings({ requireLiveness: v })}
        />
        <ToggleRow
          title="Strict biometric matching"
          sub="Raise the acceptance threshold to 90% — borderline captures are refused instead of stepped up."
          checked={settings.biometricOnly}
          onChange={(v) => void saveSettings({ biometricOnly: v })}
        />
        <ToggleRow
          title="Night guard"
          sub="Tighter thresholds between 23:00 and 05:00."
          checked={settings.nightGuard}
          onChange={(v) => void saveSettings({ nightGuard: v })}
        />
      </section>

      {/* ---------------- policy ---------------- */}
      <section className="card flat">
        <div className="section-head" style={{ marginBottom: 4 }}>
          <h2 style={{ fontSize: 13.5 }}>Spending &amp; offline policy</h2>
          <Icon name="lock" size={14} style={{ color: "var(--muted)" }} />
        </div>
        <RangeRow
          label="Step-up threshold"
          value={settings.stepUpThresholdXAF}
          min={5_000}
          max={200_000}
          step={5_000}
          onCommit={(v) => void saveSettings({ stepUpThresholdXAF: v })}
          format={(n) => money(n)}
          hint="Above this amount the PIN is required on top of the fingerprint."
        />
        <RangeRow
          label="Offline per-payment cap"
          value={settings.offlinePerTxnXAF}
          min={1_000}
          max={50_000}
          step={1_000}
          onCommit={(v) => void saveSettings({ offlinePerTxnXAF: v })}
          format={(n) => money(n)}
          hint="Largest voucher the device may sign with no data connection. This is the issuer's exposure."
        />
        <RangeRow
          label="Offline daily allowance"
          value={settings.offlineDailyXAF}
          min={2_000}
          max={100_000}
          step={1_000}
          onCommit={(v) => void saveSettings({ offlineDailyXAF: v })}
          format={(n) => money(n)}
          hint={`Queued offline right now: ${money(state.queue.filter((q) => q.status === "queued").reduce((s, q) => s + q.amountXAF, 0))}.`}
        />
        <ToggleRow
          title="SMS / USSD fallback"
          sub="Allow a 160-char token when even data fails — capped at 10 000 FCFA."
          checked={settings.smsFallback}
          onChange={(v) => void saveSettings({ smsFallback: v })}
        />
        <ToggleRow
          title="Auto-settle when back online"
          sub="Flush signed vouchers as soon as the radio recovers."
          checked={settings.autoSync}
          onChange={(v) => void saveSettings({ autoSync: v })}
        />
      </section>

      <section className="card flat">
        <div className="section-head" style={{ marginBottom: 8 }}>
          <h2 style={{ fontSize: 13.5 }}>Step-up PIN</h2>
          <span className={`badge ${state.user.pinSet ? "ok" : "warn"}`}>{state.user.pinSet ? "set" : "missing"}</span>
        </div>
        {pinOpen ? (
          <div className="stack gap-8">
            <input
              className="input"
              inputMode="numeric"
              maxLength={4}
              placeholder="4 digits"
              value={pinDraft}
              onChange={(e) => setPinDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
              aria-label="New PIN"
            />
            <div className="btn-row">
              <button className="btn ghost" type="button" onClick={() => { setPinOpen(false); setPinDraft(""); }}>
                Cancel
              </button>
              <button
                className="btn primary"
                type="button"
                disabled={pinDraft.length !== 4}
                onClick={async () => {
                  const ok = await setPin(pinDraft);
                  if (ok) {
                    setPinOpen(false);
                    setPinDraft("");
                  }
                }}
              >
                Save PIN
              </button>
            </div>
            <div className="tiny muted">Hashed with scrypt and a per-user salt. Demo PIN is 2580.</div>
          </div>
        ) : (
          <div className="row-between">
            <span className="small muted">
              Used for step-up over {money(settings.stepUpThresholdXAF)} and high-risk attempts.
            </span>
            <button className="btn soft xs" type="button" onClick={() => setPinOpen(true)}>
              <Icon name="key" size={12} />
              Change
            </button>
          </div>
        )}
      </section>

      {/* ---------------- fraud simulator ---------------- */}
      <section>
        <div className="section-head" style={{ marginBottom: 9 }}>
          <h2>Fraud engine sandbox</h2>
          <span className={`badge ${state.network.online ? "ok" : "warn"}`}>live</span>
        </div>
        <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`quick-action ${activeScenario === s.id ? "active" : ""}`}
              style={{ padding: "10px 11px", gap: 6 }}
              onClick={() => void run(s.id)}
              disabled={busy === "simulate"}
            >
              <span className="row gap-6" style={{ width: "100%" }}>
                <Icon name={s.icon} size={13} style={{ color: "var(--accent)" }} />
                <span className="label" style={{ fontSize: 11.5 }}>{s.label}</span>
              </span>
              <span className="sub" style={{ fontSize: 9.5 }}>{s.note}</span>
            </button>
          ))}
        </div>

        {simResult && (
          <div className="stack gap-8" style={{ marginTop: 10 }}>
            <div className="card flat" style={{ padding: 12 }}>
              <div className="row-between" style={{ marginBottom: 4 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{simResult.title}</span>
                <span className="badge muted">{simResult.context.city}</span>
              </div>
              <p className="tiny muted" style={{ lineHeight: 1.45 }}>{simResult.description}</p>
              <div className="row gap-5" style={{ marginTop: 7, flexWrap: "wrap" }}>
                <span className="badge muted">{money(simResult.context.amountXAF)}</span>
                <span className="badge muted">{simResult.context.device}</span>
                {simResult.context.offline && <span className="badge warn">offline</span>}
                {simResult.context.distanceFromLastKm && (
                  <span className="badge muted">{simResult.context.distanceFromLastKm} km jump</span>
                )}
              </div>
            </div>
            <RiskSummary risk={simResult.assessment} amountXAF={simResult.context.amountXAF} />
            <div className="card flat" style={{ padding: 12 }}>
              <div className="up" style={{ marginBottom: 4 }}>all signals</div>
              <SignalTable signals={simResult.assessment.signals} level={simResult.assessment.level} />
            </div>
          </div>
        )}
      </section>

      {/* ---------------- alerts ---------------- */}
      <section>
        <div className="section-head" style={{ marginBottom: 9 }}>
          <h2>Alerts</h2>
          <span className="badge muted">{state.alerts.length}</span>
        </div>
        <div className="stack gap-8">
          {state.alerts.length === 0 && <div className="small muted">No fraud alerts. Good.</div>}
          {state.alerts.slice(0, 6).map((a) => (
            <div className="alert-card" key={a.id} data-sev={a.severity}>
              <div className="ac-head">
                <Icon
                  name={a.severity === "critical" ? "alert" : a.severity === "warning" ? "info" : "shield-check"}
                  size={15}
                  style={{
                    color: a.severity === "critical" ? "var(--coral)" : a.severity === "warning" ? "var(--amber)" : "var(--mint)",
                    flex: "none",
                    marginTop: 1,
                  }}
                />
                <div className="grow">
                  <div className="ac-title">{a.title}</div>
                  <div className="tiny muted" style={{ marginTop: 2 }}>
                    {a.merchantName}
                    {a.amountXAF > 0 && ` · ${money(a.amountXAF)}`} · {relativeTime(a.createdAt)}
                  </div>
                </div>
                <span className={`badge ${a.status === "open" ? "warn" : a.status === "auto-blocked" ? "danger" : "muted"}`} style={{ height: 19, fontSize: 9 }}>
                  {a.status}
                </span>
              </div>
              <div className="ac-detail">{a.detail}</div>
              {a.status === "open" && (
                <div className="ac-foot">
                  <span className="tiny muted">{a.signals.length} signals · score {a.signals.reduce((s, x) => s + x.weight, 0)}</span>
                  <span className="row gap-5">
                    <button className="btn ghost xs" type="button" onClick={() => void resolveAlert(a.id, "dismissed")}>
                      Dismiss
                    </button>
                    <button className="btn soft xs" type="button" onClick={() => void resolveAlert(a.id, "resolved")}>
                      It was me
                    </button>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- audit ---------------- */}
      <section className="card flat">
        <div className="section-head" style={{ marginBottom: 6 }}>
          <h2 style={{ fontSize: 13.5 }}>Audit trail</h2>
          <span className="tiny muted">append-only</span>
        </div>
        {state.audit.slice(0, 7).map((a) => (
          <div className="log-line" key={a.id}>
            <span className="time">{relativeTime(a.at)}</span>
            <span style={{ minWidth: 0 }}>
              <span className="msg" style={{ fontFamily: "var(--font-ui)" }}>{a.action}</span>
              <span className="det" style={{ display: "block" }}>{a.detail}</span>
            </span>
          </div>
        ))}
      </section>

      <div className="tiny muted center" style={{ paddingBottom: 6 }}>
        Sensor secret {sensorSeed ? "bound to this device" : "unavailable"} · fraud scoring runs server-side
      </div>
    </div>
  );
}

function SignalTable({ signals, level }: { signals: RiskSignal[]; level: RiskLevel }) {
  if (signals.length === 0) {
    return <div className="small muted">No signals fired — this pattern looks normal.</div>;
  }
  return (
    <div className="stack">
      {signals.map((s) => (
        <div className="signal" key={s.code} data-sev={s.weight >= 30 ? "high" : "normal"}>
          <span className="w">+{s.weight}</span>
          <span className="grow">
            <span className="sig-label">{s.label}</span>
            <span className="sig-detail">{s.detail}</span>
          </span>
          <span className="badge muted" style={{ height: 18, fontSize: 9, alignSelf: "flex-start" }}>
            {s.category}
          </span>
        </div>
      ))}
      <div className="tiny muted" style={{ marginTop: 6 }}>
        Verdict {level} · correlated signals are capped per family so one factor cannot manufacture a block.
      </div>
    </div>
  );
}
