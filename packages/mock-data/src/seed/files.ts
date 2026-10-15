import type { Actor, FileCategory, FileItem, FileLineageEntry, FilePreviewKind } from "@friday/sdk";
import { sha256Hex } from "../core/sha256";
import { DAY, HOUR, MIN, type SeedContext } from "./context";
import type { AgentKey, FileKey, Story, TaskKey } from "./story";

export interface FileSpec {
  key: FileKey;
  name: string;
  mimeType: string;
  sizeBytes: number;
  category: FileCategory;
  previewKind: FilePreviewKind;
  location: string;
  tags: string[];
  task?: TaskKey;
  agent?: AgentKey;
  user?: boolean;
  versions: number;
  createdAgoMs: number;
  content: string;
  lineage?: { relation: FileLineageEntry["relation"]; file?: FileKey; task?: TaskKey; description: string }[];
}

const REPORT_DIR = "D:\\Friday\\Dateien\\Berichte";

export const FILE_SPECS: FileSpec[] = [
  {
    key: "angebotsvergleich",
    name: "Angebotsvergleich Büromöbel.md",
    mimeType: "text/markdown",
    sizeBytes: 18432,
    category: "reports",
    previewKind: "markdown",
    location: REPORT_DIR,
    tags: ["büro", "angebote", "vergleich"],
    task: "bueromoebel",
    agent: "recherche",
    versions: 2,
    createdAgoMs: 25 * MIN,
    content: [
      "# Angebotsvergleich Büromöbel (Zwischenstand)",
      "",
      "| Anbieter | Standort | Gesamtpreis (netto) | Lieferzeit |",
      "|---|---|---:|---|",
      "| Büro-Nord Einrichtungen GmbH | Hannover | 11.840,00 EUR | 3 Wochen |",
      "| Möbelhaus Weserstraße | Hameln | 12.390,00 EUR | 5 Wochen |",
      "| Arbeitswelt Leine KG | Laatzen | 10.995,00 EUR | 6 Wochen |",
      "",
      "Offen: Montagekosten von Arbeitswelt Leine KG, Rückfrage läuft.",
    ].join("\n"),
    lineage: [{ relation: "output_of", task: "bueromoebel", description: "Ergebnis der Angebotsrecherche" }],
  },
  {
    key: "quartalsbericht",
    name: "Quartalsbericht Q3 2026.pdf",
    mimeType: "application/pdf",
    sizeBytes: 482113,
    category: "reports",
    previewKind: "pdf",
    location: REPORT_DIR,
    tags: ["quartal", "bericht", "q3"],
    task: "quartalsbericht",
    agent: "task",
    versions: 3,
    createdAgoMs: 95 * MIN,
    content: "%PDF-1.4 (Mock-Inhalt) Quartalsbericht Q3 2026 – Umsatz, Kosten, Ausblick",
    lineage: [{ relation: "output_of", task: "quartalsbericht", description: "Aus Kennzahlen-Export erzeugt" }],
  },
  {
    key: "praesentationQ3",
    name: "Quartalsbericht Q3 2026.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    sizeBytes: 3_284_990,
    category: "presentations",
    previewKind: "none",
    location: "D:\\Friday\\Dateien\\Präsentationen",
    tags: ["quartal", "präsentation"],
    task: "quartalsbericht",
    agent: "task",
    versions: 2,
    createdAgoMs: 88 * MIN,
    content: "",
    lineage: [{ relation: "derived_from", file: "quartalsbericht", description: "Folien aus dem PDF-Bericht abgeleitet" }],
  },
  {
    key: "backupLog",
    name: "Backup-Verifikation 2026-10-13.log",
    mimeType: "text/plain",
    sizeBytes: 9120,
    category: "generated",
    previewKind: "text",
    location: "D:\\Friday\\Dateien\\Protokolle",
    tags: ["backup", "log"],
    task: "backup",
    agent: "system",
    versions: 1,
    createdAgoMs: 14 * HOUR,
    content: [
      "[2026-10-13 22:00:04] Starte Verifikation von D:\\Friday\\Backups",
      "[2026-10-13 22:03:41] 1 482 Dateien geprüft, Prüfsummen stimmen überein",
      "[2026-10-13 22:03:41] Letzte Sicherung: 2026-10-13 03:00 (12,4 GB)",
      "[2026-10-13 22:03:42] Ergebnis: OK",
    ].join("\n"),
    lineage: [{ relation: "output_of", task: "backup", description: "Prüfprotokoll des Backup-Laufs" }],
  },
  {
    key: "altesBackup",
    name: "dashboard-backup-2026-08.zip",
    mimeType: "application/zip",
    sizeBytes: 1_932_735_283,
    category: "temporary",
    previewKind: "none",
    location: "D:\\Friday\\Backups\\alt",
    tags: ["backup", "archiv"],
    agent: "system",
    versions: 1,
    createdAgoMs: 60 * DAY,
    content: "",
  },
  {
    key: "steuerListe",
    name: "Belegliste Steuer 2025.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 74_512,
    category: "uploaded",
    previewKind: "none",
    location: "D:\\Friday\\Dateien\\Hochgeladen",
    tags: ["steuer", "belege", "2025"],
    task: "steuer",
    user: true,
    versions: 1,
    createdAgoMs: 2 * DAY,
    content: "",
  },
  {
    key: "rechnungNordlicht",
    name: "Rechnung Nordlicht IT-Systeme 2026-1142.pdf",
    mimeType: "application/pdf",
    sizeBytes: 96_211,
    category: "invoices",
    previewKind: "pdf",
    location: "D:\\Friday\\Dateien\\Rechnungen",
    tags: ["rechnung", "nordlicht", "it"],
    task: "rechnung",
    agent: "kommunikation",
    versions: 1,
    createdAgoMs: 3 * HOUR,
    content: "%PDF-1.4 (Mock-Inhalt) Rechnung 2026-1142, Nordlicht IT-Systeme GmbH, 4.287,60 EUR brutto",
    lineage: [{ relation: "derived_from", description: "Anhang der E-Mail 'Rechnung 2026-1142'" }],
  },
  {
    key: "foerderRecherche",
    name: "Förderprogramme Photovoltaik – Übersicht.md",
    mimeType: "text/markdown",
    sizeBytes: 22_870,
    category: "research",
    previewKind: "markdown",
    location: "D:\\Friday\\Dateien\\Recherche",
    tags: ["photovoltaik", "förderung", "recherche"],
    agent: "recherche",
    versions: 4,
    createdAgoMs: 3 * DAY,
    content: [
      "# Förderprogramme Photovoltaik (Stand Oktober 2026)",
      "",
      "- KfW-Programm 270 „Erneuerbare Energien – Standard“: zinsgünstiger Kredit für PV-Anlagen und Speicher.",
      "- Regionale Zuschüsse der Region Hannover für Batteriespeicher (Budget begrenzt, Antrag vor Kauf).",
      "- Einspeisevergütung nach EEG: Satz hängt vom Inbetriebnahmedatum ab, Quelle: Bundesnetzagentur.",
      "",
      "Widerspruch: Zwei Quellen nennen unterschiedliche Förderhöchstgrenzen, siehe Findings.",
    ].join("\n"),
  },
  {
    key: "agentProtokoll",
    name: "Agentenprotokoll 2026-10-13.json",
    mimeType: "application/json",
    sizeBytes: 311_904,
    category: "exports",
    previewKind: "text",
    location: "D:\\Friday\\Dateien\\Exporte",
    tags: ["audit", "export"],
    agent: "system",
    versions: 1,
    createdAgoMs: 18 * HOUR,
    content: '{\n  "tag": "2026-10-13",\n  "agenten": 8,\n  "toolAufrufe": 412,\n  "fehler": 3\n}',
  },
  {
    key: "exportMemory",
    name: "Memory-Export Oktober.json",
    mimeType: "application/json",
    sizeBytes: 88_330,
    category: "exports",
    previewKind: "text",
    location: "D:\\Friday\\Dateien\\Exporte",
    tags: ["memory", "export"],
    agent: "memory",
    versions: 1,
    createdAgoMs: 5 * DAY,
    content: '{\n  "eintraege": 42,\n  "sensibel": 6,\n  "gesperrt": 4\n}',
  },
  {
    key: "upload",
    name: "Grundriss Büro Hannover-Linden.png",
    mimeType: "image/png",
    sizeBytes: 1_204_550,
    category: "uploaded",
    previewKind: "image",
    location: "D:\\Friday\\Dateien\\Hochgeladen",
    tags: ["umzug", "grundriss"],
    user: true,
    versions: 1,
    createdAgoMs: 9 * DAY,
    content: "",
  },
  {
    key: "temp",
    name: "zwischenstand_tabelle.csv",
    mimeType: "text/csv",
    sizeBytes: 5_402,
    category: "temporary",
    previewKind: "text",
    location: "D:\\Friday\\Temp",
    tags: ["temp"],
    agent: "coding",
    versions: 1,
    createdAgoMs: 40 * MIN,
    content: "anbieter;preis;lieferzeit\nBüro-Nord;11840;3\nArbeitswelt Leine;10995;6",
  },
  {
    key: "newsletter",
    name: "Newsletter Oktober Entwurf.html",
    mimeType: "text/html",
    sizeBytes: 14_660,
    category: "generated",
    previewKind: "html",
    location: "D:\\Friday\\Dateien\\Entwürfe",
    tags: ["newsletter", "entwurf"],
    task: "newsletter",
    agent: "kommunikation",
    versions: 2,
    createdAgoMs: 4 * DAY,
    content: "<h1>Neues aus dem Oktober</h1><p>Liebe Kundinnen und Kunden, ...</p>",
  },
];

export function sizeOfFile(key: FileKey): number {
  const spec = FILE_SPECS.find((candidate) => candidate.key === key);
  if (!spec) throw new Error(`Unknown file key ${key}`);
  return spec.sizeBytes;
}

export function fileSpec(key: FileKey): FileSpec {
  const spec = FILE_SPECS.find((candidate) => candidate.key === key);
  if (!spec) throw new Error(`Unknown file key ${key}`);
  return spec;
}

function checksumFor(name: string, version: number, content: string): string {
  return sha256Hex(`${name}@${version}:${content}`);
}

export interface FileSeedResult {
  files: FileItem[];
  contents: Record<string, { text: string }>;
}

export function buildFiles(ctx: SeedContext, story: Story, agentNames: Record<string, string>): FileSeedResult {
  const files: FileItem[] = [];
  const contents: Record<string, { text: string }> = {};
  for (const spec of FILE_SPECS) {
    const id = story.files[spec.key];
    const createdBy: Actor = spec.user
      ? ctx.owner
      : { type: "agent", id: story.agents[spec.agent ?? "task"], name: agentNames[story.agents[spec.agent ?? "task"]] ?? "Agent" };
    const createdAt = ctx.at(-spec.createdAgoMs);
    const versions = Array.from({ length: spec.versions }, (_, index) => {
      const version = index + 1;
      return {
        version,
        createdAt: ctx.at(-spec.createdAgoMs + (version - 1) * 7 * MIN),
        sizeBytes: Math.max(1, Math.round(spec.sizeBytes * (0.55 + (0.45 * version) / spec.versions))),
        createdBy,
        checksum: checksumFor(spec.name, version, spec.content),
      };
    });
    const lineage: FileLineageEntry[] = (spec.lineage ?? []).map((entry) => ({
      relation: entry.relation,
      ...(entry.file ? { fileId: story.files[entry.file] } : {}),
      ...(entry.task ? { taskId: story.tasks[entry.task] } : {}),
      description: entry.description,
    }));
    files.push({
      id,
      version: spec.versions,
      createdAt,
      updatedAt: ctx.at(-spec.createdAgoMs + (spec.versions - 1) * 7 * MIN),
      source: ctx.src("files"),
      name: spec.name,
      mimeType: spec.mimeType,
      sizeBytes: spec.sizeBytes,
      category: spec.category,
      currentVersion: spec.versions,
      versions,
      createdBy,
      taskId: spec.task ? story.tasks[spec.task] : null,
      location: spec.location,
      tags: spec.tags,
      previewKind: spec.previewKind,
      lineage,
      checksum: checksumFor(spec.name, spec.versions, spec.content),
    });
    if (spec.content) contents[id] = { text: spec.content };
  }
  return { files, contents };
}

const BULK_NAMES: { stem: string; ext: string; mime: string; category: FileCategory; preview: FilePreviewKind; location: string }[] = [
  { stem: "Recherche-Notizen", ext: "md", mime: "text/markdown", category: "research", preview: "markdown", location: "D:\\Friday\\Dateien\\Recherche" },
  { stem: "Bericht", ext: "pdf", mime: "application/pdf", category: "reports", preview: "pdf", location: "D:\\Friday\\Dateien\\Berichte" },
  { stem: "Präsentation", ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", category: "presentations", preview: "none", location: "D:\\Friday\\Dateien\\Präsentationen" },
  { stem: "Rechnung", ext: "pdf", mime: "application/pdf", category: "invoices", preview: "pdf", location: "D:\\Friday\\Dateien\\Rechnungen" },
  { stem: "Export", ext: "json", mime: "application/json", category: "exports", preview: "text", location: "D:\\Friday\\Dateien\\Exporte" },
  { stem: "Zwischenstand", ext: "csv", mime: "text/csv", category: "temporary", preview: "text", location: "D:\\Friday\\Temp" },
  { stem: "Scan", ext: "png", mime: "image/png", category: "uploaded", preview: "image", location: "D:\\Friday\\Dateien\\Hochgeladen" },
  { stem: "Entwurf", ext: "md", mime: "text/markdown", category: "generated", preview: "markdown", location: "D:\\Friday\\Dateien\\Entwürfe" },
];

const BULK_SUBJECTS = [
  "Lieferantenportal",
  "Projekt Leuchtturm",
  "Büroumzug Linden",
  "Photovoltaik Gartenstraße",
  "Steuer 2025",
  "Marktanalyse Region Hannover",
  "Wartungsvertrag Server",
  "Reisekosten Oktober",
  "Mitarbeiterhandbuch",
  "Kundenliste Nord",
];

export function buildBulkFiles(ctx: SeedContext, story: Story, count: number, agentIds: string[]): FileSeedResult {
  const files: FileItem[] = [];
  const contents: Record<string, { text: string }> = {};
  const agentId = (index: number): string => agentIds[index % agentIds.length] ?? story.agents.task;
  for (let i = 0; i < count; i++) {
    const template = ctx.rng.pick(BULK_NAMES);
    const subject = ctx.rng.pick(BULK_SUBJECTS);
    const name = `${template.stem} ${subject} ${String(i + 1).padStart(3, "0")}.${template.ext}`;
    const sizeBytes = ctx.rng.int(2_000, 6_000_000);
    const createdAgo = ctx.rng.int(1, 120) * HOUR;
    const createdBy: Actor = ctx.rng.chance(0.2)
      ? ctx.owner
      : { type: "agent", id: agentId(i), name: "Agent" };
    const text = template.preview === "text" || template.preview === "markdown" ? `${subject}: Mock-Inhalt Nr. ${i + 1}` : "";
    const id = ctx.id("file");
    files.push({
      id,
      version: 1,
      createdAt: ctx.at(-createdAgo),
      updatedAt: ctx.at(-createdAgo + 5 * MIN),
      source: ctx.src("files"),
      name,
      mimeType: template.mime,
      sizeBytes,
      category: template.category,
      currentVersion: 1,
      versions: [{ version: 1, createdAt: ctx.at(-createdAgo), sizeBytes, createdBy }],
      createdBy,
      taskId: null,
      location: template.location,
      tags: [subject.toLowerCase().split(" ")[0] ?? "datei"],
      previewKind: template.preview,
      lineage: [],
      checksum: null,
    });
    if (text) contents[id] = { text };
  }
  return { files, contents };
}
