import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div className="card" style={{ maxWidth: 380, width: "100%", textAlign: "center", padding: 28 }}>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 14,
            display: "grid",
            placeItems: "center",
            margin: "0 auto 14px",
            background: "rgba(255,203,5,.1)",
            color: "var(--brand)",
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          404
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 19, fontWeight: 600, marginBottom: 6 }}>
          This counter is closed
        </h1>
        <p className="small muted" style={{ lineHeight: 1.55, marginBottom: 18 }}>
          The page you asked for doesn&apos;t exist. No money moved — nothing was signed or queued.
        </p>
        <Link href="/" className="btn primary" style={{ display: "inline-flex" }}>
          Back to the wallet
        </Link>
      </div>
    </main>
  );
}
