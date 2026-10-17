import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // One static artifact is embedded by Tauri and served by the LAN bridge.
  // Keeping a single artifact prevents desktop/browser UI version drift.
  output: "export",
  reactStrictMode: false,
};

export default nextConfig;
