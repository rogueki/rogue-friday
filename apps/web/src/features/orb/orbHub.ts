import { useSyncExternalStore } from "react";
import type { OrbMode } from "@friday/sdk";
import type { OrbAudioSources } from "./bridge/audioSources";
import { createDeferred } from "./bridge/deferred";
import type { OrbEventBridge } from "./orbApi";
import type { OrbRuntime } from "./orbRuntime";

/**
 * Entry point of the main bundle into the orb runtime. It imports no value from `@friday/orb`: the realtime layer and
 * the browser audio path talk to these deferred handles, which forward to the real bridge once the orb chunk (three.js)
 * has loaded and queue calls until then.
 */
export type OrbAudioSink = Pick<OrbAudioSources, "pushServiceInput" | "pushServiceOutput" | "beginSpeech" | "endSpeech" | "reset" | "setLocalInput" | "setLocalOutput">;

export const orbBridgeHandle = createDeferred<OrbEventBridge>();
export const orbAudioHandle = createDeferred<OrbAudioSink>();

let loading: Promise<OrbRuntime> | null = null;

/** Loads (once) the orb chunk and creates the controller singleton. The returned runtime is already attached to the handles. */
export function loadOrbRuntime(): Promise<OrbRuntime> {
  loading ??= import("./orbRuntime").then((module) => module.getOrbRuntime());
  return loading;
}

/**
 * Low-rate summary of the controller state for HTML around the orb (status strip of the AI-core panel, voice panel). The
 * runtime publishes it on every controller change; it is `null` until the orb chunk has loaded, then consumers fall back to
 * the server snapshot. Audio levels are deliberately not part of it (they would re-render at audio rate).
 */
export interface OrbStatusSummary {
  mode: OrbMode;
  activityText?: string;
  progress: number | null;
  progressMode: "none" | "determinate" | "indeterminate";
  activeAgentCount: number;
  currentAgentName?: string;
}

let summary: OrbStatusSummary | null = null;
const summaryListeners = new Set<() => void>();

const same = (a: OrbStatusSummary | null, b: OrbStatusSummary): boolean =>
  a !== null &&
  a.mode === b.mode &&
  a.activityText === b.activityText &&
  a.progress === b.progress &&
  a.progressMode === b.progressMode &&
  a.activeAgentCount === b.activeAgentCount &&
  a.currentAgentName === b.currentAgentName;

export function publishOrbStatus(next: OrbStatusSummary): void {
  if (same(summary, next)) return;
  summary = next;
  for (const listener of summaryListeners) listener();
}

export function clearOrbStatus(): void {
  if (summary === null) return;
  summary = null;
  for (const listener of summaryListeners) listener();
}

const subscribeSummary = (listener: () => void): (() => void) => {
  summaryListeners.add(listener);
  return () => {
    summaryListeners.delete(listener);
  };
};

/** The arbitrated orb status (server truth + local voice facts), or `null` while the orb runtime is not loaded. */
export function useOrbControllerStatus(): OrbStatusSummary | null {
  return useSyncExternalStore(subscribeSummary, () => summary, () => null);
}
