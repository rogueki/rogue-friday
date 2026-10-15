import type { OrbMode, ScenarioControlRequest } from "@friday/sdk";

/** Mock events of PLAN §44.5 and the orb mode each one forces (same mapping as the `pnpm scenario` CLI). */
export const EVENT_MODES = {
  listening: "listening",
  transcribing: "transcribing",
  thinking: "thinking",
  working: "working",
  speaking: "speaking",
  approval: "waiting_approval",
  error: "error",
  recovery: "success",
} as const satisfies Record<string, OrbMode>;
export type EventName = keyof typeof EVENT_MODES;

/** Multi-step events: the orb walks through these modes with a pause between the steps. */
export const EVENT_SEQUENCES = {
  "voice-pipeline": ["listening", "transcribing", "thinking", "speaking"],
  "error-recovery": ["error", "recovery"],
} as const satisfies Record<string, readonly EventName[]>;
export type SequenceName = keyof typeof EVENT_SEQUENCES;

export const SPEEDS = [0.5, 1, 2, 4, 10] as const;

export const TIME_UNITS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
export type TimeUnit = keyof typeof TIME_UNITS;

export function toMs(amount: number, unit: TimeUnit): number {
  return Math.max(1, Math.round(amount * TIME_UNITS[unit]));
}

export function forceOrbRequest(mode: OrbMode, extra: { text?: string; level?: number; progress?: number | null } = {}): ScenarioControlRequest {
  return {
    action: "force_orb_state",
    mode,
    ...(extra.text ? { activityText: extra.text } : {}),
    ...(extra.level !== undefined ? { audioLevel: extra.level } : {}),
    ...(extra.progress !== undefined ? { progress: extra.progress } : {}),
  };
}

/** Steps of an event or event sequence as orb modes. */
export function stepsOf(name: string): OrbMode[] {
  const sequence = (EVENT_SEQUENCES as Record<string, readonly EventName[]>)[name];
  const events: readonly string[] = sequence ?? [name];
  const modes = EVENT_MODES as Record<string, OrbMode | undefined>;
  return events.map((event) => modes[event]).filter((mode): mode is OrbMode => Boolean(mode));
}
