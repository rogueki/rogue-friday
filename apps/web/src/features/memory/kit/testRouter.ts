import { useSyncExternalStore } from "react";
import { vi } from "vitest";

/**
 * Test double for `next/navigation` that behaves like the real router for query parameters: `push`/`replace` update the
 * URL and re-render subscribers, so drawers driven by `?memory=…` open and close in component tests.
 * Use: `vi.mock("next/navigation", async () => (await import("../memory/kit/testRouter")).navigationMock);`
 */
let pathname = "/";
let search = "";
let cached: { key: string; params: URLSearchParams } = { key: "", params: new URLSearchParams() };
const listeners = new Set<() => void>();

const emit = (): void => listeners.forEach((listener) => listener());
function navigate(target: string): void {
  const [path = "/", query = ""] = target.split("?");
  pathname = path || "/";
  search = query;
  emit();
}

export const push = vi.fn((target: string) => navigate(target));
export const replace = vi.fn((target: string) => navigate(target));

/** Resets URL and call history between tests. */
export function resetRouter(path = "/", query = ""): void {
  pathname = path;
  search = query;
  push.mockClear();
  replace.mockClear();
  emit();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

function snapshot(): URLSearchParams {
  if (cached.key !== search) cached = { key: search, params: new URLSearchParams(search) };
  return cached.params;
}

export const navigationMock = {
  useRouter: () => ({ push, replace, back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => useSyncExternalStore(subscribe, () => pathname, () => pathname),
  useSearchParams: () => useSyncExternalStore(subscribe, snapshot, snapshot),
};
