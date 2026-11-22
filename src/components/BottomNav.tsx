"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon, type IconName } from "./icons";

const TABS: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/activity", label: "Activity", icon: "activity" },
  { href: "/security", label: "Security", icon: "shield" },
  { href: "/wallet", label: "Wallet", icon: "wallet" },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.slice(0, 2).map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link key={tab.href} href={tab.href} className={`nav-item ${active ? "active" : ""}`}>
            <span className="nav-ico">
              <Icon name={tab.icon} size={21} strokeWidth={active ? 1.9 : 1.55} />
            </span>
            {tab.label}
          </Link>
        );
      })}

      <button
        type="button"
        className="nav-fab"
        aria-label="Scan to pay"
        onClick={() => router.push("/scan")}
      >
        <Icon name="scan" size={23} strokeWidth={1.9} />
      </button>

      {TABS.slice(2).map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link key={tab.href} href={tab.href} className={`nav-item ${active ? "active" : ""}`}>
            <span className="nav-ico">
              <Icon name={tab.icon} size={21} strokeWidth={active ? 1.9 : 1.55} />
            </span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
