import { CameraView, useCameraPermissions } from "expo-camera";
import * as Contacts from "expo-contacts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { apiJson } from "../lib/api";
import { CATEGORY_LABEL, expiryLabel, money } from "../lib/format";
import type { Directory, PayTarget, Payee, PaymentRequest } from "../lib/types";
import { useApp } from "../state";
import { Badge, Button, Card, colors, Icon } from "../ui";

type Mode = "scan" | "people" | "bills";

const QUICK = [1_000, 2_000, 5_000, 10_000];

/** Pull the payee out of any payload a Scan to Pay code can carry. */
export function parsePayCode(raw: string): { kind: "request" | "person"; id: string } | null {
  const data = raw.trim();
  if (!data) return null;
  const to = data.match(/[?&]to=([\w-]+)/);
  if (to) return { kind: "person", id: to[1] };
  const req = data.match(/[?&]req=([\w-]+)/);
  if (req) return { kind: "request", id: req[1] };
  if (data.startsWith("BSP1|")) {
    const parts = data.split("|");
    if (parts[1]) return { kind: "request", id: parts[1] };
  }
  return null;
}

function Avatar({ name, hue }: { name: string; hue: number }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <View style={[styles.avatar, { backgroundColor: `hsla(${hue}, 62%, 52%, 0.18)` }]}>
      <Text style={[styles.avatarText, { color: `hsl(${hue}, 72%, 66%)` }]}>{initials}</Text>
    </View>
  );
}

export function Scan({
  onPay,
  initialMode = "scan",
}: {
  onPay: (target: PayTarget) => void;
  initialMode?: Mode;
}) {
  const { state, refresh, base } = useApp();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [query, setQuery] = useState("");
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [composer, setComposer] = useState<Payee | null>(null);
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [contactState, setContactState] = useState<"idle" | "loading" | "done" | "denied">("idle");
  const [contactMatches, setContactMatches] = useState<Payee[]>([]);

  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const handled = useRef(false);

  const load = useCallback(async (q: string) => {
    try {
      setDirectory(await apiJson<Directory>(`/api/directory?q=${encodeURIComponent(q)}`));
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void load(query), query ? 250 : 0);
    return () => clearTimeout(id);
  }, [query, load]);

  /* Home quick actions land here with a mode already chosen. */
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const openRequests = state?.requests.filter((r) => r.status === "open") ?? [];

  const payRequest = (request: PaymentRequest) => {
    handled.current = true;
    onPay({
      requestId: request.id,
      merchantId: request.merchantId,
      merchantName: request.merchantName,
      amountXAF: request.amountXAF,
      note: request.note,
      category: request.category,
      source: "request",
    });
    setTimeout(() => (handled.current = false), 1200);
  };

  const onScanned = ({ data }: { data: string }) => {
    if (handled.current) return;
    const parsed = parsePayCode(data);
    if (!parsed) {
      setMessage("That code is not a Scan to Pay code.");
      return;
    }
    if (parsed.kind === "request") {
      const request = state?.requests.find((r) => r.id === parsed.id);
      if (!request) {
        setMessage("That payment request is no longer valid.");
        return;
      }
      if (request.status !== "open") {
        setMessage(`Request ${request.ref} is already ${request.status}.`);
        void refresh();
        return;
      }
      setMessage(null);
      payRequest(request);
      return;
    }
    const person = directory?.people.find((p) => p.id === parsed.id) ?? (directory?.me?.id === parsed.id ? directory.me : null);
    if (!person) {
      setMessage("That person is not on Scan to Pay yet.");
      return;
    }
    setMessage(null);
    handled.current = true;
    setTimeout(() => (handled.current = false), 1200);
    setComposer({ ...person, kind: "person" });
    setAmount("");
  };

  const findInContacts = async () => {
    setContactState("loading");
    try {
      const permission = await Contacts.requestPermissionsAsync();
      if (!permission.granted) {
        setContactState("denied");
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
        pageSize: 500,
      });
      const numbers = data
        .flatMap((c) => (c.phoneNumbers ?? []).map((p) => p.number ?? ""))
        .filter(Boolean)
        .slice(0, 400);
      const result = await apiJson<{ matches: Payee[]; checked: number }>("/api/directory", {
        method: "POST",
        body: JSON.stringify({ numbers }),
      });
      setContactMatches(result.matches);
      setContactState("done");
      if (result.matches.length === 0) setMessage(`None of your ${result.checked} contacts use Scan to Pay yet.`);
    } catch (err) {
      setContactState("idle");
      setMessage((err as Error).message);
    }
  };

  const startPayment = async () => {
    if (!composer) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 100) {
      setMessage("Enter at least 100 FCFA");
      return;
    }
    setSending(true);
    try {
      const res = await apiJson<{ request: PaymentRequest }>("/api/merchant", {
        method: "POST",
        body: JSON.stringify({
          merchantId: composer.id,
          amountXAF: Math.round(value),
          note: composer.kind === "person" ? "P2P transfer" : "Bill payment",
        }),
      });
      setComposer(null);
      setAmount("");
      await refresh();
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
      setMessage((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  const row = (payee: Payee, onPress: () => void, badge?: string) => (
    <TouchableOpacity key={payee.id} style={styles.row} activeOpacity={0.8} onPress={onPress}>
      <Avatar name={payee.name} hue={payee.logoHue} />
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>
          {payee.name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {payee.kind === "person"
            ? `${payee.msisdnMasked}${payee.tagline ? ` · ${payee.tagline}` : ""}`
            : (payee.tagline ?? CATEGORY_LABEL[payee.category] ?? payee.category)}
        </Text>
      </View>
      {badge ? <Badge label={badge} tone="ok" /> : null}
      <Icon name="chevron" size={14} color={colors.muted} />
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.segments}>
          {(
            [
              { id: "scan" as Mode, label: "Scan", icon: "scan" as const },
              { id: "people" as Mode, label: "People", icon: "send" as const },
              { id: "bills" as Mode, label: "Bills", icon: "wallet" as const },
            ]
          ).map((item) => {
            const active = mode === item.id;
            return (
              <TouchableOpacity key={item.id} style={[styles.segment, active && styles.segmentActive]} onPress={() => setMode(item.id)}>
                <Icon name={item.icon} size={14} color={active ? colors.text : colors.muted} />
                <Text style={[styles.segmentLabel, active && { color: colors.text }]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {message && <Text style={styles.message}>{message}</Text>}

        {mode === "scan" && (
          <>
            <View style={styles.cameraShell}>
              {permission?.granted ? (
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  enableTorch={torch}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={handled.current ? undefined : onScanned}
                />
              ) : (
                <View style={styles.permission}>
                  <Icon name="scan" size={26} color={colors.textDim} />
                  <Text style={styles.permissionTitle}>Camera access</Text>
                  <Text style={styles.permissionBody}>Reads merchant and personal codes. Nothing is recorded.</Text>
                  <Button label={permission ? "Allow camera" : "Ask again"} variant="soft" onPress={() => void requestPermission()} />
                </View>
              )}
              {permission?.granted && (
                <>
                  <View style={styles.reticle}>
                    <View style={[styles.corner, styles.tl]} />
                    <View style={[styles.corner, styles.tr]} />
                    <View style={[styles.corner, styles.bl]} />
                    <View style={[styles.corner, styles.br]} />
                  </View>
                  <View style={styles.cameraBar}>
                    <Badge label="scanning" tone="ok" />
                    <TouchableOpacity onPress={() => setTorch((v) => !v)} style={styles.torch}>
                      <Text style={styles.torchText}>{torch ? "Torch on" : "Torch"}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>

            <Text style={styles.hint}>Point at a shop code to pay, or at someone's personal code to send them money.</Text>

            <Text style={styles.listTitle}>Open requests ({openRequests.length})</Text>
            {openRequests.length === 0 && <Text style={styles.empty}>Nothing waiting. Create one on the merchant terminal.</Text>}
            {openRequests.slice(0, 4).map((request) =>
              row(
                {
                  id: request.id,
                  name: request.merchantName,
                  initials: request.merchantName.slice(0, 1),
                  kind: "business",
                  category: request.category,
                  tagline: request.note ?? null,
                  logoHue: 42,
                  verified: true,
                  code: request.ref,
                  msisdnMasked: money(request.amountXAF),
                },
                () => payRequest(request),
                expiryLabel(request.expiresAt),
              ),
            )}
          </>
        )}

        {mode !== "scan" && (
          <>
            <View style={styles.search}>
              <Icon name="search" size={14} color={colors.muted} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder={mode === "people" ? "Name or phone number…" : "Electricity, airtime, school…"}
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery("")}>
                  <Text style={{ color: colors.muted, fontSize: 16 }}>×</Text>
                </TouchableOpacity>
              )}
            </View>

            {mode === "people" && (
              <>
                <Card style={{ marginTop: 10, paddingVertical: 12 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>Find friends on Scan to Pay</Text>
                      <Text style={styles.cardBody}>
                        Matches your contacts against registered numbers on the server. Numbers are never stored or shared.
                      </Text>
                    </View>
                    {contactState === "loading" ? (
                      <ActivityIndicator color={colors.brand} />
                    ) : (
                      <Button
                        label={contactState === "done" ? "Again" : "Find"}
                        variant="soft"
                        onPress={() => void findInContacts()}
                        style={{ minWidth: 78, minHeight: 42 }}
                      />
                    )}
                  </View>
                  {contactState === "denied" && (
                    <Text style={[styles.cardBody, { color: colors.amber, marginTop: 8 }]}>
                      Contacts permission denied — you can still search by number above.
                    </Text>
                  )}
                  {contactState === "done" && contactMatches.length > 0 && (
                    <Text style={[styles.cardBody, { color: colors.mint, marginTop: 8 }]}>
                      {contactMatches.length} contact{contactMatches.length === 1 ? "" : "s"} already on the app.
                    </Text>
                  )}
                </Card>

                {contactMatches.length > 0 && (
                  <>
                    <Text style={styles.listTitle}>From your contacts</Text>
                    {contactMatches.map((person) =>
                      row(
                        person,
                        () => {
                          setComposer(person);
                          setAmount("");
                        },
                        "contact",
                      ),
                    )}
                  </>
                )}

                <Text style={styles.listTitle}>People nearby</Text>
                {(directory?.people ?? []).map((person) =>
                  row(person, () => {
                    setComposer(person);
                    setAmount("");
                  }),
                )}
                {directory && directory.people.length === 0 && <Text style={styles.empty}>Nobody matches that search.</Text>}

                {directory?.me && (
                  <Card style={{ marginTop: 16 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                      <View style={styles.qrBox}>
                        <QRCode
                          value={`${base.replace(/\/$/, "")}/scan?to=${encodeURIComponent(directory.me.id)}`}
                          size={92}
                          color="#06080A"
                          backgroundColor="#FFFFFF"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.cardTitle}>Your code</Text>
                        <Text style={styles.cardBody}>
                          Let anyone scan this to send you money. No amount attached — they choose it.
                        </Text>
                        <TouchableOpacity onPress={() => setCodeOpen(true)} style={{ marginTop: 8 }}>
                          <Text style={{ color: colors.brand, fontSize: 12.5 }}>Show full size</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </Card>
                )}
              </>
            )}

            {mode === "bills" && (
              <>
                <Text style={styles.listTitle}>Bills & shops</Text>
                {(directory?.services ?? []).map((service) =>
                  row(
                    service,
                    () => {
                      setComposer(service);
                      setAmount("");
                    },
                    CATEGORY_LABEL[service.category],
                  ),
                )}
                {directory && directory.services.length === 0 && <Text style={styles.empty}>Nothing matches that search.</Text>}
              </>
            )}
          </>
        )}
      </ScrollView>

      {/* amount composer */}
      <Modal visible={Boolean(composer)} transparent animationType="slide" onRequestClose={() => setComposer(null)}>
        <View style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setComposer(null)} />
          <View style={styles.sheet}>
            <View style={styles.grabber} />
            {composer && (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
                  <Avatar name={composer.name} hue={composer.logoHue} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {composer.name}
                    </Text>
                    <Text style={styles.sub} numberOfLines={1}>
                      {composer.kind === "person" ? composer.msisdnMasked : (composer.tagline ?? "Bill payment")}
                    </Text>
                  </View>
                </View>

                <Text style={styles.composerLabel}>{composer.kind === "person" ? "AMOUNT TO SEND" : "AMOUNT TO PAY"}</Text>
                <TextInput
                  style={styles.amountInput}
                  value={amount}
                  onChangeText={(v) => setAmount(v.replace(/[^\d]/g, "").slice(0, 7))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                  autoFocus
                />
                <View style={styles.quick}>
                  {QUICK.map((value) => (
                    <TouchableOpacity key={value} style={styles.quickChip} onPress={() => setAmount(String(value))}>
                      <Text style={styles.quickText}>{money(value, { suffix: false })}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Button
                  label={sending ? "Preparing…" : `Continue${Number(amount) >= 100 ? ` · ${money(Number(amount))}` : ""}`}
                  onPress={() => void startPayment()}
                  loading={sending}
                  disabled={Number(amount) < 100}
                  style={{ marginTop: 16 }}
                />
                <Text style={styles.hint}>
                  A signed request is created first; your fingerprint authorises it on the next screen.
                </Text>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* full-size personal code */}
      <Modal visible={codeOpen} transparent animationType="fade" onRequestClose={() => setCodeOpen(false)}>
        <Pressable style={styles.codeBackdrop} onPress={() => setCodeOpen(false)}>
          <View style={styles.codeCard}>
            {directory?.me && (
              <>
                <Text style={styles.codeName}>{directory.me.name}</Text>
                <Text style={styles.codeMsisdn}>{directory.me.msisdnMasked}</Text>
                <View style={styles.codeQr}>
                  <QRCode
                    value={`${base.replace(/\/$/, "")}/scan?to=${encodeURIComponent(directory.me.id)}`}
                    size={216}
                    color="#06080A"
                    backgroundColor="#FFFFFF"
                  />
                </View>
                <Text style={styles.codeHint}>Scan to send money · {directory.me.tagline}</Text>
              </>
            )}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}


const styles = StyleSheet.create({
  container: { padding: 18, paddingBottom: 40 },
  segments: { flexDirection: "row", gap: 4, backgroundColor: "rgba(255,255,255,0.035)", borderRadius: 12, padding: 3, marginBottom: 12 },
  segment: { flex: 1, height: 34, borderRadius: 9, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  segmentActive: { backgroundColor: "rgba(255,255,255,0.09)" },
  segmentLabel: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  message: { color: colors.amber, fontSize: 12, marginBottom: 10, textAlign: "center" },
  cameraShell: { height: 260, borderRadius: 22, overflow: "hidden", backgroundColor: "#0B0F13", borderWidth: 1, borderColor: colors.line },
  permission: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  permissionTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  permissionBody: { color: colors.textDim, fontSize: 12, textAlign: "center", lineHeight: 18, marginBottom: 8 },
  reticle: { position: "absolute", top: "24%", left: "18%", right: "18%", bottom: "24%" },
  corner: { position: "absolute", width: 24, height: 24, borderColor: colors.brand },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 9 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 9 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 9 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 9 },
  cameraBar: { position: "absolute", left: 12, right: 12, bottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  torch: { backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  torchText: { color: "#fff", fontSize: 11 },
  hint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 10, textAlign: "center" },
  listTitle: { color: colors.muted, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", marginTop: 20, marginBottom: 8 },
  empty: { color: colors.muted, fontSize: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 8,
  },
  avatar: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 13, fontWeight: "700" },
  name: { color: colors.text, fontSize: 13.5, fontWeight: "600" },
  sub: { color: colors.muted, fontSize: 11, marginTop: 3 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 12,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 13.5 },
  cardTitle: { color: colors.text, fontSize: 13, fontWeight: "600" },
  cardBody: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  qrBox: { backgroundColor: "#fff", padding: 6, borderRadius: 12 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.62)" },
  sheet: {
    backgroundColor: "#0C1015",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: colors.line,
    padding: 20,
    paddingBottom: 28,
  },
  grabber: { alignSelf: "center", width: 42, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: 16 },
  composerLabel: { color: colors.muted, fontSize: 9.5, letterSpacing: 1.2, marginTop: 22, marginBottom: 4 },
  amountInput: { color: colors.text, fontSize: 34, fontWeight: "700", paddingVertical: 6 },
  quick: { flexDirection: "row", gap: 8, marginTop: 10 },
  quickChip: { flex: 1, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: colors.line },
  quickText: { color: colors.textDim, fontSize: 12, fontWeight: "600" },
  codeBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", alignItems: "center", justifyContent: "center", padding: 24 },
  codeCard: { backgroundColor: "#0C1015", borderRadius: 24, padding: 24, alignItems: "center", borderWidth: 1, borderColor: colors.line },
  codeName: { color: colors.text, fontSize: 17, fontWeight: "700" },
  codeMsisdn: { color: colors.muted, fontSize: 12, marginTop: 3 },
  codeQr: { backgroundColor: "#fff", padding: 10, borderRadius: 16, marginTop: 16 },
  codeHint: { color: colors.muted, fontSize: 11, marginTop: 14 },
});
