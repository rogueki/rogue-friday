/** Browser storage access that never throws: private windows, blocked site data and full quotas just mean "no cache". */
export const STORAGE_KEY = "friday.offlineCache.v1";

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readStored(): string | null {
  try {
    return store()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Returns false when nothing could be written (quota, blocked storage); the previous snapshot is removed in that case. */
export function writeStored(value: string): boolean {
  const target = store();
  if (!target) return false;
  try {
    target.setItem(STORAGE_KEY, value);
    return true;
  } catch {
    try {
      target.removeItem(STORAGE_KEY);
    } catch {
      /* storage is unusable; the cache simply stays off */
    }
    return false;
  }
}

export function clearStored(): void {
  try {
    store()?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear if storage is unusable */
  }
}
