"use client";

import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Screen error:", error);
  }, [error]);

  return (
    <div className="page" style={{ display: "grid", placeItems: "center", minHeight: "70%" }}>
      <div className="card" style={{ textAlign: "center", padding: 24, maxWidth: 360 }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>⚠️</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
          This screen hit a snag
        </div>
        <p className="small muted" style={{ lineHeight: 1.5, marginBottom: 16 }}>
          Your balance, vouchers and queue are stored on the server and untouched. Try loading the screen again.
        </p>
        <button className="btn primary" type="button" onClick={reset}>
          Retry
        </button>
      </div>
    </div>
  );
}
