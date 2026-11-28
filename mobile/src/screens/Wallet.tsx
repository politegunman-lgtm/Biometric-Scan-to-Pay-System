import { useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { apiJson } from "../lib/api";
import { money } from "../lib/format";
import type { Wallet } from "../lib/types";
import { useApp } from "../state";
import { Badge, Button, Card, colors, Divider, Icon } from "../ui";

const PROVIDERS: { id: string; name: string; initial: string; accent: string }[] = [
  { id: "mtn-momo", name: "MTN Mobile Money", initial: "M", accent: "#FFCB05" },
  { id: "orange-money", name: "Orange Money", initial: "O", accent: "#FF7900" },
  { id: "express-union", name: "Express Union", initial: "E", accent: "#38BDF8" },
];

const initialOf = (provider: string) =>
  provider === "orange-money" ? "O" : provider === "express-union" ? "E" : "M";

export function WalletScreen({ onClose }: { onClose: () => void }) {
  const { state, refresh, base } = useApp();
  const [notice, setNotice] = useState<{ text: string; tone: "ok" | "danger" } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [provider, setProvider] = useState("mtn-momo");
  const [msisdn, setMsisdn] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  if (!state) return <View style={styles.fill} />;

  const makeDefault = async (wallet: Wallet) => {
    setBusyId(wallet.id);
    try {
      const res = await apiJson<{ message: string }>("/api/wallets", {
        method: "POST",
        body: JSON.stringify({ action: "primary", walletId: wallet.id }),
      });
      await refresh();
      setNotice({ text: res.message, tone: "ok" });
    } catch (err) {
      setNotice({ text: (err as Error).message, tone: "danger" });
    } finally {
      setBusyId(null);
    }
  };

  const link = async () => {
    setLinking(true);
    try {
      const res = await apiJson<{ message: string }>("/api/wallets", {
        method: "POST",
        body: JSON.stringify({ action: "link", provider, msisdn }),
      });
      await refresh();
      setNotice({ text: res.message, tone: "ok" });
      setMsisdn("");
      setFormOpen(false);
    } catch (err) {
      setNotice({ text: (err as Error).message, tone: "danger" });
    } finally {
      setLinking(false);
    }
  };

  return (
    <View style={styles.fill}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.back}>
          <Text style={styles.backGlyph}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Wallets</Text>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        <Text style={styles.lead}>
          The default wallet funds every payment unless you pick another one on the pay sheet.
        </Text>
        {notice && (
          <Text style={[styles.lead, { color: notice.tone === "ok" ? colors.mint : colors.coral }]}>{notice.text}</Text>
        )}

        {state.wallets.map((wallet) => (
          <Card key={wallet.id} style={{ ...styles.wallet, ...(wallet.primary ? styles.walletPrimary : null) }}>
            <View style={styles.row}>
              <View style={[styles.dot, { backgroundColor: wallet.accent }]}>
                <Text style={styles.dotText}>{initialOf(wallet.provider)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{wallet.providerName}</Text>
                <Text style={styles.sub}>{wallet.msisdn}</Text>
              </View>
              {wallet.primary ? <Badge label="default" tone="brand" /> : null}
              <Badge label={wallet.status ?? "active"} tone={(wallet.status ?? "active") === "active" ? "ok" : "danger"} />
            </View>

            <View style={[styles.row, { marginTop: 14, alignItems: "flex-end" }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.key}>BALANCE</Text>
                <Text style={styles.balance}>
                  {money(wallet.balanceXAF, { suffix: false })}
                  <Text style={styles.cur}> FCFA</Text>
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.tiny}>per txn {money(wallet.perTxnLimitXAF ?? 0, { suffix: false })}</Text>
                <Text style={styles.tiny}>offline float {money(wallet.offlineFloatXAF ?? 0, { suffix: false })}</Text>
              </View>
            </View>

            {!wallet.primary && (
              <Button
                label={busyId === wallet.id ? "Switching…" : "Make this my default"}
                variant="soft"
                loading={busyId === wallet.id}
                disabled={(wallet.status ?? "active") !== "active" || busyId !== null}
                onPress={() => void makeDefault(wallet)}
                style={{ marginTop: 12, minHeight: 42 }}
              />
            )}
          </Card>
        ))}

        <Card style={{ marginTop: 4 }}>
          <View style={styles.row}>
            <Icon name="wallet" size={17} color={colors.brand} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>Another mobile-money account</Text>
              <Text style={styles.sub}>
                Link a number and it appears on the pay sheet. Sandbox accounts start with a 20 000 FCFA float.
              </Text>
            </View>
          </View>

          {formOpen ? (
            <View style={{ marginTop: 14 }}>
              <View style={styles.providers}>
                {PROVIDERS.map((p) => {
                  const active = provider === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => setProvider(p.id)}
                      style={[styles.provider, active && styles.providerActive]}
                    >
                      <View style={[styles.providerDot, { backgroundColor: p.accent }]}>
                        <Text style={styles.dotText}>{p.initial}</Text>
                      </View>
                      <Text style={[styles.providerLabel, active && { color: colors.text }]} numberOfLines={1}>
                        {p.name.split(" ")[0]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                style={styles.input}
                value={msisdn}
                onChangeText={setMsisdn}
                placeholder="6 55 77 88 99"
                placeholderTextColor={colors.muted}
                keyboardType="phone-pad"
                inputMode="tel"
              />
              <View style={[styles.row, { marginTop: 10, gap: 8 }]}>
                <Button
                  label={linking ? "Linking…" : "Link wallet"}
                  loading={linking}
                  disabled={msisdn.replace(/\D/g, "").length < 8 || linking}
                  onPress={() => void link()}
                  style={{ flex: 1 }}
                />
                <Button label="Cancel" variant="ghost" onPress={() => setFormOpen(false)} style={{ flex: 1 }} />
              </View>
            </View>
          ) : (
            <Button
              label="Link an account"
              variant="soft"
              onPress={() => setFormOpen(true)}
              style={{ marginTop: 12, minHeight: 42 }}
            />
          )}
        </Card>

        <Card style={{ marginTop: 4 }}>
          <View style={styles.row}>
            <Icon name="store" size={17} color={colors.mint} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>Run a business?</Text>
              <Text style={styles.sub}>List it as a payee so customers can find you and pay in-app. Opens the enrolment page.</Text>
            </View>
          </View>
          <Button
            label="List my business"
            variant="ghost"
            onPress={() => void Linking.openURL(`${base.replace(/\/$/, "")}/join`)}
            style={{ marginTop: 12, minHeight: 42 }}
          />
        </Card>

        <Divider />
        <Text style={styles.foot}>
          Switching the default does not move money. Queued offline vouchers stay bound to the wallet that signed them and settle
          against it.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingVertical: 10 },
  back: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.05)" },
  backGlyph: { color: colors.textDim, fontSize: 22, lineHeight: 24, marginTop: -3 },
  title: { color: colors.text, fontSize: 16, fontWeight: "700" },
  scroll: { padding: 18, paddingTop: 4, paddingBottom: 40, gap: 10 },
  lead: { color: colors.muted, fontSize: 12, lineHeight: 17, marginBottom: 4 },
  wallet: { gap: 0 },
  walletPrimary: { borderColor: "rgba(255,203,5,0.3)", backgroundColor: "rgba(255,203,5,0.05)" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  dot: { width: 26, height: 26, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  dotText: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  name: { color: colors.text, fontSize: 13, fontWeight: "600" },
  sub: { color: colors.muted, fontSize: 11, marginTop: 3, lineHeight: 15 },
  key: { color: colors.muted, fontSize: 9, letterSpacing: 1 },
  balance: { color: colors.text, fontSize: 22, fontWeight: "700", marginTop: 2 },
  cur: { fontSize: 11, fontWeight: "600", color: colors.muted },
  tiny: { color: colors.muted, fontSize: 9.5, lineHeight: 14 },
  providers: { flexDirection: "row", gap: 8 },
  provider: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  providerActive: { borderColor: "rgba(255,203,5,0.5)", backgroundColor: "rgba(255,203,5,0.08)" },
  providerDot: { width: 20, height: 20, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  providerLabel: { color: colors.muted, fontSize: 10, fontWeight: "600" },
  input: {
    marginTop: 10,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.04)",
    color: colors.text,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  foot: { color: colors.muted, fontSize: 10.5, lineHeight: 15, marginTop: 8 },
});
