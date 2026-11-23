import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { money } from "./lib/format";
import type { PayOutcome, PayTarget } from "./lib/types";
import { useApp } from "./state";
import { Badge, Button, colors, Icon } from "./ui";

const HOLD_MS = 900;

type Stage = "review" | "verifying" | "challenge" | "result";

export function PaySheet({ target, onClose }: { target: PayTarget | null; onClose: () => void }) {
  const { authorize, promptBiometrics, state } = useApp();
  const [stage, setStage] = useState<Stage>("review");
  const [result, setResult] = useState<PayOutcome | null>(null);
  const [progress, setProgress] = useState(0);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fired = useRef(false);

  const reset = () => {
    setStage("review");
    setResult(null);
    setProgress(0);
    setPin("");
    setPinError(false);
    setStatusLine(null);
    fired.current = false;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.requestId, target?.merchantId, target?.amountXAF]);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  if (!target) return null;

  const run = async (opts?: { pin?: string }) => {
    setStage("verifying");
    setStatusLine(null);
    const started = Date.now();
    try {
      const bio = await promptBiometrics(`Pay ${money(target.amountXAF)} to ${target.merchantName}`);
      if (!bio.ok) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setResult({ status: "declined", message: bio.detail, errorCode: "biometric-failed" });
        setStage("result");
        return;
      }
      setStatusLine(bio.detail);
      const outcome = await authorize(target, {
        pin: opts?.pin,
        holdMs: Math.max(1000, Date.now() - started),
      });
      await Haptics.notificationAsync(
        outcome.status === "settled" || outcome.status === "queued"
          ? Haptics.NotificationFeedbackType.Success
          : Haptics.NotificationFeedbackType.Warning,
      );
      if (outcome.status === "challenged" || (outcome.status === "declined" && outcome.errorCode === "bad-pin")) {
        setResult(outcome);
        setPin("");
        setPinError(outcome.errorCode === "bad-pin");
        setStage("challenge");
        return;
      }
      setResult(outcome);
      setStage("result");
    } catch (err) {
      setResult({ status: "error", message: (err as Error).message });
      setStage("result");
    }
  };

  const startHold = () => {
    if (stage !== "review") return;
    fired.current = false;
    setProgress(0);
    const t0 = Date.now();
    timer.current = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / HOLD_MS);
      setProgress(p);
      if (p >= 1 && !fired.current) {
        fired.current = true;
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        void run();
      }
    }, 50);
  };

  const endHold = () => {
    if (fired.current) return;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setProgress(0);
  };

  const onPinKey = (key: string) => {
    if (key === "del") {
      setPin((p) => p.slice(0, -1));
      setPinError(false);
      return;
    }
    if (pin.length >= 4) return;
    const next = pin + key;
    setPin(next);
    setPinError(false);
    if (next.length === 4) setTimeout(() => void run({ pin: next }), 140);
  };

  const tone =
    result?.status === "settled" || result?.status === "queued"
      ? { label: result.status === "queued" ? "Signed offline" : "Paid", tone: result.status === "queued" ? "warn" : "ok", icon: "check" as const }
      : result?.status === "challenged"
        ? { label: "Extra check", tone: "warn" as const, icon: "shield" as const }
        : { label: "Declined", tone: "danger" as const, icon: "alert" as const };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={stage === "review" || stage === "result" ? onClose : undefined} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <ScrollView contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
            <View style={styles.merchant}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{target.merchantName.slice(0, 1)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>
                  {target.merchantName}
                </Text>
                <Text style={styles.meta}>{target.note ?? (target.requestId ? "Payment request" : "Counter payment")}</Text>
              </View>
              <Badge label={state?.network.online ? "online" : "offline"} tone={state?.network.online ? "ok" : "warn"} />
            </View>

            <Text style={styles.amount}>
              {money(target.amountXAF, { suffix: false })}
              <Text style={styles.amountCur}> FCFA</Text>
            </Text>

            {stage === "review" && (
              <>
                <Text style={styles.instruction}>Hold to authorise with your fingerprint</Text>
                <Pressable onPressIn={startHold} onPressOut={endHold} style={styles.hold}>
                  <View style={[styles.holdFill, { width: `${progress * 100}%` }]} />
                  <Icon name="fingerprint" size={30} color={colors.brand} />
                  <Text style={styles.holdLabel}>{progress > 0 ? "Keep holding…" : "Hold to pay"}</Text>
                </Pressable>
                <Text style={styles.hint}>
                  The device confirms it is you, then the wallet service scores the payment. Nothing leaves the sensor.
                </Text>
              </>
            )}

            {stage === "verifying" && (
              <View style={styles.center}>
                <Icon name="fingerprint" size={34} color={colors.brand} />
                <Text style={styles.verifying}>Checking with the device…</Text>
                <Text style={styles.hint}>{statusLine ?? "Confirm your identity on the system prompt."}</Text>
              </View>
            )}

            {stage === "challenge" && (
              <>
                <View style={styles.center}>
                  <Badge label={`risk ${result?.risk?.score ?? "—"}/100`} tone="warn" />
                  <Text style={styles.challengeTitle}>Confirm with your MoMo PIN</Text>
                  <Text style={styles.hint}>{result?.risk?.summary ?? "This payment needs a second factor."}</Text>
                </View>
                <View style={styles.dots}>
                  {[0, 1, 2, 3].map((i) => (
                    <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
                  ))}
                </View>
                {pinError && <Text style={styles.pinError}>Incorrect PIN — try again.</Text>}
                <View style={styles.keypad}>
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key, index) =>
                    key === "" ? (
                      <View key={`gap-${index}`} style={styles.key} />
                    ) : (
                      <TouchableOpacity key={key} style={styles.key} onPress={() => onPinKey(key)} activeOpacity={0.7}>
                        <Text style={styles.keyLabel}>{key === "del" ? "⌫" : key}</Text>
                      </TouchableOpacity>
                    ),
                  )}
                </View>
                <Text style={styles.hint}>Demo PIN 2580 — set on the wallet service.</Text>
              </>
            )}

            {stage === "result" && result && (
              <View style={styles.result}>
                <View style={[styles.resultIcon, { borderColor: `${tone.tone === "ok" ? colors.mint : tone.tone === "warn" ? colors.amber : colors.coral}55` }]}>
                  <Icon name={tone.icon} size={26} color={tone.tone === "ok" ? colors.mint : tone.tone === "warn" ? colors.amber : colors.coral} />
                </View>
                <Text style={styles.resultTitle}>{tone.label}</Text>
                <Text style={styles.hint}>{result.message}</Text>

                {!!result.biometric?.score && (
                  <Text style={styles.resultMeta}>
                    fingerprint {(result.biometric.score * 100).toFixed(1)}% · {result.biometric.fingerLabel}
                  </Text>
                )}
                {result.risk && (
                  <Text style={styles.resultMeta}>
                    risk {result.risk.score}/100 · {result.risk.summary}
                  </Text>
                )}
                {result.txn?.ref && <Text style={styles.resultMeta}>receipt {result.txn.ref}</Text>}

                <Button label="Done" onPress={onClose} style={{ marginTop: 18, alignSelf: "stretch" }} />
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.62)" },
  sheet: {
    backgroundColor: "#0C1015",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 26,
    maxHeight: "88%",
  },
  grabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: 16 },
  merchant: { flexDirection: "row", alignItems: "center", gap: 11 },
  avatar: { width: 38, height: 38, borderRadius: 12, backgroundColor: "rgba(255,203,5,0.14)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.brand, fontSize: 15, fontWeight: "700" },
  name: { color: colors.text, fontSize: 15, fontWeight: "600" },
  meta: { color: colors.muted, fontSize: 11.5, marginTop: 2 },
  amount: { color: colors.text, fontSize: 40, fontWeight: "700", textAlign: "center", marginTop: 20, letterSpacing: -1 },
  amountCur: { fontSize: 15, color: colors.textDim, fontWeight: "600" },
  instruction: { color: colors.textDim, fontSize: 12.5, textAlign: "center", marginTop: 6 },
  hold: {
    marginTop: 18,
    height: 92,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,203,5,0.35)",
    backgroundColor: "rgba(255,203,5,0.07)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    overflow: "hidden",
  },
  holdFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "rgba(255,203,5,0.18)" },
  holdLabel: { color: colors.brand, fontSize: 13, fontWeight: "600" },
  hint: { color: colors.muted, fontSize: 11.5, textAlign: "center", lineHeight: 17, marginTop: 12 },
  center: { alignItems: "center", marginTop: 12, gap: 6 },
  verifying: { color: colors.text, fontSize: 14, fontWeight: "600", marginTop: 8 },
  challengeTitle: { color: colors.text, fontSize: 15, fontWeight: "600", marginTop: 6 },
  dots: { flexDirection: "row", justifyContent: "center", gap: 12, marginTop: 18 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: colors.lineStrong },
  dotFilled: { backgroundColor: colors.brand, borderColor: colors.brand },
  pinError: { color: colors.coral, fontSize: 11.5, textAlign: "center", marginTop: 8 },
  keypad: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 10, marginTop: 14 },
  key: { width: "28%", height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)" },
  keyLabel: { color: colors.text, fontSize: 20, fontWeight: "500" },
  result: { alignItems: "center", marginTop: 8 },
  resultIcon: { width: 58, height: 58, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  resultTitle: { color: colors.text, fontSize: 19, fontWeight: "700" },
  resultMeta: { color: colors.muted, fontSize: 11, marginTop: 8, textAlign: "center", lineHeight: 16 },
});
