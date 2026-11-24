# Scan to Pay — Expo (Android, Expo Go)

A React Native client for the same wallet service as the web app in the repository root. Nothing in `../`
(`src/`, `scripts/`, `data/`) is modified: this folder is a separate app that consumes the existing HTTP API.

> **Why not a separate git branch?** This workspace is pinned to one branch per session, so the app lives in
> `mobile/` on the current branch instead. It is self-contained — to give it its own repository later:
> `git subtree split --prefix mobile -b mobile-only` or copy the folder.

## What is real and what is simulated

| Layer | Status |
| --- | --- |
| Fingerprint / face prompt | **Real.** Android BiometricPrompt via `expo-local-authentication` — the OS decides, the app never sees a template. |
| Camera + QR scanning | **Real.** `expo-camera`, scanned on device, works with the radio off. |
| Session storage | **Real.** `AsyncStorage`, so reopening the app skips the OTP. |
| Template matching, vouchers, fraud scoring | **Simulated** — same demo engine as the web app, on the server. |

Because the demo server matches 128-dimension vectors, the app derives the same vector the web client derives from
the server's `sensorSeed` (`src/lib/sha256.ts` is byte-identical to the server's hashing). That keeps the existing
backend unmodified. In a production build this module disappears: the sensor returns a signed assertion instead.

## Run it

**1. Start the backend on the computer** (repo root):

```bash
npm run dev:phone
```

It prints the LAN URL it is listening on, e.g. `http://192.168.1.24:3000`. Keep that terminal open.

**2. Start the app:**

```bash
cd mobile
npm install          # first time only
npx expo start
```

**3. On the Android phone:** open **Expo Go** and scan the QR in the terminal (or type the `exp://192.168.x.x:8081`
URL). The phone and the computer must be on the same Wi-Fi.

The app discovers the API automatically: it takes the Metro host (`192.168.1.24`) and uses port `3000`, which is
exactly where `npm run dev:phone` listens.

If that guess is wrong — different machine, tunnel, or a laptop with several adapters — open **Settings (gear icon) →
Wallet service address**, type `http://192.168.1.24:3000`, and hit Save.

**Sanity check without a phone** (proves the app's sensor derivation matches the server):

```bash
cd mobile
npm run verify:backend            # defaults to http://localhost:3000
```

It mints a request, derives a capture with the same code the app uses, and pays it. Expect
`✓ settled — … match score 98.xx%`. If that fails, the problem is the backend URL, not the app.

## Flow to try

1. Sign in: any number (or tap "Use 677 12 34 56") → code **123456**.
2. Home shows the seeded balance and any open counter requests.
3. Tap **Tap to pay** → **hold the yellow pad** → confirm with your fingerprint on the system prompt. The payment is
   authorised on the server and the receipt shows the match score and risk score.
4. **Cross-device:** on the computer open `http://localhost:3000/merchant`, pick a merchant, enter an amount, hit
   *Generate QR request*. In the app go to **Scan**, point the camera at it — the payment sheet opens for that exact
   request. Pay, and the terminal flips to **PAID** within a few seconds.
5. Step-up: pay more than the step-up threshold (default 50 000 FCFA) and the app asks for the MoMo PIN — **2580**.
6. Settings → **Lock app and sign out** replays the sign-in flow.

## Paying people and bills

`Scan` has three modes:

- **Scan** — camera reads shop QR codes and other people's personal codes (`/scan?to=…`), plus any open request.
- **People** — search by name or phone number, *Find from contacts* (address book → `POST /api/directory`), and
  **Your code**: a QR of your own link that anyone can scan to send you money.
- **Bills** — the same directory's services: ENEO, Camwater, airtime, Canal+, supermarkets, school fees, hospital.

Choosing a payee opens an amount composer; continuing mints a signed request and drops into the normal pay sheet,
where you pick the funding wallet (**Pay with**: MTN MoMo / Orange Money / Express Union) before holding the sensor.
Same biometrics, same fraud engine, same receipt — one path for every payment type.

## Wallets, recipients and business enrolment

- **Wallet screen** (tap *Wallets* on the balance card, or the third quick action) lists every linked provider account,
  shows the default, and lets you **make another wallet the default**. It also links a new account: pick MTN MoMo, Orange
  Money or Express Union, type the number, and it appears on the pay sheet. Sandbox accounts start with a 20 000 FCFA float.
- **Activity** rows open a payment detail sheet: recipient, payee code, wallet, channel, biometric match, risk decision,
  and **Pay again** for the same amount. *Export* shares a CSV of your payments through the OS share sheet (there is no
  file-system write, so it works in Expo Go); *Share* on a receipt sends a text receipt.
- **List my business** (Wallet screen) opens the web enrolment page in the browser; the listing then shows up in the app's
  *Bills* tab, payable with a fingerprint. Enrollment itself stays web-side because it is a one-off onboarding form.

## Reasons for payment

Pick a school, clinic or utility in **Bills** and the composer shows its reasons as chips — *School fees*, *Library books*,
*Exam fees*… Choosing one that asks who the payment is for reveals a **Student name** field. The reason travels with the
signed request onto the receipt and into the school's terminal, so fees can be reconciled per student. Businesses edit
their list in the web terminal (*Payment reasons*); the phone always reads the current list from the directory.

## Business side

Settings → **Open the business portal** opens `/business` in the browser: a payee signs in with its code and 4-digit PIN and
sees only its own payments — grouped by reason, class, faculty, department or year, with a CSV export. That is deliberate:
the phone is the customer's wallet, the browser is the business's ledger. Editing reasons lives there too.

## Notes and limits

- **A physical device is required** for meaningful testing: simulators have no camera and only fake biometrics.
  If no fingerprint/face is enrolled, the app says so and continues with the simulated sensor so the demo still works.
- **Expo Go only.** Every module used here is part of Expo Go. Biometric-gated secure storage
  (`expo-secure-store` with `requireAuthentication`) and native builds would need a development build.
- **Cleartext HTTP** is fine in Expo Go for LAN development. A production build needs HTTPS.
- Production hardening would move the voucher signing key into Android Keystore behind a biometric prompt, so the
  private key can never be exported — the current demo signs server-side.

## Layout

```
mobile/
  App.tsx              tabs, header, modals
  src/state.tsx        API session, polling, biometric prompt, pay()
  src/PaySheet.tsx     hold-to-pay, step-up PIN, result
  src/screens/         SignIn · Home · Scan · Activity · Settings
  src/lib/api.ts       base-URL discovery (Metro host → :3000) + fetch wrapper
  src/lib/sensor.ts    capture vectors (same derivation as the web client)
  src/lib/sha256.ts    dependency-free SHA-256
  src/ui.tsx           theme + icons (react-native-svg)
```
