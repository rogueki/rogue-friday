"use client";

/**
 * Stand-in for `MockStarter` in normal builds: `next.config.ts` aliases `@/lib/mock/MockStarter` to this module unless
 * `NEXT_PUBLIC_JARVIS_MSW=1`, so `@jarvis/mock-data` and `msw` never enter the production bundle.
 */
export default function MockStarterDisabled(): null {
  return null;
}
