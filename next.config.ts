import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Low-latency server: keep API routes dynamic, no caching of live feeds.
  experimental: {
    // allows route handlers to stream SSE without buffering
    proxyTimeout: 120_000,
  },
  eslint: { ignoreDuringBuilds: true },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/api/stream",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-transform" },
          { key: "X-Accel-Buffering", value: "no" },
        ],
      },
    ];
  },
};

export default nextConfig;
