"use client";

import { useId } from "react";

const moneyCompact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`;

/** Smoothed area chart, 30-day spend. Pure SVG, no chart library. */
export function AreaChart({
  data,
  height = 96,
  accent = "#FFCB05",
  showGrid = true,
}: {
  data: { date: string; amountXAF: number }[];
  height?: number;
  accent?: string;
  showGrid?: boolean;
}) {
  const uid = useId().replace(/[:]/g, "");
  const W = 300;
  const H = height;
  const padY = 10;
  const values = data.map((d) => d.amountXAF);
  const max = Math.max(1, ...values);
  const step = data.length > 1 ? W / (data.length - 1) : W;
  const pts = data.map((d, i) => ({
    x: i * step,
    y: H - padY - (d.amountXAF / max) * (H - padY * 2),
  }));

  const linePath = (() => {
    if (pts.length < 2) return "";
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i];
      const p1 = pts[i + 1];
      const cx = (p0.x + p1.x) / 2;
      d += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
    return d;
  })();

  const fillPath = `${linePath} L ${pts[pts.length - 1]?.x ?? W} ${H} L 0 ${H} Z`;
  const peakIndex = values.indexOf(Math.max(...values));

  return (
    <svg
      className="area-chart"
      viewBox={`0 0 ${W} ${H}`}
      height={H}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Daily spend, peak ${moneyCompact(max)} FCFA`}
    >
      <defs>
        <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
          <stop offset="70%" stopColor={accent} stopOpacity="0.04" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {showGrid &&
        [0.25, 0.5, 0.75].map((f) => (
          <line key={f} className="grid-line" x1="0" x2={W} y1={H * f} y2={H * f} vectorEffect="non-scaling-stroke" />
        ))}
      {pts.length > 1 && (
        <>
          <path d={fillPath} fill={`url(#area-${uid})`} />
          <path d={linePath} className="line" stroke={accent} vectorEffect="non-scaling-stroke" />
          {pts[peakIndex] && (
            <circle cx={pts[peakIndex].x} cy={pts[peakIndex].y} r="3" fill={accent} stroke="#06080a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          )}
        </>
      )}
    </svg>
  );
}

export function Donut({
  items,
  size = 96,
  thickness = 10,
}: {
  items: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  let acc = 0;

  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Spend by category">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={thickness} />
      {items.map((item) => {
        const frac = item.value / total;
        const dash = frac * c;
        const offset = -acc * c;
        acc += frac;
        return (
          <circle
            key={item.label}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={item.color}
            strokeWidth={thickness}
            strokeDasharray={`${Math.max(0, dash - 2)} ${c}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
      })}
    </svg>
  );
}

export function Bars({ values, height = 44 }: { values: number[]; height?: number }) {
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  return (
    <div className="bars" style={{ height }}>
      {values.map((v, i) => (
        <i key={i} className={i === peak ? "peak" : ""} style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

export function Sparkline({ values, width = 64, height = 22 }: { values: number[]; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"} ${i * step} ${height - (v / max) * (height - 3) - 1.5}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
