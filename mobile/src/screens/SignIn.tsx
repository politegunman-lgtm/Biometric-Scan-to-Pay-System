import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useApp } from "../state";
import { Button, colors } from "../ui";

const DEMO_CODE = "123456";

/**
 * Sign-in for the same reason as the web app: the OTP proves who holds the
 * account and binds this handset to it; the fingerprint authorises each payment.
 * Kept to two taps once the device is trusted (session stored locally).
 */
export function SignIn() {
  const { signIn, state, base } = useApp();
  const [step, setStep] = useState<"number" | "code">("number");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const accountNumber = (state?.wallets[0]?.msisdn ?? "677 12 34 56").replace(/[^\d ]/g, "");
  const valid = phone.replace(/\D/g, "").length >= 8;

  const send = () => {
    if (!valid) return;
    setSending(true);
    setTimeout(() => {
      setSending(false);
      setStep("code");
      setError(null);
    }, 600);
  };

  const onChangeCode = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) {
      if (digits === DEMO_CODE) void signIn();
      else {
        setError("That code is not right. The demo code is 123456.");
        setCode("");
      }
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.mark}>
          <Text style={styles.markGlyph}>◉</Text>
        </View>
        <Text style={styles.brand}>
          Scan<Text style={{ color: colors.brand }}>to</Text>Pay
        </Text>
        <Text style={styles.sub}>MTN Mobile Money · Cameroon</Text>

        {step === "number" ? (
          <>
            <Text style={styles.title}>Sign in</Text>
            <Text style={styles.body}>
              Use the number your mobile money account is registered to. We send a one-time code — no password to
              remember.
            </Text>

            <Text style={styles.label}>MOBILE MONEY NUMBER</Text>
            <View style={styles.field}>
              <Text style={styles.prefix}>+237</Text>
              <TextInput
                style={styles.input}
                value={phone}
                onChangeText={(v) => setPhone(v.replace(/[^\d ]/g, "").slice(0, 12))}
                placeholder={accountNumber}
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                autoComplete="tel"
                returnKeyType="go"
                onSubmitEditing={send}
              />
            </View>

            <Button label={sending ? "Sending…" : "Send code"} onPress={send} disabled={!valid || sending} style={{ marginTop: 14 }} />
            <Pressable onPress={() => setPhone(accountNumber)} hitSlop={8}>
              <Text style={styles.link}>Use {accountNumber}</Text>
            </Pressable>

            <Text style={styles.footnote}>
              The code proves you hold the SIM. Your fingerprint is what authorises each payment — that second step never
              leaves this device.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.title}>Enter the code</Text>
            <Text style={styles.body}>
              Sent to +237 {phone || accountNumber}. Demo code: <Text style={{ color: colors.text }}>{DEMO_CODE}</Text>.
            </Text>

            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={onChangeCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              textContentType="oneTimeCode"
              placeholder="••••••"
              placeholderTextColor={colors.muted}
            />
            {error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.row}>
              <Pressable onPress={() => setStep("number")} hitSlop={8}>
                <Text style={styles.linkMuted}>Change number</Text>
              </Pressable>
              <Pressable onPress={() => onChangeCode(DEMO_CODE)} hitSlop={8}>
                <Text style={styles.link}>Use demo code</Text>
              </Pressable>
            </View>

            <Text style={styles.footnote}>Codes expire after 2 minutes and work once — same primitive MoMo already uses.</Text>
          </>
        )}

        <View style={{ flex: 1 }} />
        <Text style={styles.hint}>Connected to {base}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 24, paddingTop: 56 },
  mark: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand,
  },
  markGlyph: { color: colors.ink, fontSize: 26, fontWeight: "700" },
  brand: { color: colors.text, fontSize: 22, fontWeight: "700", textAlign: "center", marginTop: 14 },
  sub: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 4 },
  title: { color: colors.text, fontSize: 26, fontWeight: "700", marginTop: 34 },
  body: { color: colors.textDim, fontSize: 13.5, lineHeight: 20, marginTop: 8, marginBottom: 20 },
  label: { color: colors.muted, fontSize: 10, letterSpacing: 1.1, marginBottom: 8, marginLeft: 2 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 16,
  },
  prefix: { color: colors.textDim, fontSize: 14, marginRight: 14, paddingRight: 14, borderRightWidth: 1, borderRightColor: colors.line },
  input: { flex: 1, color: colors.text, fontSize: 17, letterSpacing: 0.5 },
  codeInput: {
    height: 62,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: "rgba(255,255,255,0.04)",
    color: colors.text,
    fontSize: 24,
    letterSpacing: 12,
    textAlign: "center",
  },
  error: { color: colors.coral, fontSize: 12, marginTop: 10 },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  link: { color: colors.brand, fontSize: 13, marginTop: 14 },
  linkMuted: { color: colors.textDim, fontSize: 13, marginTop: 14 },
  footnote: { color: colors.muted, fontSize: 11.5, lineHeight: 17, marginTop: 26 },
  hint: { color: colors.muted, fontSize: 10, textAlign: "center", marginTop: 24 },
});
