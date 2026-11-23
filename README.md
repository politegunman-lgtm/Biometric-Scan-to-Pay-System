# Scan to Pay — biometric one-tap payments for African mobile money

A working prototype of a payments rail that puts **Apple Pay / Samsung Pay ergonomics on top of mobile money**, with
MTN MoMo Cameroon as the reference integration. One deliberate finger hold authorises the wallet; if the network is dead,
a signed voucher settles later; an explainable risk engine sits between the fingertip and the money.

Built with Next.js 16, React 19, TypeScript and `node:crypto`. No payment SDKs, no chart libraries, no UI kit — the
sensor, risk engine, voucher protocol and settlement server are all real code you can poke at.

```
Wallet app (phone shell)        Operations console (desktop rail)
 ┌─────────────────────┐        ┌──────────────────────────────┐
 │ Home / Scan         │        │ Radio profile (4G→offline)   │
 │ Biometric pay sheet │  API   │ Offline voucher queue        │
 │ Activity dashboard  │◄──────►│ Fraud pulse + transport log  │
 │ Security centre     │        │ Merchant terminal link       │
 │ Wallet + vault      │        └──────────────────────────────┘
 └─────────────────────┘
        │                                    │
        ▼                                    ▼
  /api/pay · /api/biometric          /api/sync · /api/network
        │                                    │
        └────────► authorisation core ◄──────┘
                   ├── sealed biometric templates (AES-256-GCM)
                   ├── fraud engine (12 signal families, explainable)
                   ├── offline voucher reconciler (Ed25519 + counters)
                   └── provider adapters (MTN MoMo · Orange Money · Express Union)
```

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

The demo seeds itself with 90 days of history on first request (deterministic, ~140 transactions). A phone-shaped app and
an operations console share the same state — open `/merchant` in a second tab to mint a QR and pay it from the app.

```bash
npm test             # 41 unit tests: fraud rules, voucher protocol, crypto, matcher, SHA-256 parity
npm run smoke        # 28 end-to-end checks against a running dev server
npm run build        # production build
```

## Run it on your phone

It is a mobile-first web app, so no app store build is required.

**From this machine (LAN).** Run `npm run dev:phone`. It starts the server on `0.0.0.0:3000`, waits for it to answer,
then prints the LAN URL and a terminal QR code to scan with the phone camera:

```
 Scan to Pay — open this on a phone on the same Wi-Fi
 this computer:  http://127.0.0.1:3000
 phone:          http://192.168.1.24:3000
 █▀▀▀▀▀█ ▄▀ ▄▀▄ █▀▀▀▀▀█   ← scan this
```

`npm run dev` works too if you prefer to read the IP yourself (`ipconfig getifaddr en0` on macOS, `hostname -I` on
Linux). The device frame disappears below 640 px and the bottom tab bar takes over.

**Add to Home Screen.** The app ships a web manifest, an Apple touch icon (`apple-icon.png`) and
`display: standalone`, so Safari → Share → *Add to Home Screen* (or Chrome → ⋮ → *Install app*) opens it fullscreen
with a real icon and no browser chrome. `viewport-fit=cover` plus `env(safe-area-inset-*)` keep the status bar and
the home indicator from overlapping the UI.

**No HTTPS needed.** Biometric derivation needs SHA-256. `crypto.subtle` only exists in secure contexts, which would
have broken the app on a plain-`http` LAN address, so `src/lib/sha256.ts` provides a byte-identical fallback that is
covered by tests (`tests/parity.test.ts`). Both paths produce the same templates as the server matcher.

**Deploying.** `next build && npm start` works on any Node host, but `data/store.json` is a local file: on a serverless
platform (Vercel, Netlify) the filesystem is ephemeral, so persistence needs Postgres/KV first. On a VM or container
with a mounted volume it is fine as-is.

## What is implemented

| Requirement | Implementation |
| --- | --- |
| Biometric one-tap authentication | Press-and-hold sensor pad → 128-dim embedding → sealed-template cosine match at 0.86 threshold, with liveness (pulse, micro-motion, contact depth), lockout after 5 failures and score-drift detection. |
| Works with local mobile money, not just MTN | Provider adapters behind one interface; wallets for MTN MoMo, Orange Money and Express Union ship in the app. Adding an operator is an adapter, not a rewrite. |
| Offline transaction support | Device-signed Ed25519 vouchers with monotonic counters, 72h expiry, per-payment and daily caps, replay rejection, idempotent settlement and an SMS/USSD 160-char fallback. |
| Robust fraud detection | Additive, explainable scoring across amount, velocity, geo, device, biometric, merchant, behaviour and network families, with per-family caps, hard rules and allow / step-up / block decisions. |
| Cloud-synced history dashboard | Encrypted vault metadata, 7/30/90-day spend analysis, category donut, merchant concentration, offline share, fraud prevented, search/filter and CSV export. |
| Low-network fallback protocols | 4G → 3G (gzip delta) → EDGE (micro-batches + exponential backoff) → no data (vouchers + SMS), all driven by a live radio simulator. |

Extras: merchant terminal with signed QR requests, audit trail, device trust/revocation, step-up PIN (scrypt), alert review
loop, fraud-scenario sandbox, and an in-app architecture document at `/docs`.

## Five-minute demo script

| Step | Where | What to notice |
| --- | --- | --- |
| 0 | First open → sign in | Number → 6-digit code (**123456**) → enable fingerprint. Only once per browser; **Wallet → Lock app** replays it. |
| 1 | Home → **Tap to pay** → hold the sensor | Settles in one hold; receipt shows match score, liveness and risk score. |
| 2 | Pay sheet simulator → **Impostor finger** | Match ~0% — payment refused before the risk engine runs. |
| 3 | Simulator → **Spoof / no pulse** | Genuine embedding, failed liveness — replay defence. |
| 4 | Security → **Stolen device + spoof** | Risk 99, blocked, every reason listed with its weight. |
| 5 | Security → **Impossible travel** | Hard block: 700 km in 12 minutes means a cloned credential. |
| 6 | Ops console → radio **No data** → pay twice | Vouchers queued, SMS tokens generated, balance untouched. |
| 7 | Radio back to **3G** → **Settle**, then **Replay drill** | Batch settles; replaying a consumed counter is rejected with no funds moved. |
| 8 | Activity | 7/30/90-day analysis, offline filter, CSV export. |
| 9 | `/merchant` on a computer, app on a phone | Enter an amount → **Generate QR**, then point the phone camera at it: the link opens `/scan?req=…` and lands on that exact request. Pay, and the terminal flips to **PAID** within 3 s. |

### Why sign in at all, if the fingerprint already authorises payments?

They answer different questions. Sign-in (number + OTP, the primitive MTN MoMo and Orange Money already use) proves *who
holds the account* and binds this browser to it. The fingerprint authorises *each individual payment* — possession plus
intent, per transaction. Drop sign-in and an unlocked stolen phone is a wallet; drop the fingerprint and a shoulder-surfed
PIN is. The flow is deliberately three taps long and remembered per device, like "trust this device".

Demo step-up PIN: **2580** (change it in Security). Biometrics are simulated; everything downstream of the matcher is real.

## How the three pillars work

### 1. Biometrics

Enrolment extracts a 128-dimensional embedding and seals it with AES-256-GCM, using the account and finger id as
additional authenticated data. The raw print never leaves the sensor. Authorisation requires a ~900 ms hold; the pad reports
hold duration, micro-motion and contact depth, so a static print or photo fails even when the embedding matches. Scores
between 0.86 and 0.90 pass but force a PIN. Five failures lock the matcher for five minutes.

In production the matcher runs inside the OEM secure enclave (Android BiometricPrompt / iOS LocalAuthentication) and returns
a signed assertion. This prototype generates the capture in the browser with Web Crypto and matches server-side so every
step stays inspectable — see `/docs#reality` for the full simulated-vs-real table.

### 2. Offline vouchers

```
voucher = { v, txnId, userId, deviceId, counter, amountXAF, currency,
            merchantId, merchantRef, issuedAt, expiresAt,
            channel, authScore, livenessPassed, riskScore,
            signature  // Ed25519 over the canonical payload
          }
```

Settlement accepts a voucher only if **all** of these hold: signature verifies against the currently trusted device key,
counter is unseen and within the device window, amount respects per-payment and daily caps, voucher has not expired,
merchant exists, and the wallet can cover the debit. Signature and trust are checked before anything else — the earlier
version of this code had an idempotency fast-path that could skip verification, which is exactly the kind of bug the test
suite now pins down.

The SMS fallback trades strength for availability: a truncated 8-byte HMAC in a 160-character frame, accepted only below
10 000 FCFA and marked `offline-sms` in the ledger. The issuer's maximum exposure per device is the daily cap, which is why
the caps, counter and risk score travel inside the signature.

### 3. Fraud engine

Additive and explainable: every block must be defensible to the customer, the operator and the regulator. Signals carry
their evidence (for example `AMOUNT_Z_HIGH: 285 000 FCFA is 48.7σ above your 8 489 FCFA average ticket`). Correlated
signals are capped per family so three amount signals describing the same fact cannot manufacture a block. Decision band:
`<30` allow, `30–64` step-up PIN, `65+` block, plus hard rules for impossible travel, liveness failure and above-cap
offline vouchers.

## Repository map

```
src/app/(app)/          phone shell: home, scan, activity, security, wallet
src/app/merchant/       merchant terminal (signed QR requests)
src/app/docs/           in-app architecture & API document
src/app/api/            state, pay, biometric, merchant, sync, network, fraud, settings, devices, export, qr
src/lib/biometrics.ts   matching, liveness, sensor synthesis
src/lib/fraud.ts        scoring engine, family caps, hard rules, baseline learner
src/lib/offline.ts      voucher protocol, settlement checks, transport ladder
src/lib/service.ts      authorisation, queueing, settlement, state projection
src/lib/crypto.ts       AES-256-GCM seals, Ed25519, scrypt, HMAC
src/lib/store.ts        atomic JSON persistence + seed
src/lib/providers.ts    MTN MoMo / Orange Money / Express Union adapters
src/components/         app shell, pay sheet, biometric pad, charts, risk UI
tests/                  unit tests (fraud, offline, biometrics, crypto)
scripts/smoke.mts       end-to-end API walkthrough
```

## Notes and limits

- **State is a JSON file** (`data/store.json`, gitignored) written atomically. It maps 1:1 to the production schema but is
  single-tenant by design. Reseed from the console or `POST /api/demo`.
- **No real money moves.** The operator adapters simulate a MoMo `requestToPay` → status poll cycle with idempotency keys.
- **Biometric bias is real.** Thresholds must be tuned per cohort and a PIN fallback must remain for BEAC consumer
  protection. Offline caps bound exposure but not behaviour; merchant-side voucher velocity limits are the next control.
- Regulatory and certification work (operator approval, COBAC/BEAC e-money reporting, USSD economics) is described in
  `/docs#limits`.

## License

Prototype for evaluation. MTN MoMo, Orange Money and Express Union are trademarks of their respective owners; this project
is not affiliated with them.
