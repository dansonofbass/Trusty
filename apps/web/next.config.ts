import type { NextConfig } from "next";

// When the app is served over a public host (server IP / domain) rather than
// localhost, Next 15+ dev mode BLOCKS cross-origin requests to its /_next/* dev
// resources by default — which silently prevents the client bundle from
// hydrating (SSR HTML renders, but nothing is interactive). Allow the public
// host so dev-over-IP works. Driven by PUBLIC_HOST (the one deploy knob); no
// effect in a production build.
const publicHost = process.env.PUBLIC_HOST?.trim();
// Domain mode: the caddy proxy serves the app at APP_BASE_URL's host — allow
// that origin too so dev-over-domain hydrates.
const publicDomain = (() => {
  try { return new URL(process.env.APP_BASE_URL ?? "").hostname; } catch { return undefined; }
})();
const devOrigins = [publicHost, publicDomain].filter(
  (h): h is string => !!h && h !== "localhost",
);

const nextConfig: NextConfig = {
  // graph-core ships as TypeScript source; Next compiles it for the web bundle.
  transpilePackages: ["@constellation/graph-core"],
  ...(devOrigins.length ? { allowedDevOrigins: devOrigins } : {}),
};

export default nextConfig;
