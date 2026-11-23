import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { PaySheet } from "./src/PaySheet";
import { Activity } from "./src/screens/Activity";
import { Home } from "./src/screens/Home";
import { Scan } from "./src/screens/Scan";
import { Settings } from "./src/screens/Settings";
import { SignIn } from "./src/screens/SignIn";
import type { PayTarget } from "./src/lib/types";
import { AppProvider, useApp } from "./src/state";
import { Button, colors, Icon } from "./src/ui";

type Tab = "home" | "scan" | "activity";

function Shell() {
  const { signedIn, state, error, refresh, loading } = useApp();
  const [tab, setTab] = useState<Tab>("home");
  const [target, setTarget] = useState<PayTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  /* Retry once when the first load fails, so a sleeping dev server recovers. */
  useEffect(() => {
    if (!signedIn || state || loading) return;
    const id = setTimeout(() => void refresh(), 2500);
    return () => clearTimeout(id);
  }, [signedIn, state, loading, refresh]);

  if (signedIn === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  if (!signedIn) return <SignIn />;

  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>
            Scan<Text style={{ color: colors.brand }}>to</Text>Pay
          </Text>
          <Text style={styles.caption}>{state?.network.label ?? "connecting…"}</Text>
        </View>
        <TouchableOpacity onPress={() => setSettingsOpen(true)} style={styles.gear} hitSlop={10}>
          <Icon name="gear" size={19} color={colors.textDim} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {!state && error ? (
          <View style={styles.center}>
            <Text style={styles.errorTitle}>Wallet service unreachable</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Button label="Try again" variant="soft" onPress={() => void refresh()} style={{ marginTop: 16, minWidth: 160 }} />
            <TouchableOpacity onPress={() => setSettingsOpen(true)} style={{ marginTop: 12 }}>
              <Text style={styles.link}>Change server address</Text>
            </TouchableOpacity>
          </View>
        ) : !state ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.brand} />
            <Text style={styles.loadingText}>Verifying device key and syncing the ledger…</Text>
          </View>
        ) : tab === "home" ? (
          <Home onPay={setTarget} onScan={() => setTab("scan")} />
        ) : tab === "scan" ? (
          <Scan onPay={setTarget} />
        ) : (
          <Activity />
        )}
      </View>

      <View style={styles.tabs}>
        {(
          [
            { id: "home" as Tab, label: "Wallet", icon: "home" as const },
            { id: "scan" as Tab, label: "Scan", icon: "scan" as const },
            { id: "activity" as Tab, label: "Activity", icon: "list" as const },
          ] satisfies { id: Tab; label: string; icon: "home" | "scan" | "list" }[]
        ).map((item) => {
          const active = tab === item.id;
          return (
            <TouchableOpacity key={item.id} style={styles.tab} onPress={() => setTab(item.id)} activeOpacity={0.8}>
              <Icon name={item.icon} size={20} color={active ? colors.brand : colors.muted} />
              <Text style={[styles.tabLabel, active && { color: colors.brand }]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <PaySheet
        target={target}
        onClose={() => {
          setTarget(null);
          void refresh();
        }}
      />
      <Settings visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 8 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 6,
  },
  brand: { color: colors.text, fontSize: 16, fontWeight: "700" },
  caption: { color: colors.muted, fontSize: 10.5, marginTop: 2 },
  gear: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: colors.line,
  },
  tabs: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: "rgba(9,12,15,0.98)",
    paddingTop: 8,
    paddingBottom: 10,
  },
  tab: { flex: 1, alignItems: "center", gap: 4 },
  tabLabel: { color: colors.muted, fontSize: 10.5, fontWeight: "600" },
  errorTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  errorBody: { color: colors.textDim, fontSize: 12, textAlign: "center", lineHeight: 18 },
  link: { color: colors.brand, fontSize: 12.5 },
  loadingText: { color: colors.muted, fontSize: 12, marginTop: 8 },
});
