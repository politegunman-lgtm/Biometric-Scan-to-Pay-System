import React, { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { defaultBase } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useApp } from "../state";
import { Badge, Button, Card, colors, Divider, Icon } from "../ui";

export function Settings({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { base, saveBase, signOut, state, refresh } = useApp();
  const [draft, setDraft] = useState(base);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { height: windowHeight } = useWindowDimensions();
  const sheetScroll = useRef<React.ComponentRef<typeof ScrollView> | null>(null);

  useEffect(() => setDraft(base), [base, visible]);

  // Same story as the payment sheet: an Android modal has its own window, so
  // the keyboard is measured here and the sheet is lifted by its height.
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const revealFields = () => setTimeout(() => sheetScroll.current?.scrollToEnd({ animated: true }), 180);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ width: "100%" }}>
        <View
          style={[
            styles.sheet,
            { maxHeight: Math.max(280, windowHeight - keyboardHeight - 56) },
            Platform.OS === "android" && keyboardHeight > 0 ? { marginBottom: keyboardHeight } : null,
          ]}
        >
          <View style={styles.grabber} />
          <ScrollView
            ref={sheetScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 20 }}
          >
            <Text style={styles.title}>Settings</Text>

            <Text style={styles.label}>ACCOUNT</Text>
            <Card>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.value}>{state?.user.fullName ?? "Signed in"}</Text>
                  <Text style={styles.hint}>{state?.user.phone ?? "Loading account…"}</Text>
                </View>
                <Badge label="signed in" tone="ok" />
              </View>
              <Button
                label="Sign out &amp; use another number"
                variant="soft"
                icon="lock"
                onPress={() => {
                  onClose();
                  void signOut();
                }}
                style={{ marginTop: 10 }}
              />
              <Text style={styles.hint}>
                Signing out returns to the code screen. Payments still need the fingerprint afterwards.
              </Text>
            </Card>

            <View style={{ height: 18 }} />
            <Text style={styles.label}>BUSINESS</Text>
            <Card>
              <Text style={styles.hint}>
                Run a shop, school or utility? The business portal shows only that payee&rsquo;s records: every payment,
                grouped by reason, class, faculty, department or year, with a CSV export.
              </Text>
              <Button
                label="Open the business portal"
                variant="soft"
                icon="store"
                onPress={() => void Linking.openURL(`${base.replace(/\/$/, "")}/business`)}
                style={{ marginTop: 10 }}
              />
              <Text style={styles.hint}>
                Sign in with the code issued when the business enrolled and the 4-digit PIN it chose.
              </Text>
            </Card>

            <Text style={styles.label}>WALLET SERVICE ADDRESS</Text>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={defaultBase()}
              placeholderTextColor={colors.muted}
              keyboardType="url"
              onFocus={revealFields}
            />
            <Text style={styles.hint}>
              Defaults to the computer running Metro, port 3000. Change it if the API lives elsewhere on the network.
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
              <Button label="Save" onPress={() => void saveBase(draft)} style={{ flex: 1 }} />
              <Button
                label="Reset"
                variant="ghost"
                onPress={() => {
                  setDraft("");
                  void saveBase(null);
                }}
                style={{ flex: 1 }}
              />
            </View>

            <View style={{ marginTop: 18 }}>
              <Card>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Connection</Text>
                  <Badge label={state ? "reachable" : "offline"} tone={state ? "ok" : "danger"} />
                </View>
                <Divider style={{ marginVertical: 10 }} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Vault last sync</Text>
                  <Text style={styles.rowValue}>{relativeTime(state?.vault.lastSyncAt)}</Text>
                </View>
                <Divider style={{ marginVertical: 10 }} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Fingers enrolled</Text>
                  <Text style={styles.rowValue}>{state?.biometric.fingers.length ?? 0}</Text>
                </View>
                <Divider style={{ marginVertical: 10 }} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Device</Text>
                  <Text style={styles.rowValue}>{state?.devices.find((d) => d.trusted)?.label ?? "unknown"}</Text>
                </View>
              </Card>
            </View>

            <Button label="Refresh wallet" variant="soft" icon="cloud" onPress={() => void refresh()} style={{ marginTop: 14 }} />
            <Button label="Lock app and sign out" variant="danger" icon="lock" onPress={() => void signOut()} style={{ marginTop: 8 }} />

            <View style={styles.about}>
              <Icon name="shield" size={13} color={colors.muted} />
              <Text style={styles.aboutText}>
                Scan to Pay · demo build. The OS prompt is real biometry; templates and vouchers are simulated by the
                demo wallet service.
              </Text>
            </View>
          </ScrollView>
      </View>
        </KeyboardAvoidingView>
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
    maxHeight: "86%",
  },
  grabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: 16 },
  title: { color: colors.text, fontSize: 19, fontWeight: "700", marginBottom: 16 },
  label: { color: colors.muted, fontSize: 10, letterSpacing: 1.1, marginBottom: 7 },
  input: {
    height: 50,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: "rgba(255,255,255,0.04)",
    color: colors.text,
    paddingHorizontal: 14,
    fontSize: 13.5,
  },
  hint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  value: { color: colors.text, fontSize: 13, fontWeight: "600" },
  rowLabel: { color: colors.textDim, fontSize: 12.5 },
  rowValue: { color: colors.text, fontSize: 12.5 },
  about: { flexDirection: "row", gap: 8, marginTop: 18 },
  aboutText: { color: colors.muted, fontSize: 10.5, lineHeight: 15, flex: 1 },
});
