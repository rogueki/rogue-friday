import type {
  Actor,
  ArtifactRef,
  ErrorDetail,
  Priority,
  Task,
  TaskBlocker,
  TaskStatus,
  TaskStep,
  TaskToolCall,
} from "@jarvis/sdk";
import { DAY, HOUR, MIN, type SeedContext } from "./context";
import { fileSpec } from "./files";
import type { AgentKey, ApprovalKey, FileKey, Story, TaskKey, ThreadKey } from "./story";

type StepTuple = [title: string, status: TaskStep["status"], detail?: string];
type ToolTuple = [tool: string, status: TaskToolCall["status"], summary: string | undefined, durationMs: number | undefined, adapter: string];

interface TaskSpec {
  key: TaskKey;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  agent?: AgentKey;
  model: string | null;
  progress: { mode: "determinate" | "indeterminate" | "none"; value: number | null };
  startedAgoMs: number | null;
  createdAgoMs: number;
  updatedAgoMs: number;
  dueInMs: number | null;
  etaInMs?: number;
  labels: string[];
  steps: StepTuple[];
  tools: ToolTuple[];
  files?: { key: FileKey; kind: ArtifactRef["kind"] }[];
  blockers?: (Omit<TaskBlocker, "id" | "refId"> & { approval?: ApprovalKey; sinceAgoMs?: number })[];
  approvals?: ApprovalKey[];
  threadRef?: ThreadKey;
  error?: { code: ErrorDetail["code"]; message: string };
}

const SPECS: TaskSpec[] = [
  {
    key: "bueromoebel",
    title: "Angebote für Büromöbel recherchieren und vergleichen",
    description: "Drei Anbieter aus der Region Hannover vergleichen, Lieferzeiten und Gesamtkosten gegenüberstellen.",
    status: "running",
    priority: "P2",
    agent: "recherche",
    model: "Kimi K3",
    progress: { mode: "determinate", value: 0.62 },
    startedAgoMs: 20 * MIN,
    createdAgoMs: 100 * MIN,
    updatedAgoMs: 1 * MIN,
    dueInMs: 6 * HOUR + 45 * MIN,
    etaInMs: 25 * MIN,
    labels: ["büro", "einkauf"],
    steps: [
      ["Anbieter identifizieren", "done"],
      ["Preise und Lieferzeiten auslesen", "running", "Quelle 2 von 3"],
      ["Vergleichsbericht erstellen", "pending"],
    ],
    tools: [
      ["web.search", "succeeded", "Büromöbel Hannover Anbieter: 14 Treffer", 1210, "mock-research"],
      ["web.fetch", "succeeded", "Preisliste von büro-nord.example.de", 1840, "mock-research"],
      ["web.fetch", "running", undefined, undefined, "mock-research"],
    ],
    files: [{ key: "angebotsvergleich", kind: "report" }],
    approvals: ["bestellung"],
  },
  {
    key: "postfach",
    title: "GMX-Postfach triagieren und Antwortentwürfe vorbereiten",
    description: "37 ungelesene Nachrichten nach Wichtigkeit sortieren, Termine und Aufgaben extrahieren, Antworten als Entwurf anlegen.",
    status: "running",
    priority: "P1",
    agent: "kommunikation",
    model: "Kimi K3",
    progress: { mode: "indeterminate", value: null },
    startedAgoMs: 42 * MIN,
    createdAgoMs: 50 * MIN,
    updatedAgoMs: 30_000,
    dueInMs: 3 * HOUR,
    labels: ["mail", "triage"],
    steps: [
      ["Neue Mails abrufen", "done"],
      ["Wichtigkeit bewerten", "done"],
      ["Antwortentwürfe erstellen", "running", "Entwurf 3 von 5"],
      ["Zusammenfassung für Erik erstellen", "pending"],
    ],
    tools: [
      ["mail.read", "succeeded", "37 Nachrichten abgerufen", 2310, "mock-communication"],
      ["mail.draft", "succeeded", "Entwurf für Albrecht & Partner angelegt", 940, "mock-communication"],
      ["mail.draft", "running", undefined, undefined, "mock-communication"],
    ],
    threadRef: "albrecht",
  },
  {
    key: "becker",
    title: "Terminbestätigung an Frau Becker senden",
    description: "Frau Becker hat um Bestätigung des Termins am 21.10.2026 um 10:00 Uhr gebeten. Entwurf liegt vor, Versand nur mit Freigabe.",
    status: "waiting",
    priority: "P1",
    agent: "kommunikation",
    model: "Kimi K3",
    progress: { mode: "determinate", value: 0.9 },
    startedAgoMs: 35 * MIN,
    createdAgoMs: 40 * MIN,
    updatedAgoMs: 15 * MIN,
    dueInMs: 90 * MIN,
    labels: ["kunde", "termin"],
    steps: [
      ["Anfrage lesen", "done"],
      ["Kalender prüfen", "done", "21.10. 10:00 ist frei"],
      ["Bestätigung formulieren", "done"],
      ["Versand nach Freigabe", "pending"],
    ],
    tools: [
      ["calendar.read", "succeeded", "Verfügbarkeit am 21.10. geprüft", 380, "mock-calendar"],
      ["mail.draft", "succeeded", "Entwurf 'Terminbestätigung 21.10.' angelegt", 880, "mock-communication"],
    ],
    blockers: [{ kind: "approval", description: "Wartet auf Freigabe: E-Mail an Frau Becker senden", approval: "beckerMail", sinceAgoMs: 15 * MIN }],
    approvals: ["beckerMail"],
    threadRef: "becker",
  },
  {
    key: "apiClient",
    title: "API-Client für das Lieferantenportal refaktorieren (TypeScript)",
    description: "Generierten Client durch typisierte Fassade ersetzen, Fehlerbehandlung vereinheitlichen und Tests ergänzen.",
    status: "running",
    priority: "P3",
    agent: "coding",
    model: "Kimi K3",
    progress: { mode: "determinate", value: 0.35 },
    startedAgoMs: 52 * MIN,
    createdAgoMs: 3 * HOUR,
    updatedAgoMs: 2 * MIN,
    dueInMs: 1 * DAY + 4 * HOUR,
    etaInMs: 70 * MIN,
    labels: ["entwicklung", "lieferantenportal"],
    steps: [
      ["Bestehenden Client analysieren", "done"],
      ["Typisierte Fassade entwerfen", "done"],
      ["Aufrufstellen migrieren", "running", "14 von 40 Dateien"],
      ["Tests ergänzen", "pending"],
      ["Pull-Request vorbereiten", "pending"],
    ],
    tools: [
      ["git.diff", "succeeded", "26 Dateien betroffen", 410, "mock-tasks"],
      ["fs.write", "succeeded", "src/portal/client.ts geschrieben", 55, "mock-tasks"],
      ["shell.exec", "running", undefined, undefined, "mock-tasks"],
    ],
  },
  {
    key: "quartalsbericht",
    title: "Quartalsbericht Q3 2026 als Präsentation erstellen",
    description: "Kennzahlen aus dem Export übernehmen, Diagramme erzeugen, Foliensatz und PDF-Bericht bereitstellen.",
    status: "review",
    priority: "P2",
    agent: "task",
    model: "Kimi K3",
    progress: { mode: "determinate", value: 1 },
    startedAgoMs: 3 * HOUR,
    createdAgoMs: 4 * HOUR,
    updatedAgoMs: 88 * MIN,
    dueInMs: 1 * DAY,
    labels: ["bericht", "quartal"],
    steps: [
      ["Kennzahlen importieren", "done"],
      ["Diagramme erzeugen", "done"],
      ["Folien gestalten", "done"],
      ["PDF-Bericht rendern", "done"],
    ],
    tools: [
      ["fs.read", "succeeded", "Kennzahlen-Export gelesen", 120, "mock-files"],
      ["fs.write", "succeeded", "Quartalsbericht Q3 2026.pptx erzeugt", 2100, "mock-files"],
    ],
    files: [
      { key: "quartalsbericht", kind: "report" },
      { key: "praesentationQ3", kind: "presentation" },
    ],
  },
  {
    key: "memoryKonsolidierung",
    title: "Memory-Einträge konsolidieren und Duplikate zusammenführen",
    description: "Doppelte Personen- und Firmeneinträge erkennen, Widersprüche markieren, gesperrte Einträge unangetastet lassen.",
    status: "done",
    priority: "P4",
    agent: "memory",
    model: "Qwen Local",
    progress: { mode: "determinate", value: 1 },
    startedAgoMs: 6 * HOUR,
    createdAgoMs: 7 * HOUR,
    updatedAgoMs: 5 * HOUR + 30 * MIN,
    dueInMs: null,
    labels: ["memory", "wartung"],
    steps: [
      ["Kandidaten suchen", "done", "9 Duplikate"],
      ["Konflikte markieren", "done", "2 Konflikte"],
      ["Zusammenführung vorschlagen", "done"],
    ],
    tools: [["memory.search", "succeeded", "42 Einträge verglichen", 640, "mock-memory"]],
    files: [{ key: "exportMemory", kind: "dataset" }],
  },
  {
    key: "steuer",
    title: "Belege für die Steuererklärung 2025 zusammenstellen",
    description: "Belegliste mit dem Postfach und der Ablage abgleichen und für die Steuerberatung Albrecht & Partner bündeln.",
    status: "waiting",
    priority: "P2",
    agent: "task",
    model: "Kimi K3",
    progress: { mode: "determinate", value: 0.7 },
    startedAgoMs: 2 * DAY,
    createdAgoMs: 3 * DAY,
    updatedAgoMs: 4 * HOUR,
    dueInMs: 2 * DAY + 3 * HOUR,
    labels: ["steuer", "belege"],
    steps: [
      ["Belegliste einlesen", "done"],
      ["Belege in Postfach und Ablage suchen", "done", "27 von 30 gefunden"],
      ["Fehlende Belege klären", "running", "Rückmeldung von Erik nötig"],
      ["Paket für Steuerberater bündeln", "pending"],
    ],
    tools: [["fs.read", "succeeded", "Belegliste Steuer 2025.xlsx gelesen", 210, "mock-files"]],
    files: [{ key: "steuerListe", kind: "file" }],
    blockers: [
      {
        kind: "input_needed",
        description: "Es fehlen drei Belege: Tankquittung Mai, Fortbildung Hamburg, Handwerkerrechnung Kühnemann.",
        sinceAgoMs: 4 * HOUR,
      },
    ],
    threadRef: "albrecht",
  },
  {
    key: "backup",
    title: "Backup-Verifikation der Sicherungen auf D:\\ durchführen",
    description: "Prüfsummen der letzten Sicherung kontrollieren und Ergebnis protokollieren.",
    status: "done",
    priority: "P3",
    agent: "system",
    model: "Qwen Local",
    progress: { mode: "determinate", value: 1 },
    startedAgoMs: 14 * HOUR + 10 * MIN,
    createdAgoMs: 14 * HOUR + 12 * MIN,
    updatedAgoMs: 14 * HOUR,
    dueInMs: null,
    labels: ["backup", "system"],
    steps: [
      ["Letzte Sicherung finden", "done"],
      ["Prüfsummen vergleichen", "done", "1 482 Dateien"],
      ["Protokoll schreiben", "done"],
    ],
    tools: [["fs.read", "succeeded", "D:\\Jarvis\\Backups geprüft", 218_000, "mock-system"]],
    files: [{ key: "backupLog", kind: "file" }],
  },
  {
    key: "kalenderKw43",
    title: "Kalenderwoche 43 optimieren und Terminkonflikte auflösen",
    description: "Überschneidung am Donnerstag erkennen, Alternativen vorschlagen und Fokuszeit schützen.",
    status: "ready",
    priority: "P2",
    agent: "kalender",
    model: "Qwen Local",
    progress: { mode: "none", value: null },
    startedAgoMs: null,
    createdAgoMs: 2 * HOUR,
    updatedAgoMs: 40 * MIN,
    dueInMs: 1 * DAY + 2 * HOUR,
    labels: ["kalender", "kw43"],
    steps: [
      ["Konflikte erkennen", "done", "1 Konflikt am Donnerstag"],
      ["Alternativen vorschlagen", "pending"],
      ["Änderung zur Freigabe vorlegen", "pending"],
    ],
    tools: [["calendar.read", "succeeded", "Woche 43 gelesen: 11 Termine", 450, "mock-calendar"]],
    approvals: ["terminVerschieben"],
  },
  {
    key: "rechnung",
    title: "Rechnung der Nordlicht IT-Systeme GmbH prüfen und Zahlung vorbereiten",
    description: "Rechnung 2026-1142 gegen Bestellung und Leistungsnachweis prüfen. Zahlung über 4.287,60 EUR erfordert Re-Authentifizierung.",
    status: "waiting",
    priority: "P2",
    agent: "kommunikation",
    model: "Kimi K3",
    progress: { mode: "determinate", value: 0.8 },
    startedAgoMs: 3 * HOUR,
    createdAgoMs: 3 * HOUR + 10 * MIN,
    updatedAgoMs: 25 * MIN,
    dueInMs: 3 * DAY,
    labels: ["rechnung", "zahlung"],
    steps: [
      ["Rechnung einlesen", "done"],
      ["Mit Bestellung abgleichen", "done", "Abweichung: 0,00 EUR"],
      ["Zahlung vorbereiten", "done"],
      ["Zahlung freigeben lassen", "pending"],
    ],
    tools: [["fs.read", "succeeded", "Rechnung 2026-1142.pdf extrahiert", 780, "mock-files"]],
    files: [{ key: "rechnungNordlicht", kind: "file" }],
    blockers: [{ kind: "approval", description: "Wartet auf Freigabe: Zahlung an Nordlicht IT-Systeme GmbH", approval: "zahlung", sinceAgoMs: 25 * MIN }],
    approvals: ["zahlung"],
    threadRef: "nordlicht",
  },
  {
    key: "windowsUpdates",
    title: "Windows-Updates auf dem Worker einspielen",
    description: "Monatliche Updates auf dem Windows-Worker installieren und anschließend Dienste neu starten.",
    status: "failed",
    priority: "P2",
    agent: "system",
    model: "Qwen Local",
    progress: { mode: "determinate", value: 0.4 },
    startedAgoMs: 3 * HOUR + 5 * MIN,
    createdAgoMs: 3 * HOUR + 10 * MIN,
    updatedAgoMs: 3 * HOUR,
    dueInMs: null,
    labels: ["system", "updates"],
    steps: [
      ["Updates herunterladen", "done"],
      ["Installation starten", "failed", "Worker antwortet nicht"],
      ["Dienste neu starten", "skipped"],
    ],
    tools: [["system.service", "failed", "Windows-Worker nicht erreichbar", 30_000, "mock-system"]],
    approvals: ["systemUpdate"],
    error: { code: "ADAPTER_TIMEOUT", message: "Der Windows-Worker hat nicht innerhalb von 30 Sekunden geantwortet." },
  },
  {
    key: "newsletter",
    title: "Newsletter-Entwurf Oktober fertigstellen",
    description: "Entwurf wurde verworfen, weil der Versand an den Verteiler auf November verschoben wurde.",
    status: "cancelled",
    priority: "P4",
    agent: "kommunikation",
    model: "Kimi K3",
    progress: { mode: "determinate", value: 0.5 },
    startedAgoMs: 4 * DAY,
    createdAgoMs: 5 * DAY,
    updatedAgoMs: 3 * DAY,
    dueInMs: null,
    labels: ["newsletter"],
    steps: [
      ["Themen sammeln", "done"],
      ["Entwurf schreiben", "done"],
      ["Korrekturlesen", "skipped"],
    ],
    tools: [["mail.draft", "succeeded", "Entwurf als HTML gespeichert", 1500, "mock-communication"]],
    files: [{ key: "newsletter", kind: "file" }],
  },
  {
    key: "foerderung",
    title: "Förderprogramme für die Photovoltaik-Anlage Gartenstraße recherchieren",
    description: "Bundes-, Landes- und Regionalprogramme sammeln, Fristen und Förderhöhen vergleichen.",
    status: "done",
    priority: "P3",
    agent: "recherche",
    model: "Kimi K3",
    progress: { mode: "determinate", value: 1 },
    startedAgoMs: 3 * DAY + 2 * HOUR,
    createdAgoMs: 3 * DAY + 3 * HOUR,
    updatedAgoMs: 3 * DAY,
    dueInMs: null,
    labels: ["photovoltaik", "förderung"],
    steps: [
      ["Programme sammeln", "done", "9 Programme"],
      ["Bedingungen vergleichen", "done"],
      ["Bericht schreiben", "done"],
    ],
    tools: [["web.search", "succeeded", "Förderprogramme Photovoltaik Niedersachsen", 1330, "mock-research"]],
    files: [{ key: "foerderRecherche", kind: "report" }],
  },
  {
    key: "lieferantenportal",
    title: "Bestellstatus im Lieferantenportal auslesen",
    description: "Offene Bestellungen im Portal abfragen und Statusänderungen in die Aufgabenliste übernehmen.",
    status: "todo",
    priority: "P3",
    model: null,
    progress: { mode: "none", value: null },
    startedAgoMs: null,
    createdAgoMs: 1 * HOUR,
    updatedAgoMs: 1 * HOUR,
    dueInMs: 2 * DAY,
    labels: ["lieferantenportal"],
    steps: [
      ["Portal-Zugang prüfen", "pending"],
      ["Bestellungen auslesen", "pending"],
    ],
    tools: [],
  },
];

/** Curated tasks are linked to approvals, files and threads by key; returns them in fixed order. */
export function buildCuratedTasks(ctx: SeedContext, story: Story, agentNames: Record<string, string>): Task[] {
  return SPECS.map((spec) => {
    const agentId = spec.agent ? story.agents[spec.agent] : null;
    const agentName = spec.agent ? agentNames[story.agents[spec.agent]] : undefined;
    const startedAt = spec.startedAgoMs !== null ? ctx.at(-spec.startedAgoMs) : null;
    const running = spec.status === "running";
    const steps: TaskStep[] = spec.steps.map(([title, status, detail], index) => {
      const step: TaskStep = { id: ctx.id("step"), index, title, status };
      if (status !== "pending" && startedAt) step.startedAt = ctx.at(-(spec.startedAgoMs ?? 0) + index * 6 * MIN);
      if ((status === "done" || status === "failed") && startedAt) step.finishedAt = ctx.at(-(spec.startedAgoMs ?? 0) + (index + 1) * 5 * MIN);
      if (detail) step.detail = detail;
      return step;
    });
    const toolCalls: TaskToolCall[] = spec.tools.map(([tool, status, summary, durationMs, adapterId], index) => {
      const call: TaskToolCall = {
        id: ctx.id("tcall"),
        tool,
        status,
        startedAt: ctx.at(-Math.max(30_000, (spec.startedAgoMs ?? 10 * MIN) - (index + 1) * 4 * MIN)),
        adapterId,
      };
      if (summary) call.summary = summary;
      if (durationMs !== undefined) call.durationMs = durationMs;
      return call;
    });
    const artifacts: ArtifactRef[] = (spec.files ?? []).map(({ key, kind }) => {
      const file = fileSpec(key);
      return { id: ctx.id("art"), name: file.name, kind, fileId: story.files[key], sizeBytes: file.sizeBytes };
    });
    const blockers: TaskBlocker[] = (spec.blockers ?? []).map((blocker) => ({
      id: ctx.id("blk"),
      kind: blocker.kind,
      description: blocker.description,
      since: ctx.at(-(blocker.sinceAgoMs ?? 10 * MIN)),
      ...(blocker.approval ? { refId: story.approvals[blocker.approval] } : {}),
    }));
    const errors: ErrorDetail[] = spec.error
      ? [
          {
            code: spec.error.code,
            message: spec.error.message,
            severity: "error",
            retryable: true,
            correlationId: ctx.id("corr"),
            details: { host: "windows-worker", timeoutMs: 30_000 },
          },
        ]
      : [];
    const sourceRefs: Task["sourceRefs"] = [
      ...artifacts.map((artifact) => ({ type: "file" as const, id: artifact.fileId ?? "", label: artifact.name })),
      ...(spec.threadRef ? [{ type: "thread" as const, id: story.threads[spec.threadRef], label: "Zugehörige Konversation" }] : []),
    ].filter((ref) => ref.id);
    const task: Task = {
      id: story.tasks[spec.key],
      version: ctx.rng.int(2, 8),
      createdAt: ctx.at(-spec.createdAgoMs),
      updatedAt: ctx.at(-spec.updatedAgoMs),
      labels: spec.labels,
      source: ctx.src("tasks"),
      title: spec.title,
      description: spec.description,
      status: spec.status,
      priority: spec.priority,
      agentId,
      model: spec.model,
      progress: spec.progress,
      startedAt,
      runtimeMs: startedAt ? (running ? spec.startedAgoMs : Math.max(0, (spec.startedAgoMs ?? 0) - spec.updatedAgoMs)) : null,
      dueAt: spec.dueInMs !== null ? ctx.at(spec.dueInMs) : null,
      estimatedCompletionAt: spec.etaInMs !== undefined ? ctx.at(spec.etaInMs) : null,
      blockers,
      lastActivityAt: ctx.at(-spec.updatedAgoMs),
      artifactCount: artifacts.length,
      artifacts,
      steps,
      toolCalls,
      sourceRefs,
      approvalIds: (spec.approvals ?? []).map((key) => story.approvals[key]),
      errors,
      createdBy: spec.agent === "task" || spec.key === "lieferantenportal" ? ctx.owner : ctx.owner,
    };
    if (agentName) task.agentName = agentName;
    return task;
  });
}

const TOPICS = [
  "Lieferantenangebot",
  "Quartalsabrechnung",
  "Reisekostenabrechnung",
  "Vertragsentwurf",
  "Datensicherung",
  "Newsletter-Entwurf",
  "Marktanalyse",
  "Mitarbeiterhandbuch",
  "Wartungsvertrag",
  "Kundenpräsentation",
  "Inventurliste",
  "Zeiterfassung",
  "Projektstatusbericht",
  "Preiskalkulation",
  "Schulungsunterlagen",
];

const CONTEXTS = [
  "für Becker & Söhne Maschinenbau GmbH",
  "zum Projekt Leuchtturm",
  "für die Steuerberatung Albrecht & Partner",
  "für die Kalenderwoche 44",
  "für den Büroumzug nach Linden",
  "der Hoffmann Logistik AG",
  "für das Windparkprojekt Nordwind",
  "zur Photovoltaik-Anlage Gartenstraße",
  "für den Jahresabschluss",
  "für Kühnemann Haustechnik",
];

const VERBS = [
  "prüfen",
  "erstellen",
  "zusammenfassen",
  "vorbereiten",
  "abgleichen",
  "archivieren",
  "übersetzen",
  "aktualisieren",
  "auswerten",
  "dokumentieren",
];

const GENERIC_STEPS = [
  "Unterlagen sichten",
  "Daten extrahieren",
  "Ergebnisse abgleichen",
  "Entwurf erstellen",
  "Qualität prüfen",
  "Ergebnis bereitstellen",
];

const STATUS_CYCLE: TaskStatus[] = [
  "triage",
  "todo",
  "ready",
  "done",
  "todo",
  "triage",
  "done",
  "review",
  "ready",
  "cancelled",
  "done",
  "running",
  "waiting",
  "failed",
];

const BULK_STATUS_WEIGHTS: [TaskStatus, number][] = [
  ["triage", 10],
  ["todo", 18],
  ["ready", 10],
  ["running", 12],
  ["waiting", 8],
  ["review", 8],
  ["done", 24],
  ["failed", 5],
  ["cancelled", 5],
];

const PRIORITIES: [Priority, number][] = [
  ["P0", 2],
  ["P1", 10],
  ["P2", 28],
  ["P3", 40],
  ["P4", 20],
];

export interface BulkTaskOptions {
  count: number;
  /** When set, statuses cycle through STATUS_CYCLE (guaranteed coverage) instead of weighted draws. */
  cycleStatuses: boolean;
  agents: { id: string; name: string; tools: string[] }[];
  startIndex: number;
}

export function buildBulkTasks(ctx: SeedContext, options: BulkTaskOptions): Task[] {
  const tasks: Task[] = [];
  const owner: Actor = ctx.owner;
  for (let i = 0; i < options.count; i++) {
    const status: TaskStatus = options.cycleStatuses
      ? (STATUS_CYCLE[i % STATUS_CYCLE.length] as TaskStatus)
      : ctx.rng.weighted(BULK_STATUS_WEIGHTS);
    const topic = ctx.rng.pick(TOPICS);
    const context = ctx.rng.pick(CONTEXTS);
    const verb = ctx.rng.pick(VERBS);
    const agent = options.agents.length > 0 ? ctx.rng.pick(options.agents) : undefined;
    const assigned = status !== "triage" && status !== "todo" && agent !== undefined;
    const createdAgo = ctx.rng.int(20, 60 * 24 * 7) * MIN;
    const updatedAgo = Math.min(createdAgo, ctx.rng.int(1, 60 * 24) * MIN);
    const startedAgo = ["running", "waiting", "review", "done", "failed", "cancelled"].includes(status)
      ? Math.min(createdAgo, updatedAgo + ctx.rng.int(2, 240) * MIN)
      : null;
    let progress: Task["progress"] = { mode: "none", value: null };
    if (status === "running") {
      progress = ctx.rng.chance(0.7)
        ? { mode: "determinate", value: Math.round(ctx.rng.float(0.05, 0.95) * 100) / 100 }
        : { mode: "indeterminate", value: null };
    } else if (status === "done" || status === "review") {
      progress = { mode: "determinate", value: 1 };
    } else if (status === "waiting" || status === "failed" || status === "cancelled") {
      progress = { mode: "determinate", value: Math.round(ctx.rng.float(0.1, 0.9) * 100) / 100 };
    }
    const stepCount = ctx.rng.int(3, 5);
    const doneCount =
      status === "done" || status === "review"
        ? stepCount
        : status === "running" || status === "waiting"
          ? ctx.rng.int(1, stepCount - 1)
          : status === "failed" || status === "cancelled"
            ? ctx.rng.int(1, stepCount - 1)
            : 0;
    const steps: TaskStep[] = Array.from({ length: stepCount }, (_, index) => {
      const stepStatus: TaskStep["status"] =
        index < doneCount
          ? "done"
          : index === doneCount && status === "running"
            ? "running"
            : index === doneCount && status === "failed"
              ? "failed"
              : index === doneCount && status === "cancelled"
                ? "skipped"
                : "pending";
      const step: TaskStep = {
        id: ctx.id("step"),
        index,
        title: GENERIC_STEPS[index % GENERIC_STEPS.length] as string,
        status: stepStatus,
      };
      if (stepStatus !== "pending" && startedAgo !== null) step.startedAt = ctx.at(-startedAgo + index * 3 * MIN);
      if ((stepStatus === "done" || stepStatus === "failed") && startedAgo !== null) step.finishedAt = ctx.at(-startedAgo + (index + 1) * 3 * MIN);
      return step;
    });
    const toolCalls: TaskToolCall[] =
      assigned && startedAgo !== null && agent
        ? agent.tools.slice(0, ctx.rng.int(1, 2)).map((tool) => ({
            id: ctx.id("tcall"),
            tool,
            status: status === "failed" ? "failed" : status === "running" ? "running" : "succeeded",
            startedAt: ctx.at(-startedAgo + MIN),
            adapterId: "mock-tasks",
            ...(status === "running" ? {} : { durationMs: ctx.rng.int(80, 4000) }),
          }))
        : [];
    const blockers: TaskBlocker[] =
      status === "waiting"
        ? [
            {
              id: ctx.id("blk"),
              kind: ctx.rng.pick<TaskBlocker["kind"]>(["input_needed", "dependency", "adapter_unavailable"]),
              description: ctx.rng.pick([
                "Rückmeldung des Benutzers erforderlich.",
                "Wartet auf Abschluss einer vorgelagerten Aufgabe.",
                "Der benötigte Adapter ist vorübergehend nicht erreichbar.",
              ]),
              since: ctx.at(-updatedAgo),
            },
          ]
        : [];
    const errors: ErrorDetail[] =
      status === "failed"
        ? [
            {
              code: ctx.rng.pick<ErrorDetail["code"]>(["ADAPTER_TIMEOUT", "ADAPTER_UNAVAILABLE", "INTERNAL"]),
              message: "Die Verarbeitung wurde mit einem Fehler beendet.",
              severity: "error",
              retryable: true,
              correlationId: ctx.id("corr"),
              details: {},
            },
          ]
        : [];
    const task: Task = {
      id: ctx.id("task"),
      version: ctx.rng.int(1, 9),
      createdAt: ctx.at(-createdAgo),
      updatedAt: ctx.at(-updatedAgo),
      labels: [topic.toLowerCase().replace(/[^a-zäöüß-]+/g, "-")],
      source: ctx.src("tasks"),
      title: `${topic} ${context} ${verb} (${options.startIndex + i + 1})`,
      description: `${topic} ${context}: Aufgabe automatisch aus dem Posteingang oder einer Anweisung abgeleitet.`,
      status,
      priority: ctx.rng.weighted(PRIORITIES),
      agentId: assigned && agent ? agent.id : null,
      model: assigned ? ctx.rng.pick(["Kimi K3", "Qwen Local"]) : null,
      progress,
      startedAt: startedAgo !== null ? ctx.at(-startedAgo) : null,
      runtimeMs: startedAgo !== null ? Math.max(0, startedAgo - (status === "running" ? 0 : updatedAgo)) : null,
      dueAt: ctx.rng.chance(0.6) ? ctx.at(ctx.rng.int(-2, 96) * HOUR) : null,
      estimatedCompletionAt: status === "running" ? ctx.at(ctx.rng.int(5, 180) * MIN) : null,
      blockers,
      lastActivityAt: ctx.at(-updatedAgo),
      artifactCount: 0,
      artifacts: [],
      steps,
      toolCalls,
      sourceRefs: [],
      approvalIds: [],
      errors,
      createdBy: ctx.rng.chance(0.5) ? owner : { type: "agent", id: assigned && agent ? agent.id : "agent_system", name: agent?.name ?? "Task-Agent" },
    };
    if (assigned && agent) task.agentName = agent.name;
    tasks.push(task);
  }
  return tasks;
}
