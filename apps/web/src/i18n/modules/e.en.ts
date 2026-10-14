import type { deE } from "./e.de";

/** Module group E strings (English): availability states and follow-up fixes. A missing key is a compile error. */
export const enE: Record<keyof typeof deE, string> = {
  "avail.notConfigured.title": "Not connected",
  "avail.notConfigured.description": "No adapter is configured for “{module}”. The rest of the application keeps working.",
  "avail.offline.title": "Offline",
  "avail.offline.description": "{adapter} unreachable since {since}, last success {last}.",
  "avail.offline.descriptionNoSince": "{adapter} unreachable, last success {last}.",
  "avail.offline.recovering": "{adapter} is reconnecting, last success {last}.",
  "avail.offline.never": "none yet",
  "avail.offline.reason": "Last message: {reason}",
  "avail.offline.cached": "Showing cached data.",
  "avail.unsupported.title": "Reading not available",
  "avail.unsupported.description": "The adapter “{adapter}” does not offer {capability}.",
  "avail.unsupported.descriptionNoAdapter": "The capability {capability} is not offered.",
  "avail.adapterFor": "Adapter for {module}",
  "avail.adapterUnknown": "Adapter",

  "calendar.grid.scroll": "scroll with the arrow keys",

  "voice.nav.offline": "Voice service offline",
  "voice.nav.notConfigured": "Voice not connected",
  "voice.nav.recovering": "Voice service reconnecting …",

  "core.offline": "Offline",
  "core.system.degraded": "Degraded",

  "system.models.names": "Models",
  "system.models.more": "+{count} more",
  "system.models.noNames": "No models reported",
};
