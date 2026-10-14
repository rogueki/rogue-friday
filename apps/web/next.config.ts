import { resolve } from "node:path";
import type { NextConfig } from "next";

const WORKSPACE_PACKAGES = [
  "@jarvis/sdk",
  "@jarvis/ui",
  "@jarvis/design-tokens",
  "@jarvis/orb",
  "@jarvis/mock-data",
];

const apiOrigin = process.env.JARVIS_API_ORIGIN ?? "http://127.0.0.1:3100";
const standaloneMock = process.env.NEXT_PUBLIC_JARVIS_MSW === "1";

const config: NextConfig = {
  output: "export",
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
    // @jarvis/mock-data's barrel also contains the Node test setup (`msw/node`), which msw excludes for the browser
    // condition. The browser never calls it, so an empty module satisfies the resolver.
    resolveAlias: {
      "msw/node": { browser: "./src/lib/mock/empty.ts" },
      // Normal builds must not contain the mock platform: the starter resolves to an empty module (see its docs).
      ...(standaloneMock ? {} : { "@/lib/mock/MockStarter": "./src/lib/mock/MockStarter.disabled.tsx" }),
    },
  },
  // Next 16 would otherwise write an AGENTS.md into the app; local agent metadata is not part of the deployable app.
  agentRules: false,
  // Rewrites are ignored by `output: "export"` (the Control API serves the static build itself), so they are only
  // registered for `next dev`, where they proxy /api/* to the Control API (conventions §6).
  ...(process.env.NODE_ENV === "development" && !standaloneMock
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
        },
      }
    : {}),
};

export default config;
