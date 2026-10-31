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
  adapters: {
    ...domain("adapters"),
    health: (id: string) => ["adapters", "health", id] as const,
    /** Redacted log lines of one adapter (`GET /adapters/{id}/logs`). */
    logs: (id: string, filters?: Filters) => ["adapters", "logs", id, filters ?? {}] as const,
  },
  overview: ["overview"] as const,
  status: ["status"] as const,
  orb: ["orb", "status"] as const,
  tasks: domain("tasks"),
  activity: domain("activity"),
  agents: domain("agents"),
  approvals: {
    ...domain("approvals"),
    /** Approval token issued by GET /approvals/{id} (`X-Approval-Token`); kept apart from the detail entry. */
    token: (id: string) => ["approvals", "token", id] as const,
  },
  notifications: domain("notifications"),
  quietMode: ["quiet-mode"] as const,
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
    versions: (id: string) => ["automations", "versions", id] as const,
  },
  files: { ...domain("files"), preview: (id: string) => ["files", "preview", id] as const },
  audit: domain("audit"),
  research: {
    ...domain("research"),
    sources: (id: string) => ["research", "sources", id] as const,
    findings: (id: string) => ["research", "findings", id] as const,
    artifacts: (id: string) => ["research", "artifacts", id] as const,
  },
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
    /** One enrollment job (`GET /voice/enrollments/{id}`). */
    enrollment: (id: string) => ["voice", "enrollments", id] as const,
  },
  settings: {
    root: ["settings"] as const,
    layouts: ["settings", "layouts"] as const,
    themes: ["settings", "themes"] as const,
    adapters: ["settings", "adapters"] as const,
  },
  skills: ["skills"] as const,
  onboarding: ["onboarding"] as const,
  commands: {
    history: ["commands", "history"] as const,
  },
  dev: {
    scenarios: ["dev", "scenarios"] as const,
    state: ["dev", "scenarios", "state"] as const,
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
  queryKeys.memory.all,
  queryKeys.communication.channels,
  queryKeys.communication.threads.all,
  queryKeys.communication.drafts.all,
  queryKeys.calendar.events.all,
  queryKeys.calendar.conflicts,
  queryKeys.calendar.briefings,
  queryKeys.automations.all,
  queryKeys.files.all,
  queryKeys.research.all,
  queryKeys.system.metrics,
  queryKeys.system.services,
  queryKeys.system.models,
  queryKeys.voice.status,
  queryKeys.capabilities,
  queryKeys.health,
] as const;
