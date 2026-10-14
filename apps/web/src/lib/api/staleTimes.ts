/** Stale time per domain in ms. Realtime events keep the caches fresh, so only slow-moving data gets long values. */
export const staleTimes = {
  meta: 5 * 60_000,
  session: 60_000,
  capabilities: 60_000,
  settings: 60_000,
  health: 15_000,
  overview: 5_000,
  status: 5_000,
  orb: 2_000,
  tasks: 10_000,
  activity: 5_000,
  agents: 10_000,
  approvals: 5_000,
  notifications: 10_000,
  communication: 30_000,
  calendar: 60_000,
  system: 5_000,
  voice: 5_000,
  memory: 60_000,
  files: 30_000,
  automations: 30_000,
  commands: 30_000,
} as const;

export type StaleDomain = keyof typeof staleTimes;
