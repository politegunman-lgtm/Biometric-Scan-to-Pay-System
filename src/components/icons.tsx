import type { SVGProps } from "react";

export type IconName =
  | "home"
  | "activity"
  | "shield"
  | "wallet"
  | "store"
  | "scan"
  | "fingerprint"
  | "nfc"
  | "wifi"
  | "cloud"
  | "alert"
  | "check"
  | "x"
  | "chevron"
  | "chevron-left"
  | "arrow-right"
  | "plus"
  | "lock"
  | "pin"
  | "chart"
  | "clock"
  | "download"
  | "sparkle"
  | "send"
  | "eye"
  | "device"
  | "refresh"
  | "bolt"
  | "shield-check"
  | "globe"
  | "qr"
  | "bell"
  | "trash"
  | "key"
  | "signal"
  | "search"
  | "receipt"
  | "play"
  | "info"
  | "copy"
  | "user"
  | "server"
  | "layers"
  | "link"
  | "flask";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <><path d="M3.5 10.2 10 4.6a1.5 1.5 0 0 1 2 0l6.5 5.6" /><path d="M5.3 9.3v6.9a1.4 1.4 0 0 0 1.4 1.4h2.7v-4.3h3.2v4.3h2.7a1.4 1.4 0 0 0 1.4-1.4V9.3" /></>,
  activity: <><path d="M3 12h3.2l2.1-5.4 3.4 10.8 2.2-5.4H21" /></>,
  shield: <><path d="M10 3.2 4.6 5.3v5.1c0 3.9 2.6 6.6 5.4 7.6 2.8-1 5.4-3.7 5.4-7.6V5.3L10 3.2Z" /></>,
  "shield-check": <><path d="M10 3.2 4.6 5.3v5.1c0 3.9 2.6 6.6 5.4 7.6 2.8-1 5.4-3.7 5.4-7.6V5.3L10 3.2Z" /><path d="m7.4 9.9 1.9 1.9 3.5-3.6" /></>,
  wallet: <><rect x="3" y="5.6" width="14" height="10" rx="2.4" /><path d="M3 8.4h11.2a2 2 0 0 1 2 2v.7a2 2 0 0 1-2 2H9.4" /><circle cx="13.4" cy="9.9" r=".7" fill="currentColor" stroke="none" /></>,
  store: <><path d="M4 8.2V16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8.2" /><path d="M3.2 8.2 4.6 4.4h10.8l1.4 3.8a2 2 0 0 1-3.7 1.1 2 2 0 0 1-3.4.1 2 2 0 0 1-3.4 0 2 2 0 0 1-3.1-1.2Z" /><path d="M8.2 17v-3.6h3.6V17" /></>,
  scan: <><path d="M3.5 7.2V5.5a2 2 0 0 1 2-2h1.7M14.8 3.5h1.7a2 2 0 0 1 2 2v1.7M18.5 12.8v1.7a2 2 0 0 1-2 2h-1.7M5.5 16.5h-0a2 2 0 0 1-2-2v-1.7" /><path d="M3.5 10h13" /></>,
  fingerprint: <><path d="M5.1 8.3A5.6 5.6 0 0 1 10 5.4a5.6 5.6 0 0 1 4.9 2.9" /><path d="M4.2 11.3a5.8 5.8 0 0 1 .6-1.4M15.3 11.4a6 6 0 0 0-.3-1.1" /><path d="M6.5 13.2v1.9a3.5 3.5 0 0 0 .5 1.7M13.5 13.4v2.3a3.5 3.5 0 0 1-.5 1.6" /><path d="M7.5 9.2a2.6 2.6 0 0 1 5 0v3.2M7.5 12.3v2.6M10 16.6v-3.1" /><path d="M11.7 8.3a2.6 2.6 0 0 1 1.4 2.4v3.4M10 16.9v.7" /></>,
  nfc: <><path d="M7.5 8.2a5.4 5.4 0 0 1 0 7.6M10.4 6.1a8.4 8.4 0 0 1 0 11.8M4.6 10.4a2.6 2.6 0 0 1 0 3.2" /><circle cx="3" cy="12" r=".6" fill="currentColor" stroke="none" /></>,
  wifi: <><path d="M3 8.4a11 11 0 0 1 14 0M5.6 11.2a7.2 7.2 0 0 1 8.8 0M8.2 14a3.4 3.4 0 0 1 3.6 0" /><circle cx="10" cy="16.6" r=".9" fill="currentColor" stroke="none" /></>,
  cloud: <><path d="M6.8 15.4a3.4 3.4 0 0 1-.4-6.8 4.4 4.4 0 0 1 8.4-1 3.2 3.2 0 0 1 .6 6.4" /><path d="m10.9 11.6-3 3.2M11 14.8l1 1 -.9.9" /></>,
  alert: <><path d="M10 3.6 2.9 16a.8.8 0 0 0 .7 1.2h12.8a.8.8 0 0 0 .7-1.2L10 3.6Z" /><path d="M10 8v3.6" /><circle cx="10" cy="14.2" r=".8" fill="currentColor" stroke="none" /></>,
  check: <><path d="m4.5 10.4 3.6 3.6 7.4-8" /></>,
  x: <><path d="m5.5 5.5 9 9M14.5 5.5l-9 9" /></>,
  chevron: <><path d="m7.5 4.5 5.5 5.5-5.5 5.5" /></>,
  "chevron-left": <><path d="M12.2 4.8 6.5 10l5.7 5.2" /></>,
  "arrow-right": <><path d="M3.8 10h12M11.4 5.4 16.2 10l-4.8 4.6" /></>,
  plus: <><path d="M10 4.2v11.6M4.2 10h11.6" /></>,
  lock: <><rect x="4.4" y="8.8" width="11.2" height="8" rx="2.2" /><path d="M6.8 8.8V6.9a3.2 3.2 0 0 1 6.4 0v1.9" /><circle cx="10" cy="12.8" r=".9" fill="currentColor" stroke="none" /></>,
  pin: <><rect x="4" y="3.5" width="12" height="13" rx="2.4" /><path d="M7 7.2h6M7 10h3.5M13 10h.01M7 12.8h2.5" /></>,
  chart: <><path d="M3.5 16.5h13" /><path d="M6 13.4V9.8M9.7 13.4V5.6M13.3 13.4v-3" /></>,
  clock: <><circle cx="10" cy="10" r="6.6" /><path d="M10 6.4V10l2.4 1.6" /></>,
  download: <><path d="M10 3V12M6.6 9l3.4 3.4L13.4 9" /><path d="M3.8 14.6v1.2a1.4 1.4 0 0 0 1.4 1.4h9.6a1.4 1.4 0 0 0 1.4-1.4v-1.2" /></>,
  sparkle: <><path d="m10 2.8 1.6 4.3 4.3 1.6-4.3 1.6L10 14.6 8.4 10.3 4.1 8.7l4.3-1.6L10 2.8Z" /><path d="m15.4 13.6.8 2 .8-2 2-.8-2-.8-.8-2-.8 2-2 .8 2 .8Z" /></>,
  send: <><path d="m3.3 9.6 13.2-5.2-4.1 12.4-3-5.1-6.1-2.1Z" /><path d="m9.4 11.7 3.1-3.4" /></>,
  eye: <><path d="M2.6 10S5.5 5.2 10 5.2 17.4 10 17.4 10 14.5 14.8 10 14.8 2.6 10 2.6 10Z" /><circle cx="10" cy="10" r="2.1" /></>,
  device: <><rect x="5.8" y="2.8" width="8.4" height="14.4" rx="2" /><path d="M9 14.6h2" /></>,
  refresh: <><path d="M16.2 10a6.2 6.2 0 1 1-1.8-4.4" /><path d="M16.4 3.2v3.4h-3.4" /></>,
  bolt: <><path d="M11.2 2.8 4.8 11h4l-.9 6.2 6.6-8.4h-4l.7-6Z" /></>,
  globe: <><circle cx="10" cy="10" r="6.6" /><path d="M3.6 10h12.8M10 3.4c1.8 2 2.7 4.2 2.7 6.6s-.9 4.6-2.7 6.6c-1.8-2-2.7-4.2-2.7-6.6S8.2 5.4 10 3.4Z" /></>,
  qr: <><rect x="3.4" y="3.4" width="5.2" height="5.2" rx="1" /><rect x="11.4" y="3.4" width="5.2" height="5.2" rx="1" /><rect x="3.4" y="11.4" width="5.2" height="5.2" rx="1" /><path d="M11.4 11.4h2.2v2.2h-2.2zM14.6 14.6h2v2h-2zM11.4 16.6h.01M16.6 11.4h.01" /></>,
  bell: <><path d="M6.4 8.6a3.6 3.6 0 0 1 7.2 0c0 3 .9 4.2 1.4 4.7H5c.5-.5 1.4-1.7 1.4-4.7Z" /><path d="M8.4 15.6a1.7 1.7 0 0 0 3.2 0" /></>,
  trash: <><path d="M4.4 5.8h11.2M8 5.8V4.2h4v1.6M6.2 5.8l.6 10a1.4 1.4 0 0 0 1.4 1.3h3.6a1.4 1.4 0 0 0 1.4-1.3l.6-10" /></>,
  key: <><circle cx="6.6" cy="9.6" r="3" /><path d="m8.8 11.4 6.4 4M12.6 13.9l1.2-1.2M14.6 15.3l1.2-1.2" /></>,
  signal: <><path d="M4 16v-3M8 16v-6M12 16V7M16 16V4" /></>,
  search: <><circle cx="8.8" cy="8.8" r="5.3" /><path d="m12.8 12.8 3.6 3.6" /></>,
  receipt: <><path d="M5 3.2v13.6l2.5-1.6 2.5 1.6 2.5-1.6 2.5 1.6V3.2L12.5 4.8 10 3.2 7.5 4.8 5 3.2Z" /><path d="M7.6 7.4h4.8M7.6 10.2h4.8" /></>,
  play: <><path d="M6.4 4.6v10.8l8.6-5.4-8.6-5.4Z" /></>,
  info: <><circle cx="10" cy="10" r="6.6" /><path d="M10 9v4.4" /><circle cx="10" cy="6.6" r=".8" fill="currentColor" stroke="none" /></>,
  copy: <><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M13 7V5.6A1.6 1.6 0 0 0 11.4 4H5.6A1.6 1.6 0 0 0 4 5.6v5.8A1.6 1.6 0 0 0 5.6 13H7" /></>,
  user: <><circle cx="10" cy="7.4" r="3" /><path d="M4.4 16.4a5.8 5.8 0 0 1 11.2 0" /></>,
  server: <><rect x="3.4" y="4" width="13.2" height="5" rx="1.6" /><rect x="3.4" y="11" width="13.2" height="5" rx="1.6" /><path d="M6.4 6.5h.01M6.4 13.5h.01" /></>,
  layers: <><path d="m10 3.2 6.6 3.4L10 10 3.4 6.6 10 3.2Z" /><path d="m3.4 10.4 6.6 3.4 6.6-3.4M3.4 13.8l6.6 3.4 6.6-3.4" /></>,
  link: <><path d="M8.4 11.6 11.6 8.4" /><path d="M7.4 12.6 6 14a2.8 2.8 0 0 0 4 4l1.4-1.4M12.6 7.4 14 6a2.8 2.8 0 0 0-4-4L8.6 3.4" /></>,
  flask: <><path d="M8 3.4h4M8.8 3.4v4.4L4.6 15a1.4 1.4 0 0 0 1.2 2.1h8.4a1.4 1.4 0 0 0 1.2-2.1l-4.2-7.2V3.4" /><path d="M6.6 12.2h6.8" /></>,
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.55,
  ...rest
}: { name: IconName; size?: number; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export const FingerprintGlyph = ({ size = 84, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 96 96" width={size} height={size} fill="none" aria-hidden="true" {...rest}>
    <g stroke="currentColor" strokeWidth="2.1" strokeLinecap="round">
      <path d="M22 44c0-14 11.6-25 26-25s25 11 25 25" opacity=".95" />
      <path d="M31 47c0-9.4 7.4-17 17-17s17 7.6 17 17" opacity=".95" />
      <path d="M40 50c0-4.6 3.6-8.3 8-8.3s8 3.7 8 8.3v10" opacity=".95" />
      <path d="M22 48v10c0 4 .8 7.7 2.4 11" opacity=".8" />
      <path d="M31 50v12c0 4 1 7.7 3 11" opacity=".8" />
      <path d="M56 60v6c0 3.3-.7 6.4-2 9.2" opacity=".8" />
      <path d="M48 58v10c0 3.8-.6 7.4-1.7 10.8" opacity=".95" />
      <path d="M40 52v10" opacity=".7" />
      <path d="M65 51v7" opacity=".7" />
      <path d="M74 54v-9" opacity=".5" />
      <path d="M17 42v-2" opacity=".5" />
    </g>
  </svg>
);
