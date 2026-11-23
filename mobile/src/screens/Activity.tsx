import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { apiJson } from "../lib/api";
import { CATEGORY_LABEL, clockTime, dayLabel, money, relativeTime } from "../lib/format";
import type { PayTarget, PaymentRequest, Txn } from "../lib/types";
import { useApp } from "../state";
import { Badge, Button, Card, colors, Divider, Icon } from "../ui";

export function Activity({ onPay }: { onPay: (target: PayTarget) => void }) {
  const { state } = useApp();
  const [detail, setDetail] = useState<Txn | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  /* CSV of every payment — share sheet lets you save it to Files or mail it. */
  const exportCsv = async () => {
    const header = "date,recipient,payee_code,category,amount_xaf,status,channel,receipt";
    const rows = state.txns.map((t) =>
      [t.createdAt, t.merchantName, t.merchantCode, t.category, t.amountXAF, t.status, t.channel, t.receiptNo]
        .map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v)))
        .join(","),
    );
    try {
      await Share.share({ title: "Scan to Pay — payments", message: [header, ...rows].join("\n") });
    } catch {
      setNotice("Could not open the share sheet");
    }
  };

  /* Repeat: mint a signed request for the last amount, then authorise. */
  const payAgain = async (txn: Txn) => {
    setBusy(true);
    try {
      const res = await apiJson<{ request: PaymentRequest }>("/api/merchant", {
        method: "POST",
        body: JSON.stringify({ merchantId: txn.merchantId, amountXAF: txn.amountXAF, note: "Repeat payment" }),
      });
      setDetail(null);
      onPay({
        requestId: res.request.id,
        merchantId: res.request.merchantId,
        merchantName: res.request.merchantName,
        amountXAF: res.request.amountXAF,
        note: res.request.note,
        category: res.request.category,
        source: "request",
      });
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const settled = state.txns.filter((t) => t.status === "settled");
  const spend30 = settled.filter((t) => Date.now() - new Date(t.createdAt).getTime() < 30 * 86_400_000);
  const blocked = state.txns.filter((t) => t.status === "declined");

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Money trail</Text>
          <Text style={styles.subtitle}>Tap a payment for the recipient and receipt.</Text>
        </View>
        <TouchableOpacity style={styles.export} onPress={() => void exportCsv()} activeOpacity={0.8}>
          <Icon name="download" size={13} color={colors.textDim} />
          <Text style={styles.exportLabel}>Export</Text>
        </TouchableOpacity>
      </View>
      {notice && <Text style={styles.notice}>{notice}</Text>}

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
                <TouchableOpacity style={styles.row} activeOpacity={0.75} onPress={() => setDetail(txn)}>
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
                </TouchableOpacity>
                {index < group.rows.length - 1 && <Divider />}
              </View>
            ))}
          </Card>
        </View>
      ))}

      <Modal visible={Boolean(detail)} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setDetail(null)} />
          {detail && (
            <View style={styles.sheet}>
              <View style={styles.grabber} />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
                <View style={styles.avatarLarge}>
                  <Text style={styles.avatarText}>{detail.merchantName.slice(0, 1)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetName}>{detail.merchantName}</Text>
                  <Text style={styles.sheetMeta}>
                    {CATEGORY_LABEL[detail.category] ?? detail.category} · payee {detail.merchantCode}
                  </Text>
                </View>
                <Badge
                  label={detail.status === "settled" ? "paid" : detail.status}
                  tone={detail.status === "declined" ? "danger" : detail.status === "queued" ? "warn" : "ok"}
                />
              </View>

              <Text style={styles.sheetAmount}>
                {money(detail.amountXAF, { suffix: false })}
                <Text style={styles.sheetCur}> FCFA</Text>
              </Text>

              <View style={styles.sheetRows}>
                {[
                  ["Receipt", detail.receiptNo],
                  ["Reference", detail.ref],
                  ["When", `${clockTime(detail.createdAt)} · ${relativeTime(detail.createdAt)}`],
                  ["Channel", detail.offline ? `${detail.channel} (offline)` : detail.channel],
                  ["Wallet", state.wallets.find((w) => w.id === detail.walletId)?.providerName ?? detail.provider],
                  ["Biometric match", `${((detail.auth?.matchScore ?? 0) * 100).toFixed(1)}%`],
                  ["Risk", detail.risk ? `${detail.risk.score}/100 · ${detail.risk.decision}` : "not scored"],
                ].map(([k, v]) => (
                  <View key={k} style={styles.sheetRow}>
                    <Text style={styles.sheetKey}>{k}</Text>
                    <Text style={styles.sheetValue} numberOfLines={1}>
                      {v}
                    </Text>
                  </View>
                ))}
              </View>

              <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
                <Button
                  label={busy ? "Preparing…" : `Pay ${money(detail.amountXAF, { suffix: false })} again`}
                  loading={busy}
                  onPress={() => void payAgain(detail)}
                  style={{ flex: 1 }}
                />
                <Button
                  label="Share"
                  variant="soft"
                  onPress={() =>
                    void Share.share({
                      title: `Receipt ${detail.receiptNo}`,
                      message: `${detail.merchantName} · ${money(detail.amountXAF)} paid\nReceipt ${detail.receiptNo}\n${new Date(
                        detail.createdAt,
                      ).toLocaleString()}\n${detail.ref}`,
                    })
                  }
                  style={{ flex: 1 }}
                />
              </View>
              <Button label="Close" variant="ghost" onPress={() => setDetail(null)} style={{ marginTop: 8 }} />
            </View>
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 18, paddingBottom: 40 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  export: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  exportLabel: { color: colors.textDim, fontSize: 11, fontWeight: "600" },
  notice: { color: colors.amber, fontSize: 11.5, marginTop: 8 },
  title: { color: colors.text, fontSize: 22, fontWeight: "700" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.62)" },
  sheet: {
    backgroundColor: "#0C1015",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: colors.line,
    padding: 20,
    paddingBottom: 26,
  },
  grabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: 16 },
  avatarLarge: { width: 40, height: 40, borderRadius: 13, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  sheetName: { color: colors.text, fontSize: 14.5, fontWeight: "600" },
  sheetMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  sheetAmount: { color: colors.text, fontSize: 30, fontWeight: "700", marginTop: 16 },
  sheetCur: { fontSize: 12, fontWeight: "600", color: colors.muted },
  sheetRows: { marginTop: 12, gap: 7 },
  sheetRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  sheetKey: { color: colors.muted, fontSize: 11 },
  sheetValue: { color: colors.textDim, fontSize: 11, flexShrink: 1, textAlign: "right", textTransform: "capitalize" },
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
