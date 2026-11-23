/**
 * Backend client for the existing Next.js app.
 *
 * The API base has to be discovered, not hard-coded: the phone runs on a
 * different device from the server, so `localhost` is the phone itself. Metro
 * already knows the computer's LAN address (`hostUri`), so the default base is
 * "same host as Metro, port 3000" — exactly where `npm run dev:phone` listens.
 * A manual override is stored locally for the cases where that guess is wrong.
 */

import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

const OVERRIDE_KEY = "bsp.apiBase";

export function metroHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as unknown as { expoGoConfig?: { debuggerHost?: string } }).expoGoConfig?.debuggerHost ??
    null;
  if (!hostUri) return null;
  return hostUri.split(":")[0] || null;
}

export function defaultBase(): string {
  const host = metroHost();
  return host ? `http://${host}:3000` : "http://localhost:3000";
}

export async function getBase(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(OVERRIDE_KEY)) ?? defaultBase();
  } catch {
    return defaultBase();
  }
}

export async function setBase(url: string | null): Promise<void> {
  try {
    if (url && url.trim()) await AsyncStorage.setItem(OVERRIDE_KEY, url.trim().replace(/\/$/, ""));
    else await AsyncStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function apiJson<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const base = await getBase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? 15_000);
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const payload = data as { message?: string; error?: string; errorCode?: string } | null;
      throw new ApiError(payload?.message ?? payload?.error ?? `Request failed (${res.status})`, res.status, payload?.errorCode);
    }
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error)?.name === "AbortError") throw new ApiError("The server did not answer in time", 0, "timeout");
    throw new ApiError(
      `Cannot reach the wallet service at ${base}. Is \`npm run dev:phone\` running on the computer, and are both devices on the same Wi-Fi?`,
      0,
      "unreachable",
    );
  } finally {
    clearTimeout(timer);
  }
}
