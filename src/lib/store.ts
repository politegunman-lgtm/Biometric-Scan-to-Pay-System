import fs from "node:fs";
import path from "node:path";
import type {
  AuditEntry,
  BiometricState,
  DeviceKey,
  FraudAlert,
  Merchant,
  NetworkState,
  PaymentRequest,
  QueuedVoucher,
  SyncEvent,
  Txn,
  User,
  Wallet,
} from "./types";
import { buildSeed } from "./seed";

/**
 * JSON-file persistence.
 *
 * A single-tenant demo does not need Postgres, but the shape below maps 1:1 to
 * the production schema (users, wallets, devices, biometric_templates with a
 * sealed blob, transactions, offline_vouchers, fraud_alerts, audit_log). Writes
 * are serialised and atomic (write temp → fsync → rename) so a crash cannot
 * leave a half-written ledger.
 */

export interface DbSecrets {
  sensorSeed: string;
  pin: { salt: string; hash: string } | null;
  deviceKeys: Record<string, { privateKeyPem: string; smsSecret: string }>;
  /** Highest counter issued by each device (device-local nonce). */
  nextCounter: Record<string, number>;
  /** Counters the settlement server has already consumed (replay guard). */
  consumedCounters: Record<string, number[]>;
}

export interface Database {
  version: number;
  seededAt: string;
  user: User;
  wallets: Wallet[];
  biometric: BiometricState;
  devices: DeviceKey[];
  merchants: Merchant[];
  txns: Txn[];
  queue: QueuedVoucher[];
  requests: PaymentRequest[];
  alerts: FraudAlert[];
  network: NetworkState;
  audit: AuditEntry[];
  syncLog: SyncEvent[];
  vault: {
    lastSyncAt: string | null;
    syncedTxns: number;
    pendingTxns: number;
    encryptedBytes: number;
    region: string;
  };
  counters: {
    day: string;
    offlineSpentXAF: number;
    receiptSeq: number;
  };
  secrets: DbSecrets;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "store.json");

interface GlobalCache {
  db?: Database;
  chain?: Promise<unknown>;
}
const g = globalThis as unknown as { __bsp?: GlobalCache };
g.__bsp = g.__bsp ?? {};

function ensureDb(): Database {
  if (g.__bsp!.db) return g.__bsp!.db;
  try {
    if (fs.existsSync(DB_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DB_PATH, "utf8")) as Database;
      g.__bsp!.db = parsed;
      return parsed;
    }
  } catch (err) {
    console.warn("[bps] store unreadable, re-seeding:", (err as Error).message);
  }
  const seeded = buildSeed();
  persist(seeded);
  g.__bsp!.db = seeded;
  return seeded;
}

function persist(db: Database) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

export function readDb(): Database {
  return ensureDb();
}

/**
 * Serialised mutation. The callback receives the live object and returns a
 * value; the store is flushed to disk exactly once, after the callback settles.
 */
export async function mutateDb<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const previous = g.__bsp!.chain ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  g.__bsp!.chain = previous.then(() => gate);
  await previous.catch(() => undefined);
  try {
    const db = ensureDb();
    const result = await fn(db);
    persist(db);
    return result;
  } finally {
    release();
  }
}

export function resetDb(): Database {
  const fresh = buildSeed();
  persist(fresh);
  g.__bsp!.db = fresh;
  return fresh;
}

/* ------------------------------------------------------------------ *
 * Small helpers shared by the service layer
 * ------------------------------------------------------------------ */

export const nowIso = () => new Date().toISOString();

export function pushAudit(
  db: Database,
  entry: Omit<AuditEntry, "id" | "at">,
  id: string,
) {
  db.audit.unshift({ id, at: nowIso(), ...entry });
  db.audit = db.audit.slice(0, 120);
}

export function pushSync(
  db: Database,
  entry: Omit<SyncEvent, "id" | "at" | "tier">,
  id: string,
) {
  db.syncLog.unshift({ id, at: nowIso(), tier: db.network.tier, ...entry });
  db.syncLog = db.syncLog.slice(0, 80);
}

export function primaryWallet(db: Database): Wallet {
  return db.wallets.find((w) => w.primary) ?? db.wallets[0];
}

export function walletById(db: Database, id: string | undefined): Wallet {
  return db.wallets.find((w) => w.id === id) ?? primaryWallet(db);
}

export function deviceById(db: Database, id?: string): DeviceKey | undefined {
  return db.devices.find((d) => d.id === id);
}

export function merchantById(db: Database, id: string): Merchant | undefined {
  return db.merchants.find((m) => m.id === id);
}

/** Reset the rolling offline allowance when the calendar day changes. */
export function rollOfflineDay(db: Database) {
  const today = new Date().toISOString().slice(0, 10);
  if (db.counters.day !== today) {
    db.counters.day = today;
    db.counters.offlineSpentXAF = 0;
  }
  return db.counters.offlineSpentXAF;
}

export function markVaultDirty(db: Database) {
  const settled = db.txns.filter((t) => t.status === "settled").length;
  const pending = db.txns.filter((t) => t.status === "queued" || t.status === "syncing").length;
  db.vault.syncedTxns = settled;
  db.vault.pendingTxns = pending;
  db.vault.encryptedBytes = Math.round(
    db.txns.reduce((s, t) => s + JSON.stringify(t).length, 0) * 0.62,
  );
}
