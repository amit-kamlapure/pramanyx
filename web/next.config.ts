import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next's own security-upgrade policy (`next upgrade --agent`): offer an upgrade only when a published advisory
    // covers the installed version. Already Next's default; said here, as its security upgrade asks (2026-11-23).
    agentUpgrade: "security",
  },
};

export default nextConfig;
