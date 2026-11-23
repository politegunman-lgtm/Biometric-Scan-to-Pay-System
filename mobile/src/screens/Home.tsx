import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { PayTarget, PaymentRequest, Txn } from "../lib/types";
import { clockTime, expiryLabel, money, relativeTime } from "../lib/format";
import { useApp } from "../state";
import { Badge, Card, colors, Icon, radius, SectionHead } from "../ui";

export function Home({ onPay, onScan }: { onPay: (target: PayTarget) => void; onScan: () => void }) {
  const { state, refresh, loading } = useApp();
  if (!state) return <View style={styles.fill} />;

  const wallet = state.wallets.find((w) => w.primary) ?? state.wallets[0];
  const open = state.requests.filter((r) => r.status === "open");
  const pending = state.queue.filter((q) => q.status === "queued");
  const offline = state.network.tier === "offline";
  const recent = state.txns.slice(0, 5);

  const payRequest = (request: PaymentRequest) =>
    onPay({
      requestId: request.id,
      merchantId: request.merchantId,
      merchantName: request.merchantName,
      amountXAF: request.amountXAF,
      note: request.note,
      category: request.category,
      source: "request",
    });

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} tintColor={colors.brand} />}
    >
      <Text style={styles.greeting}>Bonjour, {state.user.fullName.split(" ")[0]}</Text>
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: state.network.online ? colors.mint : colors.amber }]} />
        <Text style={styles.statusText}>{state.network.label}</Text>
        <Text style={styles.statusDot}>·</Text>
        <Text style={styles.statusText}>{state.biometric.fingers.length} finger enrolled</Text>
      </View>

      <View style={styles.balanceCard}>
        <View style={styles.providerRow}>
          <View style={[styles.providerLogo, { backgroundColor: wallet.accent }]}>
            <Text style={styles.providerInitial}>M</Text>
          </View>
          <Text style={styles.providerName}>{wallet.providerName}</Text>
          <View style={{ flex: 1 }} />
          <Badge label="primary" tone="brand" />
        </View>
        <Text style={styles.balanceLabel}>Available balance</Text>
        <Text style={styles.balance}>
          {money(wallet.balanceXAF, { suffix: false })}
          <Text style={styles.balanceCur}> FCFA</Text>
        </Text>
        <Text style={styles.msisdn}>{wallet.msisdn}</Text>

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.action, styles.actionPrimary]}
            activeOpacity={0.85}
            onPress={() => {
              if (open[0]) payRequest(open[0]);
              else onScan();
            }}
          >
            <Icon name="fingerprint" size={16} color={colors.ink} />
            <Text style={styles.actionPrimaryLabel}>Tap to pay</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.action} activeOpacity={0.85} onPress={onScan}>
            <Icon name="scan" size={16} color={colors.text} />
            <Text style={styles.actionLabel}>Scan</Text>
          </TouchableOpacity>
        </View>
      </View>

      {pending.length > 0 && (
        <Card style={styles.pendingCard}>
          <View style={styles.pendingRow}>
            <Icon name="cloud" size={18} color={colors.amber} />
            <View style={{ flex: 1 }}>
              <Text style={styles.pendingTitle}>
                {pending.length} payment{pending.length === 1 ? "" : "s"} waiting to settle
              </Text>
              <Text style={styles.pendingSub}>
                {money(pending.reduce((s, q) => s + q.amountXAF, 0))} signed offline
              </Text>
            </View>
            {offline && <Badge label="no data" tone="warn" />}
          </View>
        </Card>
      )}

      <SectionHead title="Waiting at the counter" action={<Text style={styles.count}>{open.length}</Text>} />
      {open.length === 0 && (
        <Card>
          <Text style={styles.empty}>No open requests. Create one on the merchant terminal, then scan its QR.</Text>
        </Card>
      )}
      {open.slice(0, 3).map((request) => (
        <TouchableOpacity key={request.id} activeOpacity={0.8} onPress={() => payRequest(request)} style={styles.request}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{request.merchantName.slice(0, 1)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.requestName} numberOfLines={1}>
              {request.merchantName}
            </Text>
            <Text style={styles.requestSub} numberOfLines={1}>
              {request.note ?? "Payment request"} · {expiryLabel(request.expiresAt)}
            </Text>
          </View>
          <Text style={styles.requestAmount}>{money(request.amountXAF, { suffix: false })}</Text>
          <Icon name="chevron" size={14} color={colors.muted} />
        </TouchableOpacity>
      ))}

      <SectionHead title="Recent" />
      <Card style={{ paddingVertical: 4 }}>
        {recent.map((txn: Txn, index) => (
          <View key={txn.id}>
            <View style={styles.txnRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.txnName} numberOfLines={1}>
                  {txn.merchantName}
                </Text>
                <Text style={styles.txnSub}>
                  {clockTime(txn.createdAt)}
                  {txn.offline ? " · offline" : ""}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={[styles.txnAmount, txn.status === "declined" && { color: colors.muted }]}>
                  {txn.status === "declined" ? "—" : money(txn.amountXAF, { suffix: false })}
                </Text>
                <Text style={styles.txnStatus}>
                  {txn.status === "declined" ? "blocked" : txn.status === "queued" ? "queued" : "paid"}
                </Text>
              </View>
            </View>
            {index < recent.length - 1 && <View style={styles.rowDivider} />}
          </View>
        ))}
      </Card>

      <View style={styles.vault}>
        <Icon name="shield" size={13} color={colors.muted} />
        <Text style={styles.vaultText}>
          Vault synced {relativeTime(state.vault.lastSyncAt)} · {state.vault.syncedTxns} receipts
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 18, paddingBottom: 40, gap: 10 },
  greeting: { color: colors.text, fontSize: 22, fontWeight: "700", marginTop: 4 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { color: colors.muted, fontSize: 11.5 },
  statusDot: { color: colors.muted, fontSize: 11 },
  balanceCard: {
    borderRadius: radius.xl,
    padding: 18,
    backgroundColor: "#101623",
    borderWidth: 1,
    borderColor: "rgba(255,203,5,0.16)",
    gap: 2,
  },
  providerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 },
  providerLogo: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  providerInitial: { color: colors.ink, fontSize: 12, fontWeight: "800" },
  providerName: { color: colors.text, fontSize: 13, fontWeight: "600" },
  balanceLabel: { color: "rgba(255,255,255,0.55)", fontSize: 11, letterSpacing: 0.4 },
  balance: { color: colors.text, fontSize: 34, fontWeight: "700", letterSpacing: -0.5, marginTop: 2 },
  balanceCur: { fontSize: 14, fontWeight: "600", color: "rgba(255,255,255,0.6)" },
  msisdn: { color: "rgba(255,255,255,0.45)", fontSize: 11.5, marginTop: 2 },
  actions: { flexDirection: "row", gap: 10, marginTop: 16 },
  action: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  actionPrimary: { backgroundColor: colors.brand, borderColor: colors.brand },
  actionLabel: { color: colors.text, fontSize: 13.5, fontWeight: "600" },
  actionPrimaryLabel: { color: colors.ink, fontSize: 13.5, fontWeight: "700" },
  pendingCard: { borderColor: "rgba(255,189,74,0.28)", backgroundColor: "rgba(255,189,74,0.07)" },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  pendingTitle: { color: colors.text, fontSize: 12.5, fontWeight: "600" },
  pendingSub: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  count: { color: colors.muted, fontSize: 12 },
  empty: { color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  request: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 8,
  },
  avatar: { width: 34, height: 34, borderRadius: 11, backgroundColor: "rgba(255,203,5,0.14)", alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.brand, fontSize: 14, fontWeight: "700" },
  requestName: { color: colors.text, fontSize: 13.5, fontWeight: "600" },
  requestSub: { color: colors.muted, fontSize: 11, marginTop: 2 },
  requestAmount: { color: colors.text, fontSize: 14, fontWeight: "600" },
  txnRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11, gap: 10 },
  txnName: { color: colors.text, fontSize: 13 },
  txnSub: { color: colors.muted, fontSize: 10.5, marginTop: 2 },
  txnAmount: { color: colors.text, fontSize: 13, fontWeight: "600" },
  txnStatus: { color: colors.muted, fontSize: 10, marginTop: 2 },
  rowDivider: { height: 1, backgroundColor: colors.line },
  vault: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 12 },
  vaultText: { color: colors.muted, fontSize: 10.5 },
});
