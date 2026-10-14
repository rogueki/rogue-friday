export interface EventsEndpoint {
  eventsPath: string;
  eventsOrigin?: string;
}

interface LocationLike {
  protocol: string;
  host: string;
}

function toWebSocketOrigin(origin: string): string {
  return origin.replace(/^http(s?):/i, "ws$1:").replace(/\/+$/, "");
}

/**
 * `meta.eventsOrigin + meta.eventsPath`, or, without an explicit origin, the page origin with ws/wss derived from the
 * page protocol (PLAN §12). `since` is appended as the replay cursor.
 */
export function buildEventsUrl(meta: EventsEndpoint, since: number | null, location: LocationLike = window.location): string {
  const origin = meta.eventsOrigin
    ? toWebSocketOrigin(meta.eventsOrigin)
    : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
  const path = meta.eventsPath.startsWith("/") ? meta.eventsPath : `/${meta.eventsPath}`;
  const url = new URL(`${origin}${path}`);
  if (since !== null) url.searchParams.set("since", String(since));
  return url.toString();
}
