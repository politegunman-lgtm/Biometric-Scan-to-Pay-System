import { PropsWithChildren } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

export const colors = {
  bg: "#06080A",
  surface: "#0E1216",
  surfaceAlt: "#131920",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.14)",
  text: "#F2F5F7",
  textDim: "#9DA9B4",
  muted: "#6C7885",
  brand: "#FFCB05",
  brandSoft: "rgba(255,203,5,0.12)",
  mint: "#4BDDA0",
  coral: "#FF6A5A",
  amber: "#FFBD4A",
  blue: "#6AA6FF",
  ink: "#171200",
};

export const radius = { sm: 10, md: 14, lg: 18, xl: 24 };

type IconName =
  | "home"
  | "scan"
  | "list"
  | "fingerprint"
  | "shield"
  | "chevron"
  | "check"
  | "alert"
  | "cloud"
  | "gear"
  | "lock"
  | "wallet"
  | "send"
  | "search";

export function Icon({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  const props = { stroke: color, strokeWidth: 1.7, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "home" && (
        <>
          <Path d="M4 10.5 12 4l8 6.5" {...props} />
          <Path d="M6 10v9h12v-9" {...props} />
        </>
      )}
      {name === "scan" && (
        <>
          <Path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" {...props} />
          <Path d="M4 12h16" {...props} strokeWidth={2} />
        </>
      )}
      {name === "list" && (
        <>
          <Path d="M4 7h16M4 12h16M4 17h10" {...props} />
        </>
      )}
      {name === "fingerprint" && (
        <>
          <Path d="M6 11a6 6 0 0 1 12 0" {...props} />
          <Path d="M8.5 12a3.5 3.5 0 0 1 7 0v1.5" {...props} />
          <Path d="M12 12.5v4" {...props} />
          <Path d="M6 11v3.2c0 1.4.3 2.7.9 3.9" {...props} />
          <Path d="M8.6 12v3.4c0 1.2.3 2.4.9 3.4" {...props} />
          <Path d="M15.4 13.5v2.4c0 1-.2 2-.6 3" {...props} />
          <Path d="M18 11v2" {...props} />
        </>
      )}
      {name === "shield" && (
        <>
          <Path d="M12 3.5 19 6v6c0 4-3 6.7-7 8.5-4-1.8-7-4.5-7-8.5V6l7-2.5Z" {...props} />
          <Path d="M9 12l2 2 4-4" {...props} />
        </>
      )}
      {name === "chevron" && <Path d="M9 5l7 7-7 7" {...props} />}
      {name === "check" && <Path d="M5 13l4 4L19 7" {...props} />}
      {name === "alert" && (
        <>
          <Circle cx="12" cy="12" r="8.5" {...props} />
          <Path d="M12 8v4.5M12 15.8v.2" {...props} />
        </>
      )}
      {name === "cloud" && (
        <Path d="M7 17.5a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.4 10a3.8 3.8 0 0 1-.4 7.5H7Z" {...props} />
      )}
      {name === "gear" && (
        <>
          <Circle cx="12" cy="12" r="3" {...props} />
          <Path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" {...props} />
        </>
      )}
      {name === "lock" && (
        <>
          <Rect x="5" y="10" width="14" height="10" rx="2.5" {...props} />
          <Path d="M8.5 10V8a3.5 3.5 0 0 1 7 0v2" {...props} />
        </>
      )}
      {name === "send" && (
        <>
          <Path d="m3.3 9.6 13.2-5.2-4.1 12.4-3-5.1-6.1-2.1Z" {...props} />
          <Path d="m9.4 11.7 3.1-3.4" {...props} />
        </>
      )}
      {name === "search" && (
        <>
          <Circle cx="10.6" cy="10.6" r="5.6" {...props} />
          <Path d="m15 15 4.2 4.2" {...props} />
        </>
      )}
      {name === "wallet" && (
        <>
          <Rect x="3.5" y="6.5" width="17" height="12" rx="3" {...props} />
          <Path d="M3.5 10h17" {...props} />
          <Circle cx="16.5" cy="14" r="1.1" fill={color} stroke="none" />
        </>
      )}
    </Svg>
  );
}

export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "soft" | "ghost" | "danger";
  disabled?: boolean;
  loading?: boolean;
  icon?: IconName;
  style?: ViewStyle;
}) {
  const palette = {
    primary: { bg: colors.brand, fg: colors.ink, border: "transparent" },
    soft: { bg: "rgba(255,255,255,0.07)", fg: colors.text, border: colors.line },
    ghost: { bg: "transparent", fg: colors.textDim, border: colors.line },
    danger: { bg: "rgba(255,106,90,0.14)", fg: "#FF9A8E", border: "rgba(255,106,90,0.3)" },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} size="small" />
      ) : (
        <>
          {icon && <Icon name={icon} size={16} color={palette.fg} />}
          <Text style={[styles.buttonLabel, { color: palette.fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function Badge({ label, tone = "muted" }: { label: string; tone?: "muted" | "ok" | "warn" | "danger" | "brand" }) {
  const toneColor = {
    muted: colors.muted,
    ok: colors.mint,
    warn: colors.amber,
    danger: colors.coral,
    brand: colors.brand,
  }[tone];
  return (
    <View style={[styles.badge, { borderColor: `${toneColor}55`, backgroundColor: `${toneColor}18` }]}>
      <Text style={[styles.badgeLabel, { color: toneColor }]}>{label}</Text>
    </View>
  );
}

export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[{ height: 1, backgroundColor: colors.line }, style]} />;
}

export function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
  },
  button: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  buttonLabel: { fontSize: 15, fontWeight: "600" },
  badge: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3 },
  badgeLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10, marginTop: 4 },
  sectionTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
});
