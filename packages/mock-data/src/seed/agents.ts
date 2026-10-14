import type { Agent, AgentStatus, ReasoningLevel } from "@jarvis/sdk";
import { DAY, HOUR, MIN, type SeedContext } from "./context";
import type { AgentKey, Story } from "./story";

interface Persona {
  key: AgentKey;
  name: string;
  role: string;
  description: string;
  model: string;
  reasoning: ReasoningLevel;
  capabilities: string[];
  tools: string[];
  accent: string;
  status: AgentStatus;
  task?: keyof Story["tasks"];
  successRate: number;
  completed: number;
  failed: number;
  avgMs: number;
  tokens: number;
  cost: number;
  config: Record<string, unknown>;
}

const PERSONAS: Persona[] = [
  {
    key: "coding",
    name: "Coding-Agent",
    role: "Softwareentwicklung",
    description: "Schreibt, refaktoriert und testet Code in den Projekt-Repositories unter D:\\Projekte.",
    model: "Kimi K3",
    reasoning: "high",
    capabilities: ["Code-Generierung", "Refactoring", "Testerstellung", "Code-Review", "Git-Operationen"],
    tools: ["fs.read", "fs.write", "git.diff", "shell.exec"],
    accent: "#4DD6FF",
    status: "working",
    task: "apiClient",
    successRate: 0.93,
    completed: 148,
    failed: 11,
    avgMs: 14 * MIN,
    tokens: 5_820_000,
    cost: 41.7,
    config: { workspace: "D:\\Projekte", shell: "gesperrt außer Build-Befehle", maxParallelFiles: 12 },
  },
  {
    key: "recherche",
    name: "Recherche-Agent",
    role: "Web- und Quellenrecherche",
    description: "Sammelt Quellen, bewertet deren Verlässlichkeit und fasst Ergebnisse mit Belegen zusammen.",
    model: "Kimi K3",
    reasoning: "medium",
    capabilities: ["Websuche", "Quellenbewertung", "Zusammenfassung", "Preisvergleich"],
    tools: ["web.search", "web.fetch", "memory.search"],
    accent: "#2BE3B6",
    status: "working",
    task: "bueromoebel",
    successRate: 0.96,
    completed: 212,
    failed: 9,
    avgMs: 22 * MIN,
    tokens: 9_410_000,
    cost: 66.3,
    config: { maxSourcesPerProject: 40, domainBlocklist: ["spam-angebote.example"], citeSources: true },
  },
  {
    key: "memory",
    name: "Memory-Agent",
    role: "Gedächtnispflege",
    description: "Konsolidiert Erinnerungen, erkennt Widersprüche und markiert veraltete Einträge zur Prüfung.",
    model: "Qwen Local",
    reasoning: "low",
    capabilities: ["Deduplizierung", "Konflikterkennung", "Verknüpfung von Entitäten"],
    tools: ["memory.search", "memory.write"],
    accent: "#B28CFF",
    status: "idle",
    successRate: 0.98,
    completed: 87,
    failed: 2,
    avgMs: 3 * MIN,
    tokens: 1_150_000,
    cost: 0,
    config: { writeMode: "vorschlagen", respectLocks: true },
  },
  {
    key: "browser",
    name: "Browser-Agent",
    role: "Browser-Automatisierung",
    description: "Bedient Webseiten in einer isolierten Sitzung, liest Portale aus und erstellt Screenshots.",
    model: "Kimi K3",
    reasoning: "medium",
    capabilities: ["Navigation", "Formular-Erkennung", "Screenshots", "Portal-Abfrage"],
    tools: ["browser.navigate", "browser.screenshot", "web.fetch"],
    accent: "#FFB347",
    status: "idle",
    successRate: 0.88,
    completed: 64,
    failed: 9,
    avgMs: 9 * MIN,
    tokens: 2_040_000,
    cost: 14.2,
    config: { profile: "isoliert", downloadsDir: "D:\\Jarvis\\Downloads", allowLogin: false },
  },
  {
    key: "task",
    name: "Task-Agent",
    role: "Aufgabenplanung",
    description: "Zerlegt Aufträge in Schritte, verteilt sie an Fachagenten und überwacht Fristen.",
    model: "Kimi K3",
    reasoning: "high",
    capabilities: ["Planung", "Priorisierung", "Delegation", "Fristenüberwachung"],
    tools: ["memory.search", "calendar.read", "task.create"],
    accent: "#FF7A59",
    status: "waiting",
    task: "steuer",
    successRate: 0.94,
    completed: 301,
    failed: 14,
    avgMs: 6 * MIN,
    tokens: 7_630_000,
    cost: 52.9,
    config: { maxParallelTasks: 6, escalateAfterMinutes: 90 },
  },
  {
    key: "system",
    name: "System-Agent",
    role: "Systemwartung",
    description: "Überwacht Dienste, Speicher und Updates auf dem Windows-Host und im WSL2-Subsystem.",
    model: "Qwen Local",
    reasoning: "low",
    capabilities: ["Dienstüberwachung", "Update-Planung", "Backup-Prüfung", "Speicheranalyse"],
    tools: ["system.metrics", "system.service", "fs.read"],
    accent: "#7DF9A1",
    status: "idle",
    successRate: 0.9,
    completed: 129,
    failed: 13,
    avgMs: 4 * MIN,
    tokens: 960_000,
    cost: 0,
    config: { host: "windows-worker", writeAccess: "nur nach Freigabe", checkIntervalSeconds: 60 },
  },
  {
    key: "kommunikation",
    name: "Kommunikations-Agent",
    role: "Mail und Nachrichten",
    description: "Sortiert Posteingänge, fasst Threads zusammen und bereitet Antwortentwürfe vor. Versendet nie ohne Freigabe.",
    model: "Kimi K3",
    reasoning: "medium",
    capabilities: ["Mail-Triage", "Thread-Zusammenfassung", "Entwurfserstellung", "Terminextraktion"],
    tools: ["mail.read", "mail.draft", "telegram.read"],
    accent: "#4D9BFF",
    status: "working",
    task: "postfach",
    successRate: 0.95,
    completed: 354,
    failed: 12,
    avgMs: 5 * MIN,
    tokens: 12_300_000,
    cost: 88.4,
    config: { sendPolicy: "nur mit Freigabe", signature: "Erik Brandt", tone: "sachlich-freundlich" },
  },
  {
    key: "kalender",
    name: "Kalender-Agent",
    role: "Terminverwaltung",
    description: "Erkennt Konflikte, schlägt Termine vor und erstellt Briefings für anstehende Meetings.",
    model: "Qwen Local",
    reasoning: "low",
    capabilities: ["Konflikterkennung", "Terminvorschläge", "Meeting-Briefing", "Zeitzonen"],
    tools: ["calendar.read", "calendar.propose", "mail.read"],
    accent: "#FFD166",
    status: "idle",
    successRate: 0.97,
    completed: 176,
    failed: 5,
    avgMs: 2 * MIN,
    tokens: 1_480_000,
    cost: 0,
    config: { workingHours: "08:00-17:30", minFocusBlockMinutes: 90, timeZone: "Europe/Berlin" },
  },
];

export function buildAgents(ctx: SeedContext, story: Story): Agent[] {
  return PERSONAS.map((persona) => {
    const working = persona.status === "working" || persona.status === "waiting";
    const runtimeMs = working ? ctx.rng.int(8, 52) * MIN : null;
    const agent: Agent = {
      id: story.agents[persona.key],
      version: ctx.rng.int(2, 9),
      createdAt: ctx.at(-30 * DAY),
      updatedAt: ctx.at(-ctx.rng.int(1, 12) * MIN),
      source: ctx.src("agents"),
      name: persona.name,
      role: persona.role,
      description: persona.description,
      status: persona.status,
      currentTaskId: persona.task ? story.tasks[persona.task] : null,
      model: persona.model,
      reasoningLevel: persona.reasoning,
      capabilities: persona.capabilities,
      activeTools: working ? persona.tools.slice(0, 2) : [],
      startedAt: working && runtimeMs ? ctx.at(-runtimeMs) : null,
      runtimeMs,
      heartbeatAt: ctx.at(-ctx.rng.int(1, 20) * 1000),
      successRate: persona.successRate,
      performance: {
        avgTaskDurationMs: persona.avgMs,
        tasksCompleted: persona.completed,
        tasksFailed: persona.failed,
        tokensUsed: persona.tokens,
        costEur: persona.cost,
      },
      lastActivityAt: ctx.at(-ctx.rng.int(5, 240) * 1000),
      lastError: null,
      accent: persona.accent,
      configuration: persona.config,
    };
    if (persona.key === "system") {
      agent.lastError = {
        code: "ADAPTER_UNAVAILABLE",
        message: "Windows-Worker antwortete beim Update-Lauf nicht innerhalb von 30 Sekunden.",
        severity: "error",
        retryable: true,
        correlationId: ctx.id("corr"),
        details: { taskKey: "windowsUpdates", host: "windows-worker" },
      };
      agent.lastActivityAt = ctx.at(-3 * HOUR);
    }
    return agent;
  });
}

const BULK_ROLES: { role: string; base: string; tools: string[]; capabilities: string[] }[] = [
  { role: "Web- und Quellenrecherche", base: "Recherche-Agent", tools: ["web.search", "web.fetch"], capabilities: ["Websuche", "Quellenbewertung"] },
  { role: "Softwareentwicklung", base: "Coding-Agent", tools: ["fs.read", "fs.write", "git.diff"], capabilities: ["Code-Generierung", "Refactoring"] },
  { role: "Mail und Nachrichten", base: "Kommunikations-Agent", tools: ["mail.read", "mail.draft"], capabilities: ["Mail-Triage", "Entwurfserstellung"] },
  { role: "Browser-Automatisierung", base: "Browser-Agent", tools: ["browser.navigate", "browser.screenshot"], capabilities: ["Navigation", "Screenshots"] },
  { role: "Terminverwaltung", base: "Kalender-Agent", tools: ["calendar.read", "calendar.propose"], capabilities: ["Konflikterkennung", "Terminvorschläge"] },
  { role: "Systemwartung", base: "System-Agent", tools: ["system.metrics", "system.service"], capabilities: ["Dienstüberwachung", "Backup-Prüfung"] },
  { role: "Gedächtnispflege", base: "Memory-Agent", tools: ["memory.search", "memory.write"], capabilities: ["Deduplizierung", "Konflikterkennung"] },
  { role: "Aufgabenplanung", base: "Task-Agent", tools: ["task.create", "calendar.read"], capabilities: ["Planung", "Delegation"] },
];

/** Additional workers for the high-load profile; statuses are drawn from the seeded stream. */
export function buildBulkAgents(ctx: SeedContext, count: number, startIndex: number): Agent[] {
  const statuses: [AgentStatus, number][] = [
    ["idle", 40],
    ["working", 32],
    ["waiting", 10],
    ["paused", 6],
    ["starting", 4],
    ["error", 4],
    ["offline", 4],
  ];
  const agents: Agent[] = [];
  for (let i = 0; i < count; i++) {
    const template = BULK_ROLES[(startIndex + i) % BULK_ROLES.length] as (typeof BULK_ROLES)[number];
    const status = ctx.rng.weighted(statuses);
    const working = status === "working" || status === "waiting";
    const runtimeMs = working ? ctx.rng.int(1, 120) * MIN : null;
    const completed = ctx.rng.int(5, 400);
    const failed = ctx.rng.int(0, Math.max(1, Math.floor(completed * 0.15)));
    agents.push({
      id: ctx.id("agent"),
      version: ctx.rng.int(1, 12),
      createdAt: ctx.at(-ctx.rng.int(5, 90) * DAY),
      updatedAt: ctx.at(-ctx.rng.int(1, 600) * 1000),
      source: ctx.src("agents"),
      name: `${template.base} ${String(startIndex + i + 1).padStart(3, "0")}`,
      role: template.role,
      status,
      currentTaskId: null,
      model: ctx.rng.chance(0.7) ? "Kimi K3" : "Qwen Local",
      reasoningLevel: ctx.rng.pick<ReasoningLevel>(["none", "low", "medium", "high", "max"]),
      capabilities: template.capabilities,
      activeTools: working ? template.tools.slice(0, 1) : [],
      startedAt: runtimeMs ? ctx.at(-runtimeMs) : null,
      runtimeMs,
      heartbeatAt: status === "offline" ? ctx.at(-ctx.rng.int(10, 90) * MIN) : ctx.at(-ctx.rng.int(1, 30) * 1000),
      successRate: Math.round((completed / (completed + failed)) * 100) / 100,
      performance: {
        avgTaskDurationMs: ctx.rng.int(1, 30) * MIN,
        tasksCompleted: completed,
        tasksFailed: failed,
        tokensUsed: ctx.rng.int(10_000, 9_000_000),
        costEur: Math.round(ctx.rng.float(0, 90) * 100) / 100,
      },
      lastActivityAt: ctx.at(-ctx.rng.int(1, 3600) * 1000),
      lastError:
        status === "error"
          ? {
              code: "INTERNAL",
              message: "Agent-Laufzeit hat einen unerwarteten Fehler gemeldet.",
              severity: "error",
              retryable: true,
              correlationId: ctx.id("corr"),
              details: {},
            }
          : null,
      accent: ctx.rng.pick(["#4DD6FF", "#2BE3B6", "#B28CFF", "#FFB347", "#FF7A59", "#7DF9A1", "#4D9BFF", "#FFD166"]),
    });
  }
  return agents;
}
