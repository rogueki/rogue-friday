"use client";

import { create } from "zustand";
import type { RealtimeSnapshot, RealtimeState } from "./client";

interface RealtimeStore extends RealtimeSnapshot {
  /** Transport label for the system page. */
  transport: "websocket";
  set: (snapshot: RealtimeSnapshot) => void;
  setTransport: (transport: "websocket") => void;
}

export const useRealtimeStore = create<RealtimeStore>((set) => ({
  state: "connecting",
  roundtripMs: null,
  lastEventAt: null,
  sequence: null,
  failures: 0,
  transport: "websocket",
  set: (snapshot) => set(snapshot),
  setTransport: (transport) => set({ transport }),
}));

export interface RealtimeStatus {
  state: RealtimeState;
  roundtripMs: number | null;
  lastEventAt: number | null;
  sequence: number | null;
}

/** Event-stream status for the top bar and the system page ("Event Stream: online · 28 ms · vor 2 s", PLAN §12.6). */
export function useRealtimeStatus(): RealtimeStatus {
  const state = useRealtimeStore((s) => s.state);
  const roundtripMs = useRealtimeStore((s) => s.roundtripMs);
  const lastEventAt = useRealtimeStore((s) => s.lastEventAt);
  const sequence = useRealtimeStore((s) => s.sequence);
  return { state, roundtripMs, lastEventAt, sequence };
}
