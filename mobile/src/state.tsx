import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { apiJson, defaultBase, getBase, setBase as persistBase } from "./lib/api";
import { livenessProof, sensorCapture } from "./lib/sensor";
import type { AppState, PayOutcome, PayTarget } from "./lib/types";

const SESSION_KEY = "bsp.session";

export interface BiometricResult {
  ok: boolean;
  /** What the operating system reported, e.g. "fingerprint" or "demo". */
  method: string;
  detail: string;
}

interface Ctx {
  state: AppState | null;
  error: string | null;
  loading: boolean;
  signedIn: boolean | null;
  base: string;
  refresh: () => Promise<AppState | null>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  saveBase: (url: string | null) => Promise<void>;
  promptBiometrics: (reason: string) => Promise<BiometricResult>;
  authorize: (
    target: PayTarget,
    opts: { quality?: number; spoof?: boolean; pin?: string; holdMs?: number; skipOsPrompt?: boolean },
  ) => Promise<PayOutcome>;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [base, setBase] = useState(defaultBase());
  const [sensorSeed, setSensorSeed] = useState<string | null>(null);
  const [fingerId, setFingerId] = useState<string>("right-index");

  useEffect(() => {
    (async () => {
      setBase(await getBase());
      try {
        setSignedIn((await AsyncStorage.getItem(SESSION_KEY)) === "1");
      } catch {
        setSignedIn(false);
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await apiJson<AppState>("/api/state");
      setState(next);
      setError(null);
      if (next.biometric.fingers[0]) setFingerId(next.biometric.fingers[0].id);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reach the wallet service");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /* The server's simulated sensor secret, used to derive capture vectors. */
  const ensureSeed = useCallback(async () => {
    if (sensorSeed) return sensorSeed;
    const meta = await apiJson<{ sensorSeed: string }>("/api/biometric");
    setSensorSeed(meta.sensorSeed);
    return meta.sensorSeed;
  }, [sensorSeed]);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  useEffect(() => {
    if (!signedIn) return;
    const id = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(id);
  }, [signedIn, refresh]);

  const signIn = useCallback(async () => {
    try {
      await AsyncStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* ignore */
    }
    setSignedIn(true);
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    setSignedIn(false);
  }, []);

  const saveBase = useCallback(async (url: string | null) => {
    await persistBase(url);
    setBase(await getBase());
  }, []);

  /**
   * Real device biometrics. The OS owns the sensor: we get authenticity plus the
   * modality that matched, never a template. When no sensor is enrolled (emulator,
   * fresh device) the demo continues without it and says so.
   */
  const promptBiometrics = useCallback(async (reason: string): Promise<BiometricResult> => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !enrolled) {
        return {
          ok: true,
          method: "demo",
          detail: hasHardware
            ? "No fingerprint or face enrolled on this device — continuing with the simulated sensor."
            : "This device has no biometric sensor — continuing with the simulated sensor.",
        };
      }
      const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
      const modality = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
        ? "Face"
        : types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
          ? "Fingerprint"
          : "Biometric";
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: reason,
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
        fallbackLabel: "Use PIN",
      });
      if (!result.success) {
        return {
          ok: false,
          method: modality,
          detail:
            (result as { error?: string }).error === "user_cancel"
              ? "Cancelled — nothing was authorised."
              : "The device could not confirm it is you.",
        };
      }
      return { ok: true, method: modality, detail: `${modality} confirmed by the device` };
    } catch (err) {
      return { ok: true, method: "demo", detail: `Sensor unavailable (${(err as Error).message}) — simulated capture.` };
    }
  }, []);

  const authorize = useCallback(
    async (
      target: PayTarget,
      opts: { quality?: number; spoof?: boolean; pin?: string; holdMs?: number; skipOsPrompt?: boolean },
    ): Promise<PayOutcome> => {
      const seed = await ensureSeed();
      const sample = sensorCapture({
        seed,
        fingerId,
        quality: opts.spoof ? 0.97 : (opts.quality ?? 0.96),
      });
      const body = {
        requestId: target.requestId,
        merchantId: target.merchantId,
        amountXAF: target.amountXAF,
        note: target.note,
        walletId: state?.wallets[0]?.id,
        fingerId,
        sample,
        liveness: livenessProof(opts.holdMs ?? 1150, { spoof: opts.spoof }),
        deviceId: state?.devices.find((d) => d.trusted)?.id ?? "dev_pixel",
        channel: target.requestId ? "qr-scan" : "nfc-tap",
        pin: opts.pin,
      };
      const outcome = await apiJson<PayOutcome>("/api/pay", { method: "POST", body: JSON.stringify(body) });
      if (outcome.status === "settled" || outcome.status === "queued") void refresh();
      return outcome;
    },
    [ensureSeed, fingerId, refresh, state],
  );

  const value = useMemo<Ctx>(
    () => ({
      state,
      error,
      loading,
      signedIn,
      base,
      refresh,
      signIn,
      signOut,
      saveBase,
      promptBiometrics,
      authorize,
    }),
    [state, error, loading, signedIn, base, refresh, signIn, signOut, saveBase, promptBiometrics, authorize],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
