import type { Tone } from '@jarvis/design-tokens';

export type { Tone };

export type PanelLevel = 1 | 2 | 3;
export type PanelTone = 'cyan' | 'gold' | 'amber' | 'red';
export type PanelCut = 'tl-br' | 'tr-bl' | 'all' | 'tl' | 'br' | 'none';
export type PanelCutSize = 'sm' | 'md' | 'lg';
export type Corner = 'tl' | 'tr' | 'br' | 'bl';

export type HealthState = 'ok' | 'degraded' | 'down' | 'unknown' | 'maintenance';
export type FreshnessState = 'fresh' | 'stale' | 'unknown' | 'offline-cache';
export type Severity = 'info' | 'tip' | 'warn' | 'critical' | 'live' | 'ok';

/** Result of a capability check, passed by the app; the UI only renders it. */
export type Capability = 'available' | 'read-only' | 'missing';

export const severityTone: Record<Severity, Tone> = {
  info: 'cyan',
  tip: 'green',
  warn: 'amber',
  critical: 'red',
  live: 'green',
  ok: 'green',
};

export const healthTone: Record<HealthState, Tone> = {
  ok: 'green',
  degraded: 'amber',
  down: 'red',
  unknown: 'muted',
  maintenance: 'blue',
};
