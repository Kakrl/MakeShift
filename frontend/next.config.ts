import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
    resolveAlias: {
      fs: "./src/shims/empty.ts",
    },
  },
};

export default nextConfig;
