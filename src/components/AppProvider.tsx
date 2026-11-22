"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { apiJson } from "@/lib/client";
import { randomSeed, readLocalSeed, sensorTemplate, writeLocalSeed } from "@/lib/sensor";
import type {
  AppState,
  FraudAlert,
  MerchantCategory,
  NetworkTier,
  PaymentChannel,
  Txn,
  UserSettings,
} from "@/lib/types";
import type { ScenarioResult, SyncResult } from "@/lib/service";

export type Tone = "ok" | "warn" | "danger" | "info";

export interface ToastItem {
  id: number;
  text: string;
  tone: Tone;
}

export interface PayTarget {
  requestId?: string;
  merchantId: string;
  merchantName: string;
  merchantCode?: string;
  amountXAF: number;
  note?: string;
  category: MerchantCategory;
  channel?: PaymentChannel;
  source?: "request" | "manual" | "merchant";
}

interface AppContextValue {
  state: AppState | null;
  error: string | null;
  busy: string | null;
  refresh: () => Promise<AppState | null>;
  toast: (text: string, tone?: Tone) => void;
  toasts: ToastItem[];
  dismissToast: (id: number) => void;
  payTarget: PayTarget | null;
  openPay: (target: PayTarget) => void;
  closePay: () => void;
  activeTxn: Txn | null;
  setActiveTxn: (txn: Txn | null) => void;
  sync: (opts?: { replay?: boolean }) => Promise<SyncResult | null>;
  setTier: (tier: NetworkTier) => Promise<void>;
  saveSettings: (patch: Partial<UserSettings>) => Promise<void>;
  simulate: (scenario: string) => Promise<ScenarioResult | null>;
  resolveAlert: (alertId: string, status: FraudAlert["status"]) => Promise<void>;
  trustDevice: (deviceId: string, trusted: boolean) => Promise<void>;
  sensorSeed: string | null;
  enrollFinger: (fingerId: string, label: string) => Promise<boolean>;
  removeFinger: (fingerId: string) => Promise<void>;
  rotateSensor: () => Promise<void>;
  reseedDemo: () => Promise<void>;
  setPin: (pin: string) => Promise<boolean>;
  openAlerts: number;
}

const AppCtx = createContext<AppContextValue | null>(null);

export function useApp() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [payTarget, setPayTarget] = useState<PayTarget | null>(null);
  const [activeTxn, setActiveTxn] = useState<Txn | null>(null);
  const [sensorSeed, setSensorSeed] = useState<string | null>(null);
  const toastSeq = useRef(0);

  const toast = useCallback((text: string, tone: Tone = "info") => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-2), { id, text, tone }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4600);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await apiJson<AppState>("/api/state");
      setState(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reach the wallet service");
      return null;
    }
  }, []);

  /* Boot: restore the simulated sensor secret, then load state. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let seed = readLocalSeed();
      if (!seed) {
        try {
          const meta = await apiJson<{ sensorSeed: string }>("/api/biometric");
          seed = meta.sensorSeed;
          writeLocalSeed(seed);
        } catch {
          seed = randomSeed();
          writeLocalSeed(seed);
        }
      }
      if (!cancelled) setSensorSeed(seed);
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  /*
   * Boot watchdog: if the first state fetch never settles (blocked dev asset,
   * wrong host, offline phone) the screen would sit on "Verifying device key"
   * forever with no explanation. After a few seconds, say something useful.
   */
  useEffect(() => {
    if (state) return;
    const id = window.setTimeout(() => {
      setError(
        (prev) =>
          prev ??
          "Still waiting for the wallet service. On a phone, make sure this host is allowed by the dev server (allowedDevOrigins) and that /api/state is reachable.",
      );
    }, 9000);
    return () => window.clearTimeout(id);
  }, [state]);

  /* Light polling keeps the queue, alerts and network profile live. */
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 20_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const openPay = useCallback((target: PayTarget) => {
    setActiveTxn(null);
    setPayTarget(target);
  }, []);
  const closePay = useCallback(() => setPayTarget(null), []);

  const sync = useCallback(
    async (opts?: { replay?: boolean }) => {
      setBusy("sync");
      try {
        const result = await apiJson<SyncResult>("/api/sync", {
          method: "POST",
          body: JSON.stringify(opts ?? {}),
        });
        await refresh();
        if (opts?.replay) {
          toast(
            result.replay?.detected
              ? "Replay blocked — no duplicate charge possible"
              : result.message,
            result.replay?.detected ? "ok" : "info",
          );
        } else {
          toast(
            result.message,
            result.ok === false ? "danger" : result.rejected.length ? "warn" : "ok",
          );
        }
        return result;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Sync failed", "danger");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [refresh, toast],
  );

  const setTier = useCallback(
    async (tier: NetworkTier) => {
      setBusy("network");
      try {
        await apiJson("/api/network", { method: "POST", body: JSON.stringify({ tier }) });
        const next = await refresh();
        if (tier !== "offline" && next?.user.settings.autoSync && next.queue.some((q) => q.status === "queued")) {
          void sync();
        }
        if (tier === "offline") {
          toast("Radio off — payments will be signed offline and settle later", "warn");
        } else if (tier === "weak") {
          toast("EDGE profile — micro-batches only, expect settlement delays", "warn");
        } else {
          toast(`Radio on ${tier === "excellent" ? "4G" : "3G"} — cloud sync available`, "ok");
        }
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not change network profile", "danger");
      } finally {
        setBusy(null);
      }
    },
    [refresh, sync, toast],
  );

  const saveSettings = useCallback(
    async (patch: Partial<UserSettings>) => {
      setBusy("settings");
      try {
        await apiJson("/api/settings", { method: "POST", body: JSON.stringify(patch) });
        await refresh();
        toast("Protection settings saved", "ok");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not save settings", "danger");
      } finally {
        setBusy(null);
      }
    },
    [refresh, toast],
  );

  const simulate = useCallback(
    async (scenario: string) => {
      setBusy("simulate");
      try {
        return await apiJson<ScenarioResult>("/api/fraud", {
          method: "POST",
          body: JSON.stringify({ scenario }),
        });
      } catch (err) {
        toast(err instanceof Error ? err.message : "Simulation failed", "danger");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const resolveAlert = useCallback(
    async (alertId: string, status: FraudAlert["status"]) => {
      try {
        await apiJson("/api/fraud", {
          method: "PATCH",
          body: JSON.stringify({ alertId, status }),
        });
        await refresh();
        toast(`Alert ${status}`, "ok");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not update alert", "danger");
      }
    },
    [refresh, toast],
  );

  const trustDevice = useCallback(
    async (deviceId: string, trusted: boolean) => {
      try {
        const res = await apiJson<{ message: string }>("/api/devices", {
          method: "POST",
          body: JSON.stringify({ deviceId, trusted }),
        });
        await refresh();
        toast(res.message, trusted ? "ok" : "warn");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not update device", "danger");
      }
    },
    [refresh, toast],
  );

  const enrollFinger = useCallback(
    async (fingerId: string, label: string) => {
      if (!sensorSeed) {
        toast("Sensor not ready yet", "warn");
        return false;
      }
      setBusy("enroll");
      try {
        const template = await sensorTemplate(sensorSeed, fingerId);
        const res = await apiJson<{ message: string }>("/api/biometric", {
          method: "POST",
          body: JSON.stringify({ action: "enroll", fingerId, label, sample: template, quality: 0.95 }),
        });
        await refresh();
        toast(res.message, "ok");
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Enrollment failed", "danger");
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refresh, sensorSeed, toast],
  );

  const removeFinger = useCallback(
    async (fingerId: string) => {
      try {
        await apiJson("/api/biometric", {
          method: "POST",
          body: JSON.stringify({ action: "remove", fingerId }),
        });
        await refresh();
        toast("Template deleted", "ok");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Could not delete template", "danger");
      }
    },
    [refresh, toast],
  );

  /**
   * Simulates replacing the device's secure element: a fresh sensor secret is
   * generated and every enrolled finger has to be re-bound to it. Existing
   * templates would otherwise silently stop matching, so we run the enrolment
   * ceremony for the customer instead of leaving them locked out.
   */
  const rotateSensor = useCallback(async () => {
    const seed = randomSeed();
    writeLocalSeed(seed);
    setSensorSeed(seed);
    setBusy("enroll");
    try {
      const fingers = state?.biometric.fingers ?? [];
      for (const f of fingers) {
        const template = await sensorTemplate(seed, f.id);
        await apiJson("/api/biometric", {
          method: "POST",
          body: JSON.stringify({
            action: "enroll",
            fingerId: f.id,
            label: f.label,
            sample: template,
            quality: f.quality,
          }),
        });
      }
      await refresh();
      toast(
        `New sensor secret bound to ${fingers.length} template${fingers.length === 1 ? "" : "s"} on this device`,
        "ok",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not re-bind templates", "danger");
    } finally {
      setBusy(null);
    }
  }, [state, refresh, toast]);

  const reseedDemo = useCallback(async () => {
    setBusy("reset");
    try {
      await apiJson("/api/demo", { method: "POST" });
      const meta = await apiJson<{ sensorSeed: string }>("/api/biometric");
      writeLocalSeed(meta.sensorSeed);
      setSensorSeed(meta.sensorSeed);
      setPayTarget(null);
      setActiveTxn(null);
      await refresh();
      toast("Demo environment reseeded", "ok");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Reset failed", "danger");
    } finally {
      setBusy(null);
    }
  }, [refresh, toast]);

  const setPin = useCallback(
    async (pin: string) => {
      try {
        await apiJson("/api/biometric", {
          method: "POST",
          body: JSON.stringify({ action: "pin", pin }),
        });
        await refresh();
        toast("Step-up PIN updated", "ok");
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : "PIN rejected", "danger");
        return false;
      }
    },
    [refresh, toast],
  );

  const openAlerts = useMemo(
    () => state?.alerts.filter((a) => a.status === "open").length ?? 0,
    [state],
  );

  const value: AppContextValue = {
    state,
    error,
    busy,
    refresh,
    toast,
    toasts,
    dismissToast,
    payTarget,
    openPay,
    closePay,
    activeTxn,
    setActiveTxn,
    sync,
    setTier,
    saveSettings,
    simulate,
    resolveAlert,
    trustDevice,
    sensorSeed,
    enrollFinger,
    removeFinger,
    rotateSensor,
    reseedDemo,
    setPin,
    openAlerts,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
