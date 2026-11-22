"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FingerprintGlyph } from "./icons";

export type PadStatus = "idle" | "pressed" | "verifying" | "success" | "error";

/**
 * Press-and-hold sensor pad. The gesture is the product's core affordance:
 * a tap is too easy to trigger accidentally, so authorisation requires a
 * deliberate hold with steady contact (which also produces the liveness
 * telemetry a real sensor needs to reject a lifted or printed ridge pattern).
 */
export function BiometricPad({
  status,
  disabled,
  onCapture,
  onCancel,
  holdMs = 900,
  hint,
}: {
  status: PadStatus;
  disabled?: boolean;
  onCapture: (args: { holdMs: number; stability: number }) => void;
  onCancel?: () => void;
  holdMs?: number;
  hint?: React.ReactNode;
}) {
  const [progress, setProgress] = useState(0);
  const [pressing, setPressing] = useState(false);
  const raf = useRef<number | null>(null);
  const startedAt = useRef(0);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const maxDrift = useRef(0);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);

  useEffect(() => () => clear(), [clear]);

  useEffect(() => {
    if (status === "verifying" || status === "success" || status === "error") {
      setPressing(false);
      setProgress(status === "success" ? 1 : 0);
      clear();
    }
  }, [status, clear]);

  const finish = useCallback(() => {
    if (fired.current) return;
    fired.current = true;
    const stability = Math.max(0.35, 1 - Math.min(1, maxDrift.current / 70));
    const elapsed = Math.max(holdMs, performance.now() - startedAt.current);
    setProgress(1);
    setPressing(false);
    clear();
    onCapture({ holdMs: Math.round(elapsed), stability });
  }, [clear, holdMs, onCapture]);

  const tick = useCallback(() => {
    const elapsed = performance.now() - startedAt.current;
    const p = Math.min(1, elapsed / holdMs);
    setProgress(p);
    if (p >= 1) {
      finish();
      return;
    }
    raf.current = requestAnimationFrame(tick);
  }, [finish, holdMs]);

  const start = (e: React.PointerEvent) => {
    if (disabled || status === "verifying" || status === "success") return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    fired.current = false;
    origin.current = { x: e.clientX, y: e.clientY };
    maxDrift.current = 0;
    startedAt.current = performance.now();
    setPressing(true);
    setProgress(0);
    clear();
    raf.current = requestAnimationFrame(tick);
  };

  const move = (e: React.PointerEvent) => {
    if (!pressing || !origin.current) return;
    const drift = Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y);
    maxDrift.current = Math.max(maxDrift.current, drift);
  };

  const end = () => {
    if (status === "verifying" || status === "success") return;
    setPressing(false);
    clear();
    if (!fired.current) {
      setProgress(0);
      onCancel?.();
    }
  };

  const state = status === "verifying" ? "scanning" : status === "idle" && pressing ? "pressed" : status;
  const circumference = 2 * Math.PI * 78;
  const offset = circumference * (1 - progress);

  return (
    <div className="stack gap-6" style={{ alignItems: "center" }}>
      <div
        className="biopad"
        data-state={state}
        role="button"
        tabIndex={0}
        aria-label="Hold to authenticate with your fingerprint"
        aria-disabled={disabled}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onPointerLeave={end}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (disabled) return;
            startedAt.current = performance.now() - holdMs;
            maxDrift.current = 0;
            fired.current = false;
            finish();
          }
        }}
      >
        <span className="halo" />
        <svg className="ring" viewBox="0 0 168 188" aria-hidden="true">
          <circle className="track" cx="84" cy="94" r="78" />
          <circle
            className="bar"
            cx="84"
            cy="94"
            r="78"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
          />
        </svg>
        <FingerprintGlyph size={88} className="finger" />
        <span className="scanline" />
      </div>
      <div className="bio-hint">{hint}</div>
    </div>
  );
}
