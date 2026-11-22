/**
 * `npm run dev:phone`
 *
 * Starts the dev server on 0.0.0.0 and, once it answers, prints the LAN URLs
 * plus a terminal QR code so a phone can open the app without hunting for the
 * machine's IP address.
 */

import { spawn } from "node:child_process";
import os from "node:os";
import QR from "qrcode";

const port = Number(process.env.PORT ?? 3000);
const local = `http://127.0.0.1:${port}`;

/** Adapters that look like LAN but are not reachable from a phone. */
const VIRTUAL_INTERFACE = /^(utun|tun|tap|wg|ipsec|vmnet|vboxnet|docker|br-|veth|virbr|zt|tailscale|ppp|vEthernet|Hyper-V)/i;

interface Lan {
  name: string;
  address: string;
  virtual: boolean;
}

function lanAddresses(): Lan[] {
  const out: Lan[] = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      // 169.254.x.x is link-local (no router): a phone on the same Wi-Fi cannot
      // reach it, so never offer it as the "open this on your phone" address.
      if (info.address.startsWith("169.254.")) continue;
      out.push({ name, address: info.address, virtual: VIRTUAL_INTERFACE.test(name) });
    }
  }
  // Real Wi-Fi/Ethernet first, VPN/VM adapters last.
  return out.sort((a, b) => Number(a.virtual) - Number(b.virtual));
}

async function waitForServer(timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(local, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const child = spawn("npx", ["next", "dev", "-H", "0.0.0.0", "-p", String(port)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

const shutdown = () => {
  child.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const ready = await waitForServer();
child.on("exit", (code) => process.exit(code ?? 0));

if (!ready) {
  console.error("\n[dev:phone] the server did not answer in time — check the output above.\n");
} else {
  const addresses = lanAddresses();
  console.log("\n────────────────────────────────────────────────────────");
  console.log(" Scan to Pay — open this on a phone on the same Wi-Fi");
  console.log("────────────────────────────────────────────────────────");
  console.log(` this computer:  ${local}`);
  if (addresses.length === 0) {
    console.log(" no LAN IPv4 address found (are you on Wi-Fi?) — a tunnel such as");
    console.log(" `npx localtunnel --port 3000` will also work, HTTPS included.");
  }
  for (const { name, address, virtual } of addresses) {
    const url = `http://${address}:${port}`;
    console.log(` phone:          ${url}   [${name}]${virtual ? "  ← VPN/VM adapter, phones usually cannot reach this" : ""}`);
    if (virtual) continue;
    try {
      const qr = await QR.toString(url, { type: "terminal", small: true, margin: 1 });
      console.log(qr);
    } catch {
      /* QR is a convenience only */
    }
  }
  console.log(" Scan the square above with the camera, or type the URL.");
  console.log(" Phone still can't connect? Same Wi-Fi, firewall allows Node, and no");
  console.log(" router client-isolation. As a last resort: npx localtunnel --port " + port);
  console.log(" Demo PIN 2580 · reset data any time with POST /api/demo");
  console.log("────────────────────────────────────────────────────────\n");
}
