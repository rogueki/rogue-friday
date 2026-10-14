/**
 * Central query-key registry (PLAN §48.4). Every list key is `[domain, "list", filters]`, every detail key
 * `[domain, "detail", id]`, so the realtime reducer and mutations can target "all lists of a domain" by prefix.
 */
type Filters = object | undefined;

const domain = <D extends string>(name: D) => ({
  all: [name] as const,
  lists: () => [name, "list"] as const,
  list: (filters?: Filters) => [name, "list", filters ?? {}] as const,
  details: () => [name, "detail"] as const,
  detail: (id: string) => [name, "detail", id] as const,
});

export const queryKeys = {
  meta: ["meta"] as const,
  session: ["auth", "session"] as const,
  health: ["health"] as const,
  capabilities: ["capabilities"] as const,
  adapters: domain("adapters"),
  overview: ["overview"] as const,
  status: ["status"] as const,
  orb: ["orb", "status"] as const,
  tasks: domain("tasks"),
  activity: domain("activity"),
  agents: domain("agents"),
  approvals: domain("approvals"),
  notifications: domain("notifications"),
  memory: {
    ...domain("memory"),
    search: (query: string, limit?: number) => ["memory", "search", query, limit ?? null] as const,
  },
  communication: {
    channels: ["communication", "channels"] as const,
    threads: domain("communication-threads"),
    drafts: domain("communication-drafts"),
  },
  calendar: {
    events: domain("calendar-events"),
    conflicts: ["calendar-conflicts"] as const,
    briefings: ["calendar-briefings"] as const,
  },
  automations: {
    ...domain("automations"),
    runs: (id: string) => ["automations", "runs", id] as const,
  },
  files: domain("files"),
  audit: domain("audit"),
  research: domain("research"),
  system: {
    metrics: ["system", "metrics"] as const,
    services: ["system", "services"] as const,
    storage: ["system", "storage"] as const,
    models: ["system", "models"] as const,
  },
  voice: {
    status: ["voice", "status"] as const,
    devices: ["voice", "devices"] as const,
    metrics: ["voice", "metrics"] as const,
    profiles: ["voice", "profiles"] as const,
  },
  settings: {
    root: ["settings"] as const,
    layouts: ["settings", "layouts"] as const,
    themes: ["settings", "themes"] as const,
    adapters: ["settings", "adapters"] as const,
  },
  commands: {
    history: ["commands", "history"] as const,
  },
} as const;

/** Root keys that hold snapshot data and are refetched by the polling fallback and on `resync_required`. */
export const SNAPSHOT_ROOT_KEYS = [
  queryKeys.overview,
  queryKeys.status,
  queryKeys.orb,
  queryKeys.tasks.all,
  queryKeys.activity.all,
  queryKeys.agents.all,
  queryKeys.approvals.all,
  queryKeys.notifications.all,
  queryKeys.system.metrics,
  queryKeys.system.services,
  queryKeys.system.models,
  queryKeys.voice.status,
  queryKeys.capabilities,
  queryKeys.health,
] as const;
