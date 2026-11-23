import { CameraView, useCameraPermissions } from "expo-camera";
import { useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { PayTarget, PaymentRequest } from "../lib/types";
import { expiryLabel, money } from "../lib/format";
import { useApp } from "../state";
import { Badge, Button, colors, Icon } from "../ui";

/** Pull the request id out of any of the payloads a merchant terminal can emit. */
export function parseRequestId(raw: string, known: PaymentRequest[]): string | null {
  const data = raw.trim();
  if (!data) return null;
  const url = data.match(/[?&]req=([\w-]+)/);
  if (url) return url[1];
  if (data.startsWith("BSP1|")) {
    const parts = data.split("|");
    return parts[1] ?? null;
  }
  const direct = known.find((r) => r.id === data);
  if (direct) return direct.id;
  return null;
}

export function Scan({ onPay }: { onPay: (target: PayTarget) => void }) {
  const { state, refresh } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [message, setMessage] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const handled = useRef(false);

  const open = state?.requests.filter((r) => r.status === "open") ?? [];

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
    setTimeout(() => (handled.current = false), 1500);
  };

  const onScanned = ({ data }: { data: string }) => {
    if (handled.current) return;
    const id = parseRequestId(data, open);
    if (!id) {
      setMessage("That code is not a Scan to Pay request.");
      return;
    }
    const request = state?.requests.find((r) => r.id === id);
    if (!request) {
      setMessage("That payment link is not valid any more.");
      return;
    }
    if (request.status !== "open") {
      setMessage(`Request ${request.ref} is already ${request.status}.`);
      void refresh();
      return;
    }
    setMessage(null);
    payRequest(request);
  };

  return (
    <View style={styles.container}>
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
            <Icon name="scan" size={28} color={colors.textDim} />
            <Text style={styles.permissionTitle}>Camera access</Text>
            <Text style={styles.permissionBody}>
              Needed to read merchant QR codes. Nothing is recorded or uploaded.
            </Text>
            <Button label={permission ? "Allow camera" : "Ask again"} onPress={() => void requestPermission()} variant="soft" />
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

      {message && <Text style={styles.message}>{message}</Text>}

      <Text style={styles.listTitle}>Or pick an open request</Text>
      {open.length === 0 && <Text style={styles.empty}>Nothing waiting. Create a request on the merchant terminal.</Text>}
      {open.slice(0, 4).map((request) => (
        <TouchableOpacity key={request.id} activeOpacity={0.8} style={styles.request} onPress={() => payRequest(request)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.requestName} numberOfLines={1}>
              {request.merchantName}
            </Text>
            <Text style={styles.requestSub}>
              {money(request.amountXAF)} · {expiryLabel(request.expiresAt)}
            </Text>
          </View>
          <Icon name="chevron" size={14} color={colors.muted} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 18 },
  cameraShell: {
    height: 300,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: "#0B0F13",
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: 6,
  },
  permission: { flex: 1, alignItems: "center", justifyContent: "center", padding: 26, gap: 8 },
  permissionTitle: { color: colors.text, fontSize: 15, fontWeight: "600", marginTop: 4 },
  permissionBody: { color: colors.textDim, fontSize: 12, textAlign: "center", lineHeight: 18, marginBottom: 8 },
  reticle: { position: "absolute", top: "22%", left: "18%", right: "18%", bottom: "22%" },
  corner: { position: "absolute", width: 26, height: 26, borderColor: colors.brand },
  tl: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  tr: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  br: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
  cameraBar: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  torch: { backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  torchText: { color: "#fff", fontSize: 11 },
  message: { color: colors.amber, fontSize: 12, marginTop: 10, textAlign: "center" },
  listTitle: { color: colors.muted, fontSize: 11, letterSpacing: 1, marginTop: 20, marginBottom: 8, textTransform: "uppercase" },
  empty: { color: colors.muted, fontSize: 12 },
  request: {
    flexDirection: "row",
    alignItems: "center",
    padding: 13,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: 8,
  },
  requestName: { color: colors.text, fontSize: 13.5, fontWeight: "600" },
  requestSub: { color: colors.muted, fontSize: 11, marginTop: 3 },
});
