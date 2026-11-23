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
