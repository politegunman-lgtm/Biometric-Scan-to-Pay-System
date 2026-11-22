import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is served behind the sandbox preview proxy (https://{port}-{id}.e2b.app).
  // Next's dev server needs to know that foreign origin is allowed to load dev assets.
  allowedDevOrigins: ["*.e2b.app", "*.arena.ai", "localhost", "127.0.0.1"],
  experimental: {
    optimizePackageImports: ["@fontsource-variable/inter"],
  },
};

export default nextConfig;
