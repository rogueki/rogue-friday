import { useSyncExternalStore } from 'react';

/**
 * In-memory stand-in for `next/navigation` (Storybook has no Next.js router). Mirrors the real behaviour the feature
 * pages rely on: `push`/`replace` change the query string, subscribers re-render, so drawers driven by `?task=…`
 * and view switches (`?view=list`) work inside a story. The URL of the Storybook iframe is never touched.
 */
let pathname = '/';
let search = '';
let cached: { key: string; params: URLSearchParams } = { key: '', params: new URLSearchParams() };
const listeners = new Set<() => void>();

const emit = (): void => listeners.forEach((listener) => listener());

function navigate(target: string): void {
  const [path = '/', query = ''] = target.split('?');
  pathname = path || '/';
  search = query.split('#')[0] ?? '';
  emit();
}

/** Called by the domain stage before a story renders to set route and query (`/tasks`, `view=list`). */
export function setStoryLocation(path: string, query = ''): void {
  pathname = path;
  search = query.replace(/^\?/, '');
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

const router = {
  push: (target: string): void => navigate(target),
  replace: (target: string): void => navigate(target),
  back: (): void => undefined,
  forward: (): void => undefined,
  refresh: (): void => undefined,
  prefetch: (): void => undefined,
};

export const useRouter = () => router;
export const usePathname = (): string => useSyncExternalStore(subscribe, () => pathname, () => pathname);
export const useSearchParams = (): URLSearchParams => useSyncExternalStore(subscribe, snapshot, snapshot);
