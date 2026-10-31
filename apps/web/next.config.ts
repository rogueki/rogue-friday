import { resolve } from "node:path";
import type { NextConfig } from "next";

const WORKSPACE_PACKAGES = [
  "@friday/sdk",
  "@friday/ui",
  "@friday/design-tokens",
  "@friday/orb",
];

const apiOrigin = process.env.FRIDAY_API_ORIGIN ?? "http://127.0.0.1:3100";

const config: NextConfig = {
  output: "export",
  // Separate build dirs let several dev servers run side by side (e.g. parallel QA sessions); default ".next".
  ...(process.env.FRIDAY_NEXT_DIST_DIR ? { distDir: process.env.FRIDAY_NEXT_DIST_DIR } : {}),
  // Workspace libraries ship TypeScript source (conventions §1).
  transpilePackages: WORKSPACE_PACKAGES,
  images: { unoptimized: true },
  trailingSlash: false,
  reactStrictMode: true,
  // The dev indicator would sit on top of the persistent command bar (bottom left).
  devIndicators: false,
  // Libraries live outside apps/web; Turbopack needs the monorepo root to follow the symlinked packages.
  turbopack: {
    root: resolve(import.meta.dirname, "../.."),
  },
  // Next 16 would otherwise write an AGENTS.md into the app; local agent metadata is not part of the deployable app.
  agentRules: false,
  // Rewrites are ignored by `output: "export"` (the Control API serves the static build itself), so they are only
  // registered for `next dev`, where they proxy /api/* to the Control API (conventions §6).
  ...(process.env.NODE_ENV === "development"
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
        },
      }
    : {}),
};

export default config;
