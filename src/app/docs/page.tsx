import Link from "next/link";
import { Icon } from "@/components/icons";

export const metadata = {
  title: "Architecture — Scan to Pay",
};

const API_ROWS: [string, string, string][] = [
  ["GET /api/state", "Wallet bootstrap", "Profile, wallets, history, queue, alerts, network profile, computed stats."],
  ["POST /api/pay", "Authorise", "Biometric sample + liveness telemetry + device id; returns settled / queued / challenged / declined with the risk assessment."],
  ["POST /api/biometric", "Enrol / verify / PIN", "Seals a 128-dim template, tests a capture, rotates the step-up PIN, clears lockouts."],
  ["POST /api/merchant", "Mint request", "Creates an HMAC-signed payment request (the QR payload)."],
  ["POST /api/sync", "Settle", "Flushes signed vouchers through signature, counter and cap checks; `{replay:true}` runs the double-spend drill."],
  ["POST /api/network", "Radio profile", "Switches the simulated transport tier that drives batching, gzip and offline signing."],
  ["POST /api/fraud", "Scenarios", "Dry-runs any of six attack patterns through the live engine."],
  ["PATCH /api/fraud", "Alert review", "Resolve or dismiss an alert (the label feeds weight tuning)."],
  ["POST /api/settings", "Policy", "Step-up threshold, offline caps, liveness, SMS fallback."],
  ["POST /api/devices", "Trust", "Trust or revoke a paired device; revocation invalidates its vouchers."],
  ["GET /api/export", "Ledger", "CSV of the full transaction history with risk + auth metadata; `?type=recipients` aggregates who you paid."],
  ["GET|POST /api/directory", "Payees", "Search people, billers and shops (masked numbers), or match phone contacts against registered numbers."],
  ["POST /api/wallets", "Payment options", "Choose the default funding wallet, or link another provider account."],
  ["GET|POST /api/enroll", "Onboarding", "A business lists itself as a payee; it becomes payable in-app immediately, pending verification."],
  ["GET|POST /api/reasons", "Reasons", "The reason catalogue a payee publishes (school fees, library books…), including which reasons ask for a student name."],
];

export default function DocsPage() {
  return (
    <div className="docs">
      <Link href="/" className="chip" style={{ marginBottom: 20 }}>
        <Icon name="chevron-left" size={13} />
        Back to the app
      </Link>

      <div className="up" style={{ marginBottom: 10 }}>System design · case study</div>
      <h1>
        Biometric one-tap payments for African mobile money.
        <br />
        <span style={{ color: "var(--accent)" }}>MTN MoMo Cameroon</span> as the reference integration.
      </h1>
      <p className="lead">
        Apple Pay and Samsung Pay made card payments feel like a single touch. Mobile money — used daily by millions in
        Cameroon — still asks for a PIN, a menu tree and often a network round trip. This is the rail that closes that gap:
        a fingerprint or face authorises the wallet, a signed voucher survives dead zones, and an explainable risk engine
        sits between the fingertip and the money.
      </p>

      <div className="callout">
        <p>
          <strong>What this repository actually runs.</strong> Everything below is executable. The biometric sensor is
          simulated (a browser-generated embedding standing in for the OEM matcher), but the matching thresholds, liveness
          checks, Ed25519 voucher signing, replay protection, settlement caps, fraud scoring and sync ladder are real code
          you can exercise from the UI and the API.
        </p>
      </div>

      <h2 id="problem">1. The problem, precisely</h2>
      <p>
        Three constraints shape every design decision:
      </p>
      <ul>
        <li>
          <strong>Authentication friction.</strong> A MoMo payment needs a USSD/menu flow or a PIN every time. That is fine
          at a supermarket, painful at a taxi window or a market stall with a queue behind you.
        </li>
        <li>
          <strong>Connectivity is intermittent.</strong> Douala and Yaoundé have good 4G; markets in Bafoussam, Buea or
          Garoua often drop to EDGE or nothing. A payment rail that requires a live operator round trip simply loses those
          transactions.
        </li>
        <li>
          <strong>Fraud is real and mobile.</strong> SIM swaps, stolen handsets, social-engineering at agent kiosks and
          collusive merchants are the common patterns. A pure biometric lock helps, but a cloned credential or coerced
          finger needs a second, contextual layer.
        </li>
      </ul>

      <h2 id="architecture">2. Architecture</h2>
      <div className="arch-grid">
        <div className="arch-node">
          <div className="an-k">Client</div>
          <div className="an-t">Wallet app</div>
          <div className="an-d">Phone UI, biometric enrolment, press-and-hold capture, offline queue, receipts.</div>
        </div>
        <div className="arch-node">
          <div className="an-k">Device</div>
          <div className="an-t">Secure element</div>
          <div className="an-d">Holds the Ed25519 voucher key and the matcher. Never exports private material.</div>
        </div>
        <div className="arch-node">
          <div className="an-k">Server</div>
          <div className="an-t">Authorisation core</div>
          <div className="an-d">Sealed templates, risk engine, settlement, caps, audit trail, provider adapters.</div>
        </div>
        <div className="arch-node">
          <div className="an-k">Settlement</div>
          <div className="an-t">Voucher reconciliator</div>
          <div className="an-d">Verifies signatures and counters, clears batches, rejects replays and double-spends.</div>
        </div>
        <div className="arch-node">
          <div className="an-k">Operator</div>
          <div className="an-t">MTN MoMo API</div>
          <div className="an-d">requestToPay, idempotent by X-Reference-Id, status poll, reversal.</div>
        </div>
        <div className="arch-node">
          <div className="an-k">Fallback</div>
          <div className="an-t">SMS / USSD</div>
          <div className="an-d">160-char authenticated token relayed by the SMSC when data is gone.</div>
        </div>
      </div>
      <p>
        The layering is deliberate: biometrics, risk and offline settlement are operator-independent. Adding Orange Money
        or Express Union is a new adapter plus a wallet row — not a new payments stack. The demo ships all three wallets to
        make that concrete.
      </p>

      <h2 id="auth">3. Enrolment and authorisation</h2>
      <h3>Enrolment (once per finger)</h3>
      <ol>
        <li>The OEM sensor extracts a 128-dimensional embedding. The raw ridge image never leaves the sensor.</li>
        <li>
          The template is sealed with AES-256-GCM under a master KEK, with the account and finger id as additional
          authenticated data — a sealed blob cannot be lifted and replayed against another finger.
        </li>
        <li>The device generates an Ed25519 key pair in the secure element; only the public half is registered.</li>
        <li>Both events are written to the append-only audit trail with actor, timestamp and template hash.</li>
      </ol>

      <h3>Authorisation (one deliberate hold)</h3>
      <ol>
        <li>
          The merchant QR carries <code>{`{id, merchantId, amountXAF, nonce, exp}`}</code> signed with the acquirer HMAC.
          The phone verifies it before opening the sensor, so the amount cannot be changed in transit.
        </li>
        <li>
          Press and hold for ~900 ms. The pad reports hold duration, micro-motion and contact depth; the matcher rejects
          static ridge patterns (photo-of-print) even when the embedding itself matches.
        </li>
        <li>
          Cosine similarity against the sealed template. Threshold <code>0.86</code>; scores between 0.86 and 0.90 pass but
          force a step-up. Five failures lock the matcher for five minutes.
        </li>
        <li>
          The risk engine scores the context. Low risk settles instantly; elevated risk asks for the PIN; critical risk is
          blocked and an alert is written before any money moves.
        </li>
        <li>
          On success the operator adapter charges with an idempotency key equal to the transaction id — a retry can never
          double-debit.
        </li>
      </ol>
      <p className="muted small">
        Score drift matters: the customer&apos;s rolling mean match score is tracked, and a genuine-looking capture that is
        consistently weaker than their baseline raises a <code>BIOMETRIC_DRIFT</code> signal.
      </p>

      <h2 id="offline">4. Offline: signed vouchers, bounded exposure</h2>
      <p>
        When there is no data, the device authorises locally and signs an <strong>Ed25519 payment voucher</strong>:
      </p>
      <pre>
        <code>{`voucher = {
  v: 1, txnId, userId, deviceId,
  counter,            // strictly monotonic per device
  amountXAF, currency: "XAF",
  merchantId, merchantRef,
  issuedAt, expiresAt, // 72h settlement window
  channel: "offline-qr" | "offline-sms",
  authScore, livenessPassed, riskScore,
  signature           // over the canonical payload
}
smsToken = "BSP1.<counter>.<amount>.<merchant>. <ts36>.<hmac16>"`}</code>
      </pre>
      <p>On reconnect, the batch is uploaded and each voucher must satisfy every one of these invariants:</p>
      <ul>
        <li>Signature verifies against the <em>currently trusted</em> device key (revocation is immediate).</li>
        <li>Counter is unseen, and not more than 64 ahead of the device window (replay + re-signing protection).</li>
        <li>Amount is below the per-payment cap and the remaining daily allowance.</li>
        <li>Voucher has not expired, merchant exists, and the wallet can cover the debit at settlement time.</li>
      </ul>
      <p>
        Liability is the point of the caps: an offline voucher is a guaranteed instrument up to the customer&apos;s
        allowance, so the issuer&apos;s maximum exposure per device is <code>dailyCap</code>. That is why the caps, the
        counter and the risk score travel inside the signed payload — the eventual settlement decision can be reconstructed
        even if the device never comes back online.
      </p>
      <h3>SMS / USSD fallback</h3>
      <p>
        When even the data channel is gone, a 160-character frame carries a truncated HMAC (8 bytes) instead of a full
        signature. This is a deliberate availability-over-strength trade-off: it is only accepted below 10 000 FCFA,
        once per counter, and it is marked as <code>offline-sms</code> in the ledger so post-settlement review knows it
        travelled at reduced assurance.
      </p>
      <div className="callout">
        <p>
          Try it: switch the radio to <strong>No data</strong>, pay twice, then flip back to 3G and press <em>Settle</em>.
          Then press <em>Replay drill</em> — the settlement server rejects the re-submitted voucher on counter reuse.
        </p>
      </div>

      <h2 id="fraud">5. Fraud detection</h2>
      <p>
        The engine is additive and explainable by design. Every block must be defensible to the customer, the operator and
        the regulator, so each signal carries the evidence that produced it. Correlated signals are capped per family
        (amount, velocity, geo, device, biometric, behaviour, merchant, network) so three amount signals describing the same
        fact cannot manufacture a block.
      </p>
      <table>
        <thead>
          <tr>
            <th>Family</th>
            <th>Signals</th>
            <th>Cap</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Amount</td>
            <td>z-score vs 90-day ticket, above 8× average, above category ceiling</td>
            <td>42</td>
          </tr>
          <tr>
            <td>Velocity</td>
            <td>3+ in 10 min, 5+ in 10 min, 8+ in an hour, repeated identical amounts (structuring)</td>
            <td>42</td>
          </tr>
          <tr>
            <td>Geo</td>
            <td>Impossible travel (&gt;900 km/h), out-of-area within 6h, far from home city</td>
            <td>58</td>
          </tr>
          <tr>
            <td>Device</td>
            <td>Unrecognised device, revoked key, new pairing</td>
            <td>27</td>
          </tr>
          <tr>
            <td>Biometric</td>
            <td>Liveness failure, weak match, drift below personal baseline</td>
            <td>55</td>
          </tr>
          <tr>
            <td>Merchant</td>
            <td>Flagged acquirer file, high/medium risk score, first-time merchant</td>
            <td>45</td>
          </tr>
          <tr>
            <td>Network</td>
            <td>Offline authorisation, above offline cap, daily cap reached, SMS fallback</td>
            <td>60</td>
          </tr>
        </tbody>
      </table>
      <p>
        Score below <code>30</code> releases immediately, <code>30–64</code> requires the PIN, <code>65+</code> blocks. A
        policy layer sits on top: any amount above the customer&apos;s step-up threshold asks for the PIN regardless of
        score. Feedback from alert review (was it really the customer?) is the label source for re-fitting the weights.
      </p>

      <h2 id="network">6. Low-connectivity ladder</h2>
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Batch</th>
            <th>Transport</th>
            <th>Behaviour</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>4G / 5G</td>
            <td>50</td>
            <td>full</td>
            <td>Realtime authorisation, receipts stream immediately.</td>
          </tr>
          <tr>
            <td>3G</td>
            <td>20</td>
            <td>gzip delta</td>
            <td>Only new transactions and risk counters travel.</td>
          </tr>
          <tr>
            <td>EDGE / 2G</td>
            <td>5</td>
            <td>gzip delta, 12s timeout</td>
            <td>Micro-batches with exponential backoff; vouchers queue.</td>
          </tr>
          <tr>
            <td>No data</td>
            <td>1</td>
            <td>SMS / USSD</td>
            <td>Signed vouchers settle later; 160-char token for low-value.</td>
          </tr>
        </tbody>
      </table>

      <h2 id="cloud">7. Cloud-synced history</h2>
      <p>
        Receipts are written locally first, then mirrored to an encrypted personal vault keyed per user. The dashboard
        computes spend windows, category mix, merchant concentration, offline share and risk trend from the same ledger the
        settlement server uses — so what the customer sees and what the operator reconciles cannot drift apart. CSV export is
        available because financial management should not be a lock-in.
      </p>

      <h2 id="mtn">8. MTN MoMo integration mapping</h2>
      <p>
        The adapter boundary is the MoMo Open API shape. Swapping the sandbox for production means replacing one function:
      </p>
      <pre>
        <code>{`// src/lib/providers.ts
async charge({ msisdn, amountXAF, reference, idempotencyKey }) {
  // POST https://proxy.momoapi.mtn.com/collection/v1_0/requesttopay
  // headers: X-Reference-Id: idempotencyKey  (idempotency + exactly-once retry)
  // body:    { amount, currency: "XAF", externalId: reference,
  //            payer: { partyIdType: "MSISDN", partyId: msisdn } }
  // then poll GET /requesttopay/{referenceId} until SUCCESSFUL / FAILED
}`}</code>
      </pre>
      <ul>
        <li><strong>Idempotency:</strong> reference id equals our transaction id, so an ambiguous timeout can be retried safely.</li>
        <li><strong>Reconciliation:</strong> the settlement worker replays any voucher whose operator status is unknown before marking it settled.</li>
        <li><strong>Reversal:</strong> a confirmed fraud case after settlement uses the compensation path; the ledger keeps both entries.</li>
        <li><strong>Fees:</strong> merchant-side, 1.5%, waived on offline settlement to encourage adoption in low-data areas.</li>
      </ul>

      <h2 id="security">9. Security and privacy</h2>
      <ul>
        <li>Templates are sealed with AES-256-GCM + AAD binding; raw biometrics are never stored or transmitted.</li>
        <li>Voucher signatures use Ed25519; private keys live in the simulated secure element and are never returned by an API.</li>
        <li>PINs use scrypt with a per-user salt and constant-time verification.</li>
        <li>Step-up, lockout, device revocation and cap changes are all audited with actor attribution.</li>
        <li>No card numbers, CVVs or account numbers exist anywhere in the system — mobile money has no PAN to leak.</li>
        <li>The ledger is append-only in spirit: declines, reversals and receipts are separate rows, never silent edits.</li>
      </ul>

      <h2 id="api">10. API surface</h2>
      <table>
        <thead>
          <tr>
            <th>Route</th>
            <th>Purpose</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {API_ROWS.map(([route, purpose, note]) => (
            <tr key={route}>
              <td><code>{route}</code></td>
              <td>{purpose}</td>
              <td>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 id="reality">11. Simulated vs production</h2>
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th>Here</th>
            <th>Production</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Sensor</td>
            <td>Web Crypto embedding generator</td>
            <td>Android BiometricPrompt / iOS LocalAuthentication</td>
          </tr>
          <tr>
            <td>Matcher</td>
            <td>Server-side cosine similarity</td>
            <td>TEE / StrongBox matcher returning a signed assertion</td>
          </tr>
          <tr>
            <td>Voucher key</td>
            <td>Server-held keystore, Ed25519</td>
            <td>Secure element, hardware-bound, attestation-backed</td>
          </tr>
          <tr>
            <td>Operator</td>
            <td>In-process MoMo sandbox adapter</td>
            <td>MoMo Open API with API user + subscription key + mTLS</td>
          </tr>
          <tr>
            <td>SMS fallback</td>
            <td>Token generated and parsed locally</td>
            <td>SMSC shortcode + USSD gateway with operator billing</td>
          </tr>
          <tr>
            <td>Store</td>
            <td>Atomic JSON file</td>
            <td>PostgreSQL with row-level security + object storage audit log</td>
          </tr>
        </tbody>
      </table>

      <h2 id="limits">12. Limitations and next steps</h2>
      <ul>
        <li>
          <strong>Biometric bias.</strong> Manual labour and age affect fingerprint quality; thresholds must be tuned per
          cohort, and enrolment should always retain a PIN fallback path under BEAC consumer-protection rules.
        </li>
        <li>
          <strong>Offline fraud liability.</strong> The cap bounds exposure but not behaviour. A stolen unlocked phone can
          spend the allowance before revocation propagates; merchant-side velocity limits on vouchers are the next control.
        </li>
        <li>
          <strong>USSD economics.</strong> Session-based USSD costs money per session and is slow. Real deployment should
          prefer flash SMS or a data-less push through the operator before USSD.
        </li>
        <li>
          <strong>Certification.</strong> A live launch needs operator approval, PCI-adjacent controls where card top-ups
          are involved, and COBAC/BEAC e-money reporting for offline float.
        </li>
        <li>
          <strong>Model risk.</strong> Additive rules are auditable but rigid; a gradient-boosted challenger model can
          shadow-run against the rules, with the rules retained as a floor.
        </li>
      </ul>

      <h2 id="demo">13. Five-minute demo script</h2>
      <ol>
        <li>Home → hold the sensor on <em>Tap to pay</em>: settles instantly, risk shown in the receipt.</li>
        <li>Security → run <em>Impossible travel</em> and <em>Stolen device</em>: the engine blocks with reasons.</li>
        <li>In the pay sheet, toggle <em>Impostor</em> and <em>Spoof</em>: the matcher and liveness both refuse.</li>
        <li>Set the radio to <em>No data</em>, pay twice, then settle from the console and run the replay drill.</li>
        <li>Activity → filter offline, compare 7/30/90 days, export the CSV.</li>
        <li>Merchant terminal → generate a QR for a new amount, then pay it from the app.</li>
      </ol>

      <div className="hairline" style={{ margin: "36px 0 18px" }} />
      <div className="row-between small muted">
        <span>Biometric Scan-to-Pay · MTN MoMo Cameroon case study</span>
        <Link href="/" style={{ color: "var(--accent)" }}>
          Open the app →
        </Link>
      </div>
    </div>
  );
}
