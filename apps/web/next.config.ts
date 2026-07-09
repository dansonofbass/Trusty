import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // graph-core ships as TypeScript source; Next compiles it for the web bundle.
  transpilePackages: ["@constellation/graph-core"],
};

export default nextConfig;
