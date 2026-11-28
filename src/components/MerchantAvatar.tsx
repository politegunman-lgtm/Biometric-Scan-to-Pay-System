export function MerchantAvatar({
  name,
  hue = 42,
  size = "md",
}: {
  name: string;
  hue?: number;
  size?: "sm" | "md";
}) {
  const initials = name
    .replace(/[^\p{L}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span
      className={`merchant-avatar ${size === "sm" ? "sm" : ""}`}
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 82% 67%), hsl(${(hue + 28) % 360} 70% 44%))`,
        color: hue > 250 || hue < 10 ? "#fff" : "#0a0d10",
      }}
      aria-hidden="true"
    >
      {initials || "•"}
    </span>
  );
}
