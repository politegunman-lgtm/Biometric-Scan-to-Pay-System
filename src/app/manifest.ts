import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scan to Pay — biometric mobile money",
    short_name: "Scan to Pay",
    description:
      "One-tap biometric payments for MTN MoMo and other African mobile money services: offline vouchers, fraud protection and a cloud-synced history.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#06080A",
    theme_color: "#06080A",
    categories: ["finance", "utilities"],
    icons: [
      { src: "/icons/app-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/app-icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
