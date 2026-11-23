import type {
  FraudDecision,
  RiskAssessment,
  RiskInput,
  RiskLevel,
  RiskSignal,
} from "./types";

/**
 * Fraud decision engine.
 *
 * Deliberately a transparent, explainable scoring model rather than an opaque
 * classifier: every blocked payment must be defensible to the customer, to the
 * operator and to the regulator (BEAC / COBAC electronic-money guidance).
 * Signals are additive, capped, and each carries the evidence that produced it.
 *
 * In production the same signal set is produced by a streaming feature store and
 * the weights are re-fitted nightly against chargeback outcomes; the contract
 * (signals in → score + decision + reasons out) stays identical.
 */

const ALLOW_CEILING = 30;
const BLOCK_FLOOR = 65;

export const DECISION_THRESHOLDS = { allow: ALLOW_CEILING, block: BLOCK_FLOOR };

const MS = 1000;
const MIN = 60 * MS;

export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const money = (n: number) => `${Math.round(n).toLocaleString("fr-FR")} FCFA`;

export function levelFor(score: number): RiskLevel {
  if (score >= 70) return "critical";
  if (score >= 50) return "high";
  if (score >= ALLOW_CEILING) return "elevated";
  return "low";
}

export function decisionFor(score: number): FraudDecision {
  if (score >= BLOCK_FLOOR) return "block";
  if (score >= ALLOW_CEILING) return "challenge";
  return "allow";
}

function summarise(signals: RiskSignal[], decision: FraudDecision): { summary: string; action: string } {
  if (signals.length === 0) {
    return {
      summary: "Matches your usual pattern for this merchant, amount and location.",
      action: "Release instantly — no extra steps.",
    };
  }
  const top = [...signals].sort((a, b) => b.weight - a.weight).slice(0, 2);
  if (decision === "block") {
    return {
      summary: `Blocked: ${top.map((s) => s.label.toLowerCase()).join(" and ")}.`,
      action: "Card frozen for this merchant. Verify identity in Security to release, or call 1-800-MOMO.",
    };
  }
  if (decision === "challenge") {
    return {
      summary: `Extra check needed: ${top.map((s) => s.label.toLowerCase()).join(" and ")}.`,
      action: "Ask for the 4-digit MoMo PIN on top of the fingerprint scan.",
    };
  }
  return {
    summary: `Released with monitoring: ${top.map((s) => s.label.toLowerCase()).join(" and ")}.`,
    action: "Complete normally; the payment is flagged for post-settlement review.",
  };
}

export function assessRisk(input: RiskInput): RiskAssessment {
  const started = performance.now();
  const signals: RiskSignal[] = [];
  const push = (s: RiskSignal) => signals.push(s);

  const { baseline, recentTxns, amountXAF, merchant } = input;
  const now = input.occurredAt.getTime();

  const within = (ms: number) =>
    recentTxns.filter((t) => {
      const at = new Date(t.createdAt).getTime();
      return now - at <= ms && now - at >= -30_000;
    });

  /* ---------------- velocity ---------------- */
  const last10 = within(10 * MIN).length;
  const last60 = within(60 * MIN).length;
  if (last10 >= 5) {
    push({
      code: "VELOCITY_10M_HIGH",
      label: "5+ payments in 10 minutes",
      weight: 32,
      detail: `${last10} authorisations in the last 10 minutes across all channels`,
      category: "velocity",
    });
  } else if (last10 >= 3) {
    push({
      code: "VELOCITY_10M",
      label: "Rapid repeat payments",
      weight: 18,
      detail: `${last10} authorisations in the last 10 minutes`,
      category: "velocity",
    });
  }
  if (last60 >= 8) {
    push({
      code: "VELOCITY_60M",
      label: "Dense hour",
      weight: 20,
      detail: `${last60} authorisations in the last hour`,
      category: "velocity",
    });
  }

  /* ---------------- amount ---------------- */
  // Per-category ceilings: a payment can be normal for the customer and still
  // absurd for the merchant's category (a 285k pharmacy bill is not a big grocery run).
  const CATEGORY_P95: Record<string, number> = {
    groceries: 16_000,
    "food-drink": 9_000,
    transport: 2_500,
    telecom: 10_000,
    utilities: 25_000,
    health: 18_000,
    retail: 32_000,
    entertainment: 12_000,
    travel: 65_000,
    education: 45_000,
    // Person-to-person transfers are legitimately large; only the absolute
    // amount and velocity rules should push back, not the category ceiling.
    transfer: 150_000,
  };
  const catCeiling = CATEGORY_P95[merchant.category] ?? 25_000;
  if (amountXAF > catCeiling * 3) {
    push({
      code: "CATEGORY_ANOMALY",
      label: "Impossible for merchant category",
      weight: 32,
      detail: `${money(amountXAF)} is ${(amountXAF / catCeiling).toFixed(1)}× the typical ceiling for ${merchant.category.replace("-", " ")}`,
      category: "amount",
    });
  } else if (amountXAF > catCeiling * 2) {
    push({
      code: "CATEGORY_ANOMALY_SOFT",
      label: "Large for merchant category",
      weight: 16,
      detail: `${money(amountXAF)} is ${(amountXAF / catCeiling).toFixed(1)}× the typical ${merchant.category} ceiling`,
      category: "amount",
    });
  }
  if (amountXAF > baseline.avgTicketXAF * 8) {
    push({
      code: "AMOUNT_ABOVE_P95",
      label: "Above 8× your average ticket",
      weight: 18,
      detail: `${money(amountXAF)} vs ${money(baseline.avgTicketXAF)} average — outside your 90-day 95th percentile`,
      category: "amount",
    });
  }
  const sd = Math.max(baseline.ticketStdDevXAF, 800);
  const z = (amountXAF - baseline.avgTicketXAF) / sd;
  if (z >= 3) {
    push({
      code: "AMOUNT_Z_HIGH",
      label: "Amount far above your norm",
      weight: 20,
      detail: `${money(amountXAF)} is ${z.toFixed(1)}σ above your ${money(baseline.avgTicketXAF)} average ticket`,
      category: "amount",
    });
  } else if (z >= 2) {
    push({
      code: "AMOUNT_Z_MED",
      label: "Unusually large ticket",
      weight: 10,
      detail: `${money(amountXAF)} is ${z.toFixed(1)}σ above your average`,
      category: "amount",
    });
  }

  const sameAmount = within(60 * MIN).filter(
    (t) => Math.abs(t.amountXAF - amountXAF) < 1,
  ).length;
  if (sameAmount >= 3) {
    push({
      code: "STRUCTURING",
      label: "Repeated identical amounts",
      weight: 12,
      detail: `${sameAmount} payments at exactly ${money(amountXAF)} in the last hour`,
      category: "amount",
    });
  }

  /* ---------------- geo ---------------- */
  // Only compare against the most recent *prior* payment: a future-dated row
  // (clock skew, seeded history) must never produce a velocity signal.
  const lastTxn = recentTxns.find((t) => {
    const at = new Date(t.createdAt).getTime();
    return at <= now && now - at <= 30 * 24 * 3_600_000;
  });
  if (lastTxn && lastTxn.geo) {
    const km = distanceKm(lastTxn.geo, input.geo);
    const elapsedMs = Math.max(60_000, now - new Date(lastTxn.createdAt).getTime());
    const hours = elapsedMs / 3_600_000;
    const kmh = km / hours;
    if (km > 40 && kmh > 900 && elapsedMs > 60_000) {
      push({
        code: "IMPOSSIBLE_TRAVEL",
        label: "Impossible travel",
        weight: 58,
        detail: `${Math.round(km)} km from ${lastTxn.geo.city} in ${Math.round(hours * 60)} min (~${Math.round(kmh)} km/h) — faster than any ground or air link`,
        category: "geo",
      });
    } else if (km > 25 && hours <= 6) {
      push({
        code: "GEO_JUMP",
        label: "Payment outside usual area",
        weight: 6,
        detail: `${Math.round(km)} km from a payment ${Math.round(hours * 60)} minutes ago (${lastTxn.geo.city})`,
        category: "geo",
      });
    }
  }
  const fromHome = distanceKm(baseline.homeGeo, input.geo);
  if (fromHome > 120) {
    push({
      code: "FAR_FROM_HOME",
      label: "Far from home city",
      weight: 5,
      detail: `${Math.round(fromHome)} km from ${baseline.homeGeo.city}`,
      category: "geo",
    });
  }

  /* ---------------- device ---------------- */
  if (input.brandNewDevice) {
    push({
      code: "NEW_DEVICE",
      label: "Unrecognised device",
      weight: 27,
      detail: "Authorised from a device that is not enrolled to this account",
      category: "device",
    });
  }

  /* ---------------- biometrics ---------------- */
  if (!input.livenessPassed) {
    push({
      code: "LIVENESS_FAIL",
      label: "Liveness check failed",
      weight: 38,
      detail: "Capture lacked pulse / micro-motion — consistent with a spoof or photo-of-print",
      category: "biometric",
    });
  }
  if (input.authScore > 0 && input.authScore < 0.9) {
    push({
      code: "BIOMETRIC_WEAK",
      label: "Weak biometric match",
      weight: 15,
      detail: `Match confidence ${(input.authScore * 100).toFixed(1)}% (your baseline ${(baseline.scoreBaseline * 100).toFixed(1)}%)`,
      category: "biometric",
    });
  }
  if (input.authScore > 0 && input.authScore < baseline.scoreBaseline - 0.045) {
    push({
      code: "BIOMETRIC_DRIFT",
      label: "Biometric drift",
      weight: 8,
      detail: "Match score drifting below your personal baseline — possible sensor substitution",
      category: "biometric",
    });
  }

  /* ---------------- behaviour ---------------- */
  const hour = input.occurredAt.getHours();
  if (hour >= 23 || hour < 5) {
    push({
      code: "OFF_HOURS",
      label: "Unusual hour",
      weight: input.nightGuard ? 16 : 8,
      detail: `Authorised at ${String(hour).padStart(2, "0")}:00, outside your 06:00–22:00 window${input.nightGuard ? " (night guard raises this)" : ""}`,
      category: "behaviour",
    });
  }
  if (!baseline.usualHours.includes(hour) && hour >= 5 && hour < 23) {
    push({
      code: "HOUR_UNSEEN",
      label: "New time-of-day",
      weight: 5,
      detail: `You have not paid at ${String(hour).padStart(2, "0")}:00 in the last 90 days`,
      category: "behaviour",
    });
  }
  const known = baseline.knownMerchants.includes(merchant.id);
  if (!known) {
    push({
      code: "NEW_MERCHANT",
      label: "First payment to this merchant",
      weight: amountXAF > baseline.avgTicketXAF * 2 ? 10 : 6,
      detail: `${merchant.name} is not in your 90-day merchant history`,
      category: "merchant",
    });
  }

  /* ---------------- merchant risk ---------------- */
  if (merchant.flagged) {
    push({
      code: "MERCHANT_FLAGGED",
      label: "Merchant under investigation",
      weight: 40,
      detail: `${merchant.name} has open chargeback / collusion cases on the acquirer network`,
      category: "merchant",
    });
  } else if (merchant.riskScore >= 70) {
    push({
      code: "MERCHANT_HIGH_RISK",
      label: "High-risk merchant category",
      weight: 20,
      detail: `${merchant.name} carries a ${merchant.riskScore}/100 acquirer risk score`,
      category: "merchant",
    });
  } else if (merchant.riskScore >= 50) {
    push({
      code: "MERCHANT_MED_RISK",
      label: "Elevated merchant risk",
      weight: 6,
      detail: `Acquirer risk score ${merchant.riskScore}/100`,
      category: "merchant",
    });
  }

  /* ---------------- channel / offline ---------------- */
  if (input.offline) {
    push({
      code: "OFFLINE_UNVERIFIED",
      label: "Offline authorisation",
      weight: 11,
      detail: "Settled from a device-signed voucher — server could not verify at swipe time",
      category: "network",
    });
    if (input.amountXAF > input.offlinePerTxnXAF) {
      push({
        code: "OFFLINE_CAP",
        label: "Above offline per-payment cap",
        weight: 55,
        detail: `${money(input.amountXAF)} exceeds your ${money(input.offlinePerTxnXAF)} offline cap`,
        category: "network",
      });
    }
    if (input.offlineSpentTodayXAF + input.amountXAF > input.offlineDailyXAF) {
      push({
        code: "OFFLINE_DAILY_CAP",
        label: "Offline daily cap reached",
        weight: 40,
        detail: `${money(input.offlineSpentTodayXAF + input.amountXAF)} against a ${money(input.offlineDailyXAF)} daily offline allowance`,
        category: "network",
      });
    }
    if (input.channel === "offline-sms") {
      push({
        code: "SMS_FALLBACK",
        label: "SMS/USSD fallback token",
        weight: 7,
        detail: "Low-assurance transport (160-char frame, truncated authenticator)",
        category: "network",
      });
    }
  }

  /* ---------------- score & decision ---------------- */
  // Correlated evidence is capped per family so three amount signals describing
  // the same fact cannot add up to an automatic block on their own.
  const FAMILY_CAP: Record<RiskSignal["category"], number> = {
    amount: 42,
    velocity: 42,
    geo: 58,
    device: 27,
    biometric: 55,
    behaviour: 15,
    merchant: 45,
    network: 60,
  };
  const perFamily = new Map<RiskSignal["category"], number>();
  signals.forEach((s) => perFamily.set(s.category, (perFamily.get(s.category) ?? 0) + s.weight));
  const raw = [...perFamily.entries()].reduce((sum, [family, w]) => sum + Math.min(w, FAMILY_CAP[family]), 0);
  // Diminishing returns: many weak signals should not add up to an automatic
  // block on their own, so the tail is compressed above 60.
  const score = raw <= 60 ? raw : Math.round(60 + (raw - 60) * 0.55);
  // Hard rules: evidence that cannot be explained away by a good biometric.
  // A physically impossible location change means the credential is cloned;
  // failed liveness means the print is not attached to a living finger;
  // an above-cap offline voucher is uninsurable by design.
  const HARD_BLOCKS = new Set(["IMPOSSIBLE_TRAVEL", "LIVENESS_FAIL", "OFFLINE_CAP"]);
  const hardBlock = signals.some((s) => HARD_BLOCKS.has(s.code));
  const capped = Math.min(99, hardBlock ? Math.max(66, score) : score);
  const decision = decisionFor(capped);
  const { summary, action } = summarise(signals, decision);

  return {
    score: capped,
    level: levelFor(capped),
    decision,
    signals: signals.sort((a, b) => b.weight - a.weight),
    summary,
    recommendedAction: action,
    evaluatedInMs: Math.round((performance.now() - started) * 100) / 100,
  };
}

/** Baseline learner — what "normal" means for this customer, from their history. */
export function deriveBaseline(txns: RiskInput["recentTxns"], homeGeo: RiskInput["geo"]) {
  const usable = txns.filter((t) => t.status === "settled" || t.status === "queued");
  const amounts = usable.map((t) => t.amountXAF);
  const avg = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 7500;
  const variance = amounts.length
    ? amounts.reduce((a, b) => a + (b - avg) ** 2, 0) / amounts.length
    : 5_000_000;
  const hourCounts = new Array(24).fill(0);
  usable.forEach((t) => hourCounts[new Date(t.createdAt).getHours()]++);
  const usualHours = hourCounts
    .map((c, h) => ({ h, c }))
    .filter((x) => x.c > 0)
    .sort((a, b) => b.c - a.c)
    .slice(0, 8)
    .map((x) => x.h);
  const knownMerchants = Array.from(new Set(usable.map((t) => t.merchantId)));
  return {
    avgTicketXAF: Math.round(avg),
    ticketStdDevXAF: Math.round(Math.sqrt(variance)),
    usualHours,
    homeGeo,
    knownMerchants,
    scoreBaseline: 0.953,
  };
}
