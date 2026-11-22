import type { NetworkTier } from "./types";

/**
 * Low-connectivity transport ladder. Shared by server and client — this is the
 * policy that decides how much of the protocol is allowed to run on the current
 * radio, and what the fallback is when the radio dies entirely.
 */

export interface TransportPlan {
  tier: NetworkTier;
  label: string;
  bars: number;
  requiresOnline: boolean;
  batchSize: number;
  compress: boolean;
  timeoutMs: number;
  retryBackoffMs: number[];
  deltaOnly: boolean;
  fallback: string;
  description: string;
}

export const TRANSPORT_LADDER: Record<NetworkTier, TransportPlan> = {
  excellent: {
    tier: "excellent",
    label: "4G / 5G",
    bars: 4,
    requiresOnline: true,
    batchSize: 50,
    compress: false,
    timeoutMs: 4000,
    retryBackoffMs: [500, 1500, 4000],
    deltaOnly: false,
    fallback: "none — full realtime sync",
    description:
      "Realtime authorisation against the operator core. Receipts, risk counters and history stream immediately.",
  },
  good: {
    tier: "good",
    label: "3G",
    bars: 3,
    requiresOnline: true,
    batchSize: 20,
    compress: true,
    timeoutMs: 6000,
    retryBackoffMs: [800, 2400, 6000],
    deltaOnly: true,
    fallback: "gzip delta + batched receipts",
    description:
      "Delta sync with gzip: only new transactions and risk counters travel. Authorisation stays realtime.",
  },
  weak: {
    tier: "weak",
    label: "EDGE / 2G",
    bars: 1,
    requiresOnline: true,
    batchSize: 5,
    compress: true,
    timeoutMs: 12_000,
    retryBackoffMs: [2000, 8000, 20_000],
    deltaOnly: true,
    fallback: "queue locally, flush micro-batches every 5 min",
    description:
      "Authorisation can time out. Payments are queued as signed vouchers and flushed in micro-batches with exponential backoff.",
  },
  offline: {
    tier: "offline",
    label: "No data · GSM only",
    bars: 0,
    requiresOnline: false,
    batchSize: 1,
    compress: false,
    timeoutMs: 0,
    retryBackoffMs: [],
    deltaOnly: false,
    fallback: "SMS/USSD compact token, settle on next network",
    description:
      "Device-signed vouchers settle later. Where low-value payments must still clear, a 160-char SMS/USSD token is relayed by the operator SMSC.",
  },
};

export const NETWORK_PRESETS: Record<NetworkTier, { latencyMs: number; packetLoss: number }> = {
  excellent: { latencyMs: 45, packetLoss: 0.1 },
  good: { latencyMs: 180, packetLoss: 0.4 },
  weak: { latencyMs: 950, packetLoss: 6.5 },
  offline: { latencyMs: 0, packetLoss: 100 },
};

export function transportFor(tier: NetworkTier): TransportPlan {
  return TRANSPORT_LADDER[tier];
}

export const OFFLINE_SMS_MAX_XAF = 10_000;
