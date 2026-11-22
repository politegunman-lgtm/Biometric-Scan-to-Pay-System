"use client";

import { RISK_META, money } from "@/lib/format";
import type { RiskAssessment, RiskSignal } from "@/lib/types";
import { Icon } from "./icons";

export function RiskGauge({ score, level, size = 132 }: { score: number; level: keyof typeof RISK_META; size?: number }) {
  const color = RISK_META[level].color;
  const r = 45;
  const len = Math.PI * r;
  const offset = len * (1 - Math.min(100, Math.max(0, score)) / 100);
  return (
    <div className="gauge" style={{ width: size, margin: "0 auto" }}>
      <svg viewBox="0 0 110 76" role="img" aria-label={`Risk score ${score} of 100`}>
        <path className="track" d={`M 10 60 A ${r} ${r} 0 0 1 100 60`} />
        <path
          className="val"
          d={`M 10 60 A ${r} ${r} 0 0 1 100 60`}
          stroke={color}
          strokeDasharray={len}
          strokeDashoffset={offset}
        />
        <circle cx="10" cy="60" r="2.4" fill={color} opacity="0.85" />
        <circle cx="100" cy="60" r="2.4" fill={color} opacity="0.85" />
      </svg>
      <div className="gauge-label" style={{ bottom: 0 }}>
        <div className="score num" style={{ color }}>
          {score}
        </div>
        <div className="of">risk score</div>
      </div>
      <span className="sr-only">{RISK_META[level].label}</span>
    </div>
  );
}

export function SignalList({
  signals: raw,
  limit,
  compact = false,
}: {
  signals: RiskSignal[];
  limit?: number;
  compact?: boolean;
}) {
  const signals = limit ? raw.slice(0, limit) : raw;
  if (signals.length === 0) {
    return (
      <div className="row gap-8 small muted">
        <Icon name="check" size={14} style={{ color: "var(--mint)" }} />
        No risk signals — matches your usual pattern.
      </div>
    );
  }
  return (
    <div className="stack">
      <div className="up" style={{ marginBottom: 2 }}>
        {computeSignalsLabel(raw)}
      </div>
      {signals.map((s) => (
        <div className="signal" key={s.code} data-sev={s.weight >= 30 ? "high" : "normal"}>
          <span className="w">{s.weight}</span>
          <span className="grow">
            <span className="sig-label">{s.label}</span>
            {!compact && <span className="sig-detail">{s.detail}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function computeSignalsLabel(signals: RiskSignal[]) {
  if (signals.length === 0) return "no signals";
  return `${signals.length} signal${signals.length === 1 ? "" : "s"} · ${signals
    .slice(0, 3)
    .map((s) => s.code)
    .join(" · ")}`;
}

export function RiskPill({ risk }: { risk: RiskAssessment }) {
  const meta = RISK_META[risk.level];
  return (
    <span className="badge" style={{ color: meta.color, background: `${meta.color}18`, borderColor: `${meta.color}33` }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: meta.color }} />
      {risk.score} · {meta.label}
    </span>
  );
}

export function RiskSummary({ risk, amountXAF }: { risk: RiskAssessment; amountXAF?: number }) {
  return (
    <div className="card flat" style={{ padding: 14 }}>
      <div className="row-between" style={{ marginBottom: 10 }}>
        <span className="up">Fraud engine verdict</span>
        <RiskPill risk={risk} />
      </div>
      <div className="row gap-12">
        <div style={{ flex: "none" }}>
          <RiskGauge score={risk.score} level={risk.level} size={104} />
        </div>
        <div className="grow stack gap-4">
          <span style={{ fontSize: 12.5, lineHeight: 1.45 }}>{risk.summary}</span>
          <span className="small muted" style={{ lineHeight: 1.4 }}>
            {risk.recommendedAction}
          </span>
          {amountXAF !== undefined && amountXAF > 0 && (
            <span className="tiny muted">Evaluated {money(amountXAF)} in {risk.evaluatedInMs.toFixed(1)} ms</span>
          )}
        </div>
      </div>
      <div className="hairline" style={{ margin: "10px 0 4px" }} />
      <SignalList signals={risk.signals} limit={3} compact />
    </div>
  );
}
