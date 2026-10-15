import WebSocket from "ws";
import { isControlFrame, isFridayEvent, type FridayEvent } from "@friday/sdk";
import type { ConsoleSession } from "./session";

export interface WatchOptions {
  /** Stop after this many events. */
  count?: number;
  /** Stop after this many milliseconds. */
  forMs?: number;
  since?: number;
  /** Only events whose type starts with this prefix. */
  prefix?: string;
  onEvent(event: FridayEvent): void;
}

export function eventsUrl(baseUrl: string, eventsPath: string, since?: number): string {
  const url = new URL(eventsPath, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (since !== undefined) url.searchParams.set("since", String(since));
  return url.toString();
}

/** Streams events from `GET /api/v1/events` (path taken from `/meta`), answers pings, resolves with the event count. */
export async function watchEvents(session: ConsoleSession, options: WatchOptions): Promise<number> {
  const { data: meta } = await session.client.GET("/api/v1/meta");
  const path = meta?.eventsPath ?? "/api/v1/events";
  const origin = new URL(session.baseUrl).origin;
  const socket = new WebSocket(eventsUrl(session.baseUrl, path, options.since), {
    headers: { cookie: session.cookieHeader(), origin },
  });

  return await new Promise<number>((resolve, reject) => {
    let seen = 0;
    let finished = false;
    const finish = (error?: Error): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.close();
      if (error) reject(error);
      else resolve(seen);
    };
    const timer = setTimeout(() => finish(), options.forMs ?? 5_000);
    socket.on("error", (error) => finish(error));
    socket.on("close", () => finish());
    socket.on("message", (raw) => {
      let frame: unknown;
      try {
        frame = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (isControlFrame(frame)) {
        if (frame.kind === "ping") socket.send(JSON.stringify({ kind: "pong", ts: frame.ts }));
        return;
      }
      if (!isFridayEvent(frame)) return;
      if (options.prefix && !frame.type.startsWith(options.prefix)) return;
      seen += 1;
      options.onEvent(frame);
      if (options.count !== undefined && seen >= options.count) finish();
    });
  });
}
