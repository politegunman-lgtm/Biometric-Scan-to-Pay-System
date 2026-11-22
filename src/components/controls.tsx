"use client";

import { useEffect, useState } from "react";

export function ToggleRow({
  title,
  sub,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  sub?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="switch-row">
      <div className="sr-main">
        <div className="sr-title">{title}</div>
        {sub && <div className="sr-sub">{sub}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        className="switch"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

export function RangeRow({
  label,
  value,
  min,
  max,
  step = 500,
  onCommit,
  format,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (next: number) => void;
  format: (n: number) => string;
  hint?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <div className="threshold-block">
      <div className="threshold-head">
        <span className="th-label">{label}</span>
        <span className="th-val">{format(local)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        aria-label={label}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => onCommit(local)}
        onKeyUp={() => onCommit(local)}
        onBlur={() => onCommitIfChanged()}
      />
      {hint && (
        <div className="tiny muted" style={{ marginTop: 4, lineHeight: 1.45 }}>
          {hint}
        </div>
      )}
    </div>
  );

  function onCommitIfChanged() {
    if (local !== value) onCommit(local);
  }
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="stack gap-8"
      style={{
        alignItems: "center",
        textAlign: "center",
        padding: "26px 18px",
        borderRadius: 16,
        border: "1px dashed rgba(255,255,255,.12)",
        background: "rgba(255,255,255,.015)",
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          display: "grid",
          placeItems: "center",
          background: "rgba(255,255,255,.05)",
          color: "var(--muted)",
        }}
      >
        {icon}
      </span>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
      {body && <div className="small muted" style={{ maxWidth: 260, lineHeight: 1.5 }}>{body}</div>}
      {action}
    </div>
  );
}
