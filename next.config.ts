import os from "node:os";
import type { NextConfig } from "next";

/**
 * Dev-server origins.
 *
 * Next blocks requests for `/_next/*` dev assets when the Host header is not
 * allow-listed. That check is invisible on localhost but breaks the app when a
 * phone opens `http://192.168.x.x:3000`: the HTML arrives, the JS does not, and
 * the page sits forever on the initial "Opening secure channel" screen.
 *
 * Rather than hard-coding one laptop's address, enumerate every non-loopback
 * IPv4 on this machine and add private-range wildcards for machines whose DHCP
 * lease changes between runs.
 */
function localOrigins(): string[] {
  const hosts = new Set<string>([
    "localhost",
    "127.0.0.1",
    "::1",
    // Sandbox/preview proxies used while developing in the cloud.
    "*.e2b.app",
    "*.arena.ai",
    // Private ranges: covers a phone on the same LAN after a new DHCP lease.
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
  ]);

  try {
    for (const infos of Object.values(os.networkInterfaces())) {
      for (const info of infos ?? []) {
        if (info.family === "IPv4" && !info.internal) hosts.add(info.address);
      }
    }
  } catch {
    /* config must never fail because of interface enumeration */
  }

  return [...hosts];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: localOrigins(),
  experimental: {
    optimizePackageImports: ["@fontsource-variable/inter"],
  },
};

export default nextConfig;
