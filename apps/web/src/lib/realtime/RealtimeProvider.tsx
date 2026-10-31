"use client";

import type { ActivityEvent } from "@friday/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";
import { pushAudioLevel, resetAudioLevels } from "@/features/orb/audioStore";
import { createRealtimeOrbRouter } from "@/features/orb/bridge/realtimeOrb";
import { emitNavigationRequest } from "@/features/tour/navigationRequests";
import { fetchActivitySince } from "../api/domains/activity";
import { useMeta } from "../api/domains/core";
import { SNAPSHOT_ROOT_KEYS } from "../api/queryKeys";
import { applyActivityBackfill, applyEvent } from "./applyEvent";
import { RealtimeClient } from "./client";
import { useRealtimeStore } from "./store";
import { webSocketTransportFactory } from "./transport";
import { buildEventsUrl } from "./url";

/**
 * Owns the single RealtimeClient of the app. It is created once `meta` (events endpoint) is known and the session is
 * authenticated, wires events into the query cache and exposes the connection status through `useRealtimeStatus`.
 */
export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const queryClient = useQueryClient();
  const meta = useMeta();
  const metaData = meta.data;
  const eventsPath = metaData?.eventsPath;
  const eventsOrigin = metaData?.eventsOrigin;
  const clientRef = useRef<RealtimeClient | null>(null);

  useEffect(() => {
    if (!enabled || !eventsPath) return;
    useRealtimeStore.getState().setTransport("websocket");

    const refreshSnapshots = (): void => {
      for (const key of SNAPSHOT_ROOT_KEYS) void queryClient.invalidateQueries({ queryKey: key, refetchType: "active" });
    };

    // Routes events to the orb controller (after the cache update, so cache-backed facts such as working agents are current).
    const orbRouter = createRealtimeOrbRouter(queryClient);

    const client = new RealtimeClient({
      getUrl: (since) => buildEventsUrl({ eventsPath, eventsOrigin }, since),
      transportFactory: webSocketTransportFactory,
      callbacks: {
        onEvent: (event) => {
          try {
            if (event.type === "friday.ui.navigation_requested") emitNavigationRequest(event.data);
            else if (event.type === "friday.voice.audio_level") pushAudioLevel(event.data.direction, event.data.level);
            else applyEvent(queryClient, event);
          } finally {
            orbRouter.route(event);
          }
        },
        onGap: ({ lastApplied }) => {
          orbRouter.resync();
          // Missed events: refetch the snapshots (covers every domain) and replay the activity tail (covers the feed).
          refreshSnapshots();
          fetchActivitySince(lastApplied)
            .then((items: ActivityEvent[]) => applyActivityBackfill(queryClient, items))
            .catch(() => undefined); // the snapshot refresh above already restores consistency
        },
        onResync: () => {
          orbRouter.resync();
          resetAudioLevels();
          refreshSnapshots();
        },
        onPoll: refreshSnapshots,
        onStateChange: (snapshot) => {
          useRealtimeStore.getState().set(snapshot);
          orbRouter.setConnection(snapshot.state);
        },
      },
    });
    clientRef.current = client;
    client.start();

    const onOnline = (): void => client.notifyOnline();
    const onOffline = (): void => client.notifyOffline();
    const onVisibility = (): void => client.notifyVisibility(document.visibilityState === "visible");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    if (typeof navigator !== "undefined" && navigator.onLine === false) client.notifyOffline();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
      client.stop();
      orbRouter.dispose();
      clientRef.current = null;
    };
  }, [enabled, eventsPath, eventsOrigin, queryClient]);

  return <>{children}</>;
}
