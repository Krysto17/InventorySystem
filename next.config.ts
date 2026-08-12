import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile in the home directory makes Next guess the wrong workspace
  // root and warn on every build. This repo IS the root.
  turbopack: { root: __dirname },
};

export default nextConfig;
