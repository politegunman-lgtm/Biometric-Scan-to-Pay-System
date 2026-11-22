import crypto from "node:crypto";

/**
 * Thin, auditable wrapper over the primitives the platform relies on.
 * No bespoke crypto: everything is node:crypto (OpenSSL) with explicit
 * algorithms, key sizes and purposes.
 */

export const b64url = (buf: Buffer | Uint8Array) =>
  Buffer.from(buf).toString("base64url");

export const fromB64url = (s: string) => Buffer.from(s, "base64url");

export const sha256Hex = (data: string | Buffer) =>
  crypto.createHash("sha256").update(data).digest("hex");

export const hmac = (key: string | Buffer, data: string | Buffer) =>
  crypto.createHmac("sha256", key).update(data).digest();

/** Identifier safe for URLs / logs: 12 bytes of CSPRNG entropy. */
export const randomId = (prefix = "id") =>
  `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;

export const randomHex = (bytes = 16) => crypto.randomBytes(bytes).toString("hex");

export const timingSafeEqualStr = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

/* ------------------------------------------------------------------ *
 * Ed25519 device identity
 * ------------------------------------------------------------------ */

export interface DeviceKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
  keyHandle: string;
}

export function createDeviceKeyPair(): DeviceKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    keyHandle: `se:${crypto.randomBytes(12).toString("hex")}`,
  };
}

export function signEd25519(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return b64url(crypto.sign(null, Buffer.from(payload), key));
}

export function verifyEd25519(publicKeyPem: string, payload: string, signature: string): boolean {
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    return crypto.verify(null, Buffer.from(payload), key, fromB64url(signature));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Envelope encryption for data at rest (biometric templates, keystore)
 * ------------------------------------------------------------------ */

const MASTER_KEY = crypto
  .createHash("sha256")
  .update(
    process.env.BSP_MASTER_KEY ??
      "dev-only-kek::biometric-scan-to-pay::do-not-use-in-production::v1",
  )
  .digest();

/**
 * AES-256-GCM envelope. Output: v1.<iv>.<tag>.<ciphertext> (all base64url).
 * Additional authenticated data binds the ciphertext to its owner + purpose,
 * so a sealed template cannot be lifted and replayed for another finger.
 */
export function seal(plaintext: string, aad: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", MASTER_KEY, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1.${b64url(iv)}.${b64url(cipher.getAuthTag())}.${b64url(ct)}`;
}

export function open(sealed: string, aad: string): string {
  const [v, iv, tag, ct] = sealed.split(".");
  if (v !== "v1") throw new Error("unsupported envelope version");
  const decipher = crypto.createDecipheriv("aes-256-gcm", MASTER_KEY, fromB64url(iv));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(fromB64url(tag));
  return Buffer.concat([decipher.update(fromB64url(ct)), decipher.final()]).toString("utf8");
}

/* ------------------------------------------------------------------ *
 * PIN (step-up) hashing — scrypt with per-user salt
 * ------------------------------------------------------------------ */

export function hashPin(pin: string, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(pin, salt, 32).toString("hex");
  return { salt, hash };
}

export function verifyPin(pin: string, salt: string, expectedHash: string) {
  const hash = crypto.scryptSync(pin, salt, 32).toString("hex");
  return timingSafeEqualStr(hash, expectedHash);
}

/* ------------------------------------------------------------------ *
 * Merchant QR request signatures + compact offline tokens
 * ------------------------------------------------------------------ */

export const canonical = (obj: Record<string, unknown>): string =>
  JSON.stringify(
    Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        if (obj[k] !== undefined) acc[k] = obj[k];
        return acc;
      }, {}),
  );

const MERCHANT_SIGNING_KEY = crypto
  .createHash("sha256")
  .update("merchant-network-v1::acquirer-hsm::cameroon")
  .digest();

export function signMerchantRequest(payload: Record<string, unknown>) {
  return hmac(MERCHANT_SIGNING_KEY, canonical(payload)).toString("base64url");
}

export function verifyMerchantRequest(payload: Record<string, unknown>, signature: string) {
  const expected = hmac(MERCHANT_SIGNING_KEY, canonical(payload)).toString("base64url");
  return timingSafeEqualStr(expected, signature);
}

/**
 * 8-byte truncated HMAC for the SMS/USSD fallback token. This is a deliberate
 * availability-over-strength trade-off: a 160-char USSD/SMS frame cannot carry
 * an Ed25519 voucher, so the fallback carries a short authenticator that the
 * server only accepts under the low-value offline cap, once.
 */
export function shortToken(secret: string, payload: string) {
  return hmac(secret, payload).subarray(0, 8).toString("hex").toUpperCase();
}
