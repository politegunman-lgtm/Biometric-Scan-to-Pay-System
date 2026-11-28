"use client";

import { useApp } from "./AppProvider";
import { Icon } from "./icons";

export function ToastHost() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toast-wrap" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className="toast" data-tone={t.tone} onClick={() => dismissToast(t.id)}>
          <Icon
            name={t.tone === "ok" ? "check" : t.tone === "danger" ? "alert" : t.tone === "warn" ? "info" : "sparkle"}
            size={14}
            strokeWidth={2}
            style={{
              color:
                t.tone === "ok" ? "var(--mint)" : t.tone === "danger" ? "var(--coral)" : t.tone === "warn" ? "var(--amber)" : "var(--accent)",
              flex: "none",
            }}
          />
          <span style={{ textAlign: "left" }}>{t.text}</span>
        </button>
      ))}
    </div>
  );
}
