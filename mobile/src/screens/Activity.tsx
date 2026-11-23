import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { clockTime, dayLabel, money } from "../lib/format";
import { useApp } from "../state";
import { Badge, Card, colors, Divider } from "../ui";

export function Activity() {
  const { state } = useApp();

  const groups = useMemo(() => {
    const txns = (state?.txns ?? []).slice(0, 60);
    const out: { day: string; rows: typeof txns; total: number }[] = [];
    for (const txn of txns) {
      const day = dayLabel(txn.createdAt);
      const last = out[out.length - 1];
      if (last && last.day === day) {
        last.rows.push(txn);
        if (txn.status !== "declined") last.total += txn.amountXAF;
      } else {
        out.push({ day, rows: [txn], total: txn.status === "declined" ? 0 : txn.amountXAF });
      }
    }
    return out;
  }, [state]);

  if (!state) return <View style={styles.fill} />;

  const settled = state.txns.filter((t) => t.status === "settled");
  const spend30 = settled.filter((t) => Date.now() - new Date(t.createdAt).getTime() < 30 * 86_400_000);
  const blocked = state.txns.filter((t) => t.status === "declined");

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Money trail</Text>
      <Text style={styles.subtitle}>Cloud-synced history, mirrored from the wallet service.</Text>

      <View style={styles.stats}>
        <Card style={styles.stat}>
          <Text style={styles.statKey}>30-day spend</Text>
          <Text style={styles.statValue}>{money(spend30.reduce((s, t) => s + t.amountXAF, 0), { suffix: false })}</Text>
          <Text style={styles.statSub}>FCFA · {spend30.length} payments</Text>
        </Card>
        <Card style={styles.stat}>
          <Text style={styles.statKey}>Blocked</Text>
          <Text style={[styles.statValue, { color: colors.coral }]}>{blocked.length}</Text>
          <Text style={styles.statSub}>fraud attempts</Text>
        </Card>
      </View>

      {groups.map((group) => (
        <View key={group.day} style={{ marginTop: 18 }}>
          <View style={styles.dayHead}>
            <Text style={styles.day}>{group.day}</Text>
            <Text style={styles.dayTotal}>{money(group.total)}</Text>
          </View>
          <Card style={{ paddingVertical: 2 }}>
            {group.rows.map((txn, index) => (
              <View key={txn.id}>
                <View style={styles.row}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{txn.merchantName.slice(0, 1)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {txn.merchantName}
                    </Text>
                    <Text style={styles.meta}>
                      {clockTime(txn.createdAt)} · {txn.category}
                      {txn.offline ? " · offline" : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={[styles.amount, txn.status === "declined" && { color: colors.muted }]}>
                      {txn.status === "declined" ? "—" : money(txn.amountXAF, { suffix: false })}
                    </Text>
                    <Badge
                      label={txn.status === "declined" ? "blocked" : txn.status === "queued" ? "queued" : "paid"}
                      tone={txn.status === "declined" ? "danger" : txn.status === "queued" ? "warn" : "ok"}
                    />
                  </View>
                </View>
                {index < group.rows.length - 1 && <Divider />}
              </View>
            ))}
          </Card>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 18, paddingBottom: 40 },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
  subtitle: { color: colors.muted, fontSize: 12, marginTop: 4 },
  stats: { flexDirection: "row", gap: 10, marginTop: 16 },
  stat: { flex: 1, paddingVertical: 14 },
  statKey: { color: colors.muted, fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase" },
  statValue: { color: colors.text, fontSize: 22, fontWeight: "700", marginTop: 4 },
  statSub: { color: colors.muted, fontSize: 10.5, marginTop: 2 },
  dayHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, paddingHorizontal: 2 },
  day: { color: colors.textDim, fontSize: 12, fontWeight: "600" },
  dayTotal: { color: colors.muted, fontSize: 11.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 11 },
  avatar: { width: 32, height: 32, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.05)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.textDim, fontSize: 13, fontWeight: "600" },
  name: { color: colors.text, fontSize: 13 },
  meta: { color: colors.muted, fontSize: 10.5, marginTop: 2, textTransform: "capitalize" },
  amount: { color: colors.text, fontSize: 13, fontWeight: "600" },
});
