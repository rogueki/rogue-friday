import type {
  Actor,
  Memory,
  MemoryEntity,
  MemoryHistoryEntry,
  MemoryProvenance,
  MemorySensitivity,
  MemoryType,
} from "@friday/sdk";
import { DAY, HOUR, MIN, type SeedContext } from "./context";
import type { Story } from "./story";

interface MemorySpec {
  type: MemoryType;
  title: string;
  content: string;
  confidence: number;
  tags: string[];
  entities?: MemoryEntity[];
  locked?: boolean;
  pinned?: boolean;
  sensitivity?: MemorySensitivity;
  provenance: MemoryProvenance;
  /** Age in days at which the memory was created. */
  ageDays: number;
  confirmed?: boolean;
  ttlDays?: number;
  /** Expiry relative to now in ms (negative = already expired). */
  expiresInMs?: number;
  usage: number;
  lastUsedAgoMs?: number;
  id?: "conflictA" | "conflictB";
  agentKey?: keyof Story["agents"];
}

const entity = (kind: MemoryEntity["kind"], id: string, label: string): MemoryEntity => ({ kind, id, label });

const SPECS: MemorySpec[] = [
  {
    type: "profile",
    title: "Name und Standort",
    content: "Erik Brandt, Hannover. Geschäftssitz Hannover-List, Umzug nach Hannover-Linden geplant für November 2026.",
    confidence: 1,
    tags: ["profil", "standort"],
    entities: [entity("person", "ent_erik", "Erik Brandt"), entity("place", "ent_hannover", "Hannover")],
    locked: true,
    pinned: true,
    sensitivity: "sensitive",
    provenance: { kind: "manual", description: "Vom Benutzer im Profil hinterlegt" },
    ageDays: 120,
    confirmed: true,
    usage: 482,
    lastUsedAgoMs: 4 * MIN,
  },
  {
    type: "profile",
    title: "Arbeitszeiten und Zeitzone",
    content: "Arbeitszeit Montag bis Freitag 08:00–17:30 Uhr, Zeitzone Europe/Berlin. Fokuszeit bevorzugt vormittags.",
    confidence: 0.97,
    tags: ["profil", "kalender"],
    pinned: true,
    provenance: { kind: "conversation", description: "Aus Gespräch am 02.06.2026 übernommen" },
    ageDays: 90,
    confirmed: true,
    usage: 215,
    lastUsedAgoMs: 40 * MIN,
  },
  {
    type: "preference",
    title: "Kommunikationsstil",
    content: "Kunden werden gesiezt, sachlich und freundlich. Familie und enge Kontakte werden geduzt. Keine Floskeln, kurze Absätze.",
    confidence: 0.94,
    tags: ["kommunikation", "stil"],
    provenance: { kind: "inference", description: "Aus 140 gesendeten Nachrichten abgeleitet" },
    ageDays: 75,
    confirmed: true,
    usage: 301,
    lastUsedAgoMs: 12 * MIN,
  },
  {
    type: "preference",
    title: "Dateiablage",
    content: "Alle erzeugten Dateien werden unter D:\\Friday\\Dateien nach Kategorie abgelegt (Berichte, Präsentationen, Rechnungen, Recherche).",
    confidence: 0.99,
    tags: ["dateien", "ablage"],
    provenance: { kind: "manual" },
    ageDays: 60,
    confirmed: true,
    usage: 96,
    lastUsedAgoMs: 3 * HOUR,
  },
  {
    type: "preference",
    title: "Reisepräferenz",
    content: "Innerhalb Deutschlands bevorzugt Bahn (2. Klasse, Fensterplatz, Ruhebereich), Flüge nur für Strecken über 600 km.",
    confidence: 0.72,
    tags: ["reisen", "präferenz"],
    provenance: { kind: "inference", description: "Aus vier Buchungen abgeleitet" },
    ageDays: 40,
    usage: 12,
    lastUsedAgoMs: 9 * DAY,
  },
  {
    type: "fact",
    title: "Backup-Rhythmus",
    content: "Tägliche Sicherung um 03:00 Uhr nach D:\\Friday\\Backups, Verifikation um 22:00 Uhr. Aufbewahrung der letzten 14 Sicherungen.",
    confidence: 0.98,
    tags: ["backup", "system"],
    provenance: { kind: "sync", referenceId: "mock-system", description: "Aus Systemkonfiguration" },
    ageDays: 52,
    confirmed: true,
    usage: 44,
    lastUsedAgoMs: 14 * HOUR,
  },
  {
    type: "fact",
    title: "GMX-Postfach Synchronisation",
    content: "Das GMX-Postfach wird per IMAP alle fünf Minuten synchronisiert. Versand läuft ausschließlich über den Freigabe-Workflow.",
    confidence: 0.95,
    tags: ["mail", "gmx"],
    provenance: { kind: "sync", referenceId: "mock-communication" },
    ageDays: 33,
    usage: 77,
    lastUsedAgoMs: 1 * HOUR,
  },
  {
    type: "fact",
    title: "Zahlungsziel Becker & Söhne",
    content: "Becker & Söhne Maschinenbau zahlt Rechnungen innerhalb von 14 Tagen.",
    confidence: 0.6,
    tags: ["zahlung", "kunde"],
    entities: [entity("company", "ent_becker", "Becker & Söhne Maschinenbau GmbH")],
    provenance: { kind: "inference", description: "Aus drei bezahlten Rechnungen geschätzt" },
    ageDays: 28,
    usage: 5,
    lastUsedAgoMs: 6 * DAY,
    id: "conflictA",
  },
  {
    type: "fact",
    title: "Zahlungsziel Becker & Söhne (Vertrag)",
    content: "Laut Rahmenvertrag 2026 beträgt das Zahlungsziel von Becker & Söhne 30 Tage netto.",
    confidence: 0.85,
    tags: ["zahlung", "kunde", "vertrag"],
    entities: [entity("company", "ent_becker", "Becker & Söhne Maschinenbau GmbH")],
    provenance: { kind: "import", description: "Aus Rahmenvertrag importiert" },
    ageDays: 12,
    confirmed: true,
    usage: 2,
    lastUsedAgoMs: 2 * DAY,
    id: "conflictB",
  },
  {
    type: "person",
    title: "Katharina Becker",
    content: "Geschäftsführerin von Becker & Söhne Maschinenbau GmbH, Ansprechpartnerin für Instandhaltung. Bevorzugt schriftliche Bestätigungen.",
    confidence: 0.96,
    tags: ["kunde", "kontakt"],
    entities: [entity("person", "ent_becker_k", "Katharina Becker"), entity("company", "ent_becker", "Becker & Söhne Maschinenbau GmbH")],
    provenance: { kind: "conversation", referenceId: "thr_becker" },
    ageDays: 200,
    confirmed: true,
    usage: 64,
    lastUsedAgoMs: 15 * MIN,
  },
  {
    type: "person",
    title: "Thomas Albrecht",
    content: "Steuerberater bei Albrecht & Partner. Erwartet Belege gebündelt als PDF, Rückfragen am liebsten telefonisch am Vormittag.",
    confidence: 0.93,
    tags: ["steuer", "kontakt"],
    entities: [entity("person", "ent_albrecht", "Thomas Albrecht"), entity("company", "ent_albrecht_partner", "Albrecht & Partner")],
    provenance: { kind: "conversation" },
    ageDays: 310,
    confirmed: true,
    usage: 38,
    lastUsedAgoMs: 5 * HOUR,
  },
  {
    type: "person",
    title: "Lena Brückner",
    content: "Projektleiterin bei Nordwind Energie (Windpark-Projekt). Erreichbar per E-Mail und Telegram, meist ab 14 Uhr telefonisch.",
    confidence: 0.9,
    tags: ["projekt", "kontakt"],
    entities: [entity("person", "ent_brueckner", "Lena Brückner"), entity("project", "ent_nordwind", "Windpark Nordwind")],
    provenance: { kind: "conversation" },
    ageDays: 150,
    confirmed: true,
    usage: 51,
    lastUsedAgoMs: 100 * MIN,
  },
  {
    type: "person",
    title: "Jens Kühnemann",
    content: "Inhaber Kühnemann Haustechnik, Elektro- und Heizungsarbeiten, zuständig für die Vorarbeiten an der PV-Anlage.",
    confidence: 0.88,
    tags: ["handwerker", "kontakt"],
    entities: [entity("person", "ent_kuehnemann", "Jens Kühnemann")],
    provenance: { kind: "import", description: "Aus Kontaktimport" },
    ageDays: 95,
    usage: 17,
    lastUsedAgoMs: 6 * HOUR,
  },
  {
    type: "company",
    title: "Nordlicht IT-Systeme GmbH",
    content: "IT-Dienstleister in Hannover. Wartungsvertrag Serverraum läuft bis 31.10.2026, Verlängerung um 24 Monate liegt zur Unterschrift vor.",
    confidence: 0.94,
    tags: ["it", "vertrag", "lieferant"],
    entities: [entity("company", "ent_nordlicht", "Nordlicht IT-Systeme GmbH")],
    provenance: { kind: "conversation", referenceId: "thr_nordlicht" },
    ageDays: 400,
    confirmed: true,
    usage: 58,
    lastUsedAgoMs: 3 * HOUR,
  },
  {
    type: "company",
    title: "Hoffmann Logistik AG",
    content: "Kunde im Bereich Lagerlogistik. Rechnung 2026-0917 über 6.180,00 EUR ist überfällig. Ansprechpartnerin Dr. Miriam Hoffmann.",
    confidence: 0.91,
    tags: ["kunde", "rechnung"],
    entities: [entity("company", "ent_hoffmann", "Hoffmann Logistik AG"), entity("person", "ent_hoffmann_m", "Dr. Miriam Hoffmann")],
    provenance: { kind: "sync", referenceId: "mock-communication" },
    ageDays: 280,
    confirmed: true,
    usage: 29,
    lastUsedAgoMs: 8 * HOUR,
  },
  {
    type: "project",
    title: "Projekt Leuchtturm",
    content: "ERP-Migration mit wöchentlichem Standup (Donnerstag 09:00), Architektur-Workshop am 22.10. Verantwortlich: Erik Brandt.",
    confidence: 0.95,
    tags: ["projekt", "erp"],
    entities: [entity("project", "ent_leuchtturm", "Projekt Leuchtturm")],
    provenance: { kind: "conversation" },
    ageDays: 110,
    confirmed: true,
    pinned: true,
    usage: 133,
    lastUsedAgoMs: 25 * MIN,
  },
  {
    type: "project",
    title: "Büroumzug Hannover-Linden",
    content: "Umzug im November 2026. Offen: Möbelauswahl (Büro-Nord favorisiert), Netzwerkplan, Schlüsselübergabe am 19.10.",
    confidence: 0.9,
    tags: ["umzug", "büro"],
    entities: [entity("project", "ent_umzug", "Büroumzug Hannover-Linden"), entity("place", "ent_linden", "Hannover-Linden")],
    provenance: { kind: "conversation" },
    ageDays: 45,
    usage: 71,
    lastUsedAgoMs: 20 * MIN,
  },
  {
    type: "project",
    title: "Photovoltaik-Anlage Gartenstraße",
    content: "Geplante Anlage mit 9,8 kWp und Batteriespeicher. Förderrecherche abgeschlossen, Angebot von Kühnemann Haustechnik ausstehend.",
    confidence: 0.82,
    tags: ["photovoltaik", "privat"],
    entities: [entity("project", "ent_pv", "PV-Anlage Gartenstraße")],
    provenance: { kind: "conversation" },
    ageDays: 30,
    usage: 22,
    lastUsedAgoMs: 3 * DAY,
  },
  {
    type: "relationship",
    title: "Becker und Nordlicht",
    content: "Frau Becker wird von Nordlicht IT-Systeme betreut und hat Erik Brandt dort empfohlen.",
    confidence: 0.7,
    tags: ["beziehung", "empfehlung"],
    entities: [entity("person", "ent_becker_k", "Katharina Becker"), entity("company", "ent_nordlicht", "Nordlicht IT-Systeme GmbH")],
    provenance: { kind: "inference", description: "Aus zwei E-Mail-Threads abgeleitet" },
    ageDays: 66,
    usage: 3,
    lastUsedAgoMs: 12 * DAY,
  },
  {
    type: "relationship",
    title: "Brückner und Ostermann",
    content: "Lena Brückner arbeitet im Projekt Nordwind eng mit Matthias Ostermann (Ostermann Elektro) zusammen.",
    confidence: 0.76,
    tags: ["beziehung", "projekt"],
    entities: [entity("person", "ent_brueckner", "Lena Brückner"), entity("person", "ent_ostermann", "Matthias Ostermann")],
    provenance: { kind: "inference" },
    ageDays: 38,
    usage: 4,
    lastUsedAgoMs: 8 * DAY,
  },
  {
    type: "instruction",
    title: "Niemals ohne Freigabe senden",
    content: "E-Mails und Nachrichten immer nur als Entwurf anlegen. Versand ausschließlich nach ausdrücklicher Freigabe durch Erik.",
    confidence: 1,
    tags: ["sicherheit", "regel"],
    locked: true,
    pinned: true,
    provenance: { kind: "manual" },
    ageDays: 150,
    confirmed: true,
    usage: 530,
    lastUsedAgoMs: 2 * MIN,
  },
  {
    type: "instruction",
    title: "Rechnungen vor Zahlung prüfen",
    content: "Vor jeder Zahlungsfreigabe Rechnung mit Bestellung und Leistungsnachweis abgleichen und Abweichungen nennen.",
    confidence: 0.99,
    tags: ["rechnung", "regel"],
    locked: true,
    provenance: { kind: "manual" },
    ageDays: 100,
    confirmed: true,
    usage: 27,
    lastUsedAgoMs: 25 * MIN,
  },
  {
    type: "instruction",
    title: "Keine Anrufe nach 21 Uhr",
    content: "Zwischen 21:00 und 07:00 Uhr keine Telefonanrufe auslösen, außer bei Priorität P0.",
    confidence: 0.97,
    tags: ["benachrichtigung", "regel"],
    provenance: { kind: "conversation" },
    ageDays: 80,
    confirmed: true,
    usage: 9,
    lastUsedAgoMs: 4 * DAY,
  },
  {
    type: "episode",
    title: "Windows-Update scheitert am Worker",
    content: "Am 14.10. brach der Update-Lauf auf dem Windows-Worker nach einem Timeout ab. Dienste liefen unverändert weiter.",
    confidence: 0.99,
    tags: ["vorfall", "system"],
    provenance: { kind: "sync", referenceId: "mock-system" },
    ageDays: 0,
    ttlDays: 30,
    expiresInMs: 30 * DAY,
    usage: 2,
    lastUsedAgoMs: 30 * MIN,
    agentKey: "system",
  },
  {
    type: "episode",
    title: "Gespräch mit Frau Dr. Hoffmann am 02.10.",
    content: "Frau Dr. Hoffmann sagte zu, die Rechnung nach Rückkehr aus dem Urlaub zu prüfen. Nachfassen nach dem 12.10.",
    confidence: 0.8,
    tags: ["kunde", "gespräch"],
    entities: [entity("person", "ent_hoffmann_m", "Dr. Miriam Hoffmann")],
    provenance: { kind: "conversation" },
    ageDays: 12,
    ttlDays: 60,
    expiresInMs: 48 * DAY,
    usage: 4,
    lastUsedAgoMs: 5 * DAY,
  },
  {
    type: "decision",
    title: "Büromöbel: Büro-Nord bevorzugt",
    content: "Vorläufige Entscheidung für Büro-Nord Einrichtungen wegen Lieferzeit unter vier Wochen. Endgültig nach Klärung der Montagekosten.",
    confidence: 0.65,
    tags: ["entscheidung", "büro"],
    entities: [entity("company", "ent_buero_nord", "Büro-Nord Einrichtungen GmbH")],
    provenance: { kind: "inference", description: "Aus Angebotsvergleich abgeleitet" },
    ageDays: 0,
    usage: 3,
    lastUsedAgoMs: 20 * MIN,
  },
  {
    type: "decision",
    title: "Private Texte nur lokal verarbeiten",
    content: "Private oder sensible Texte werden ausschließlich mit dem lokalen Modell (Qwen Local) verarbeitet, nie mit Cloud-Modellen.",
    confidence: 1,
    tags: ["datenschutz", "modell"],
    locked: true,
    sensitivity: "restricted",
    provenance: { kind: "manual" },
    ageDays: 130,
    confirmed: true,
    usage: 188,
    lastUsedAgoMs: 9 * MIN,
  },
  {
    type: "fact",
    title: "Bankverbindung Geschäftskonto",
    content: "Geschäftskonto bei der Hannoverschen Volksbank, IBAN endet auf 4821 00. Vollständige Daten liegen nur im Tresor.",
    confidence: 0.99,
    tags: ["bank", "finanzen"],
    locked: true,
    sensitivity: "restricted",
    provenance: { kind: "manual" },
    ageDays: 200,
    confirmed: true,
    usage: 8,
    lastUsedAgoMs: 25 * MIN,
  },
  {
    type: "fact",
    title: "Gutschein Büro-Nord",
    content: "15 Prozent Rabatt bei Büro-Nord Einrichtungen, gültig bis 30.09.2026.",
    confidence: 0.55,
    tags: ["rabatt", "büro"],
    provenance: { kind: "import", description: "Aus Newsletter extrahiert" },
    ageDays: 40,
    ttlDays: 35,
    expiresInMs: -5 * DAY,
    usage: 1,
    lastUsedAgoMs: 20 * DAY,
  },
];

function historyFor(
  ctx: SeedContext,
  spec: MemorySpec,
  createdAgoMs: number,
  actor: Actor,
  agentActor: Actor,
): MemoryHistoryEntry[] {
  const entries: MemoryHistoryEntry[] = [
    {
      version: 1,
      changedAt: ctx.at(-createdAgoMs),
      actor: spec.provenance.kind === "manual" ? actor : agentActor,
      change: "created",
      summary: "Eintrag angelegt.",
      before: null,
      after: spec.content,
    },
  ];
  if (spec.confirmed) {
    entries.push({
      version: 2,
      changedAt: ctx.at(-Math.max(createdAgoMs - 2 * HOUR, HOUR)),
      actor,
      change: "confirmed",
      summary: "Vom Benutzer bestätigt.",
      before: null,
      after: null,
    });
  }
  if (spec.pinned) {
    entries.push({
      version: entries.length + 1,
      changedAt: ctx.at(-Math.max(createdAgoMs - 4 * HOUR, HOUR)),
      actor,
      change: "pinned",
      summary: "Angeheftet.",
      before: null,
      after: null,
    });
  }
  if (spec.locked) {
    entries.push({
      version: entries.length + 1,
      changedAt: ctx.at(-Math.max(createdAgoMs - 6 * HOUR, HOUR)),
      actor,
      change: "locked",
      summary: "Gegen automatische Änderungen gesperrt.",
      before: null,
      after: null,
    });
  }
  return entries;
}

export function buildCuratedMemory(ctx: SeedContext, story: Story, agentNames: Record<string, string>): Memory[] {
  const ids = { conflictA: ctx.id("mem"), conflictB: ctx.id("mem") };
  return SPECS.map((spec) => {
    const createdAgoMs = Math.max(spec.ageDays * DAY, 20 * MIN);
    const agentId = story.agents[spec.agentKey ?? "memory"];
    const agentActor: Actor = { type: "agent", id: agentId, name: agentNames[agentId] ?? "Memory-Agent" };
    const history = historyFor(ctx, spec, createdAgoMs, ctx.owner, agentActor);
    const conflicts: Memory["conflicts"] =
      spec.id === "conflictA"
        ? [{ memoryId: ids.conflictB, reason: "Zahlungsziel widerspricht dem Rahmenvertrag (14 gegen 30 Tage).", detectedAt: ctx.at(-2 * DAY), resolution: "pending" }]
        : spec.id === "conflictB"
          ? [{ memoryId: ids.conflictA, reason: "Zahlungsziel widerspricht der geschätzten Zahlungsdauer (30 gegen 14 Tage).", detectedAt: ctx.at(-2 * DAY), resolution: "pending" }]
          : [];
    const memory: Memory = {
      id: spec.id ? ids[spec.id] : ctx.id("mem"),
      version: history.length,
      createdAt: ctx.at(-createdAgoMs),
      updatedAt: ctx.at(-Math.max(MIN, Math.min(createdAgoMs, (spec.lastUsedAgoMs ?? DAY) + HOUR))),
      source: ctx.src("memory"),
      type: spec.type,
      title: spec.title,
      content: spec.content,
      confidence: spec.confidence,
      confirmedAt: spec.confirmed ? ctx.at(-Math.max(createdAgoMs - 2 * HOUR, HOUR)) : null,
      expiresAt: spec.expiresInMs !== undefined ? ctx.at(spec.expiresInMs) : null,
      tags: spec.tags,
      entities: spec.entities ?? [],
      locked: spec.locked ?? false,
      pinned: spec.pinned ?? false,
      sensitivity: spec.sensitivity ?? "normal",
      provenance: spec.provenance,
      usageCount: spec.usage,
      lastUsedAt: spec.lastUsedAgoMs !== undefined ? ctx.at(-spec.lastUsedAgoMs) : null,
      conflicts,
      history,
    };
    if (spec.ttlDays !== undefined) memory.ttlSeconds = spec.ttlDays * 86_400;
    return memory;
  });
}

const BULK_TYPES: MemoryType[] = ["profile", "preference", "fact", "person", "company", "project", "relationship", "instruction", "episode", "decision"];
const BULK_TOPICS = [
  "Lieferzeiten",
  "Ansprechpartner",
  "Zahlungsmodalitäten",
  "Terminpräferenz",
  "Projektstatus",
  "Dateiformat",
  "Reisebuchung",
  "Vertragsdetails",
];
const BULK_ORGS = ["Wegener Bau GmbH", "Ostermann Elektro", "Lührs Beratung", "Zander Logistik", "Stadtwerke Hannover", "Möller Metallbau"];

export function buildBulkMemory(ctx: SeedContext, story: Story, count: number): Memory[] {
  const out: Memory[] = [];
  for (let i = 0; i < count; i++) {
    const type = BULK_TYPES[i % BULK_TYPES.length] as MemoryType;
    const org = ctx.rng.pick(BULK_ORGS);
    const topic = ctx.rng.pick(BULK_TOPICS);
    const createdAgo = ctx.rng.int(1, 300) * DAY;
    const confidence = Math.round(ctx.rng.float(0.4, 1) * 100) / 100;
    const locked = ctx.rng.chance(0.06);
    const expired = ctx.rng.chance(0.05);
    out.push({
      id: ctx.id("mem"),
      version: 1,
      createdAt: ctx.at(-createdAgo),
      updatedAt: ctx.at(-ctx.rng.int(1, createdAgo / MIN)),
      source: ctx.src("memory"),
      type,
      title: `${topic} – ${org}`,
      content: `${org}: ${topic} wurde im Austausch festgehalten und gilt bis auf Widerruf.`,
      confidence,
      confirmedAt: confidence > 0.8 ? ctx.at(-ctx.rng.int(1, 40) * DAY) : null,
      expiresAt: expired ? ctx.at(-ctx.rng.int(1, 30) * DAY) : ctx.rng.chance(0.15) ? ctx.at(ctx.rng.int(1, 90) * DAY) : null,
      tags: [topic.toLowerCase(), type],
      entities: [entity("company", `ent_bulk_${i % 7}`, org)],
      locked,
      pinned: ctx.rng.chance(0.04),
      sensitivity: ctx.rng.weighted<MemorySensitivity>([["normal", 88], ["sensitive", 9], ["restricted", 3]]),
      provenance: { kind: ctx.rng.pick<MemoryProvenance["kind"]>(["conversation", "import", "inference", "sync", "manual"]) },
      usageCount: ctx.rng.int(0, 90),
      lastUsedAt: ctx.rng.chance(0.8) ? ctx.at(-ctx.rng.int(1, 60 * 24 * 10) * MIN) : null,
      conflicts: [],
      history: [
        {
          version: 1,
          changedAt: ctx.at(-createdAgo),
          actor: { type: "agent", id: story.agents.memory, name: "Memory-Agent" },
          change: "created",
          summary: "Eintrag angelegt.",
          before: null,
          after: null,
        },
      ],
    });
  }
  return out;
}
