import type { deA } from "./a.de";

/** Module group A strings (English). A missing key is a compile error. */
export const enA: Record<keyof typeof deA, string> = {};
