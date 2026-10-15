import type {
  Approval,
  ApprovalImpact,
  ApprovalPreview,
  ApprovalStatus,
  ApprovalType,
  EntityRef,
  RequiredAuth,
  RiskTier,
} from "@friday/sdk";
import { DAY, HOUR, MIN, type SeedContext } from "./context";
import type { AgentKey, ApprovalKey, Story, TaskKey } from "./story";

interface ApprovalSpec {
  key: ApprovalKey;
  type: ApprovalType;
  action: string;
  tier: RiskTier;
  agent: AgentKey;
  task?: TaskKey;
  rationale: string;
  impacts: ApprovalImpact[];
  preview: ApprovalPreview;
  expiresInMs: number | null;
  status: ApprovalStatus;
  createdAgoMs: number;
  decidedAgoMs?: number;
  comment?: string;
  executionResult?: string;
  editable: boolean;
  sourceRef?: (story: Story) => EntityRef;
}

const tierAuth = (tier: RiskTier): RequiredAuth => (tier === 3 ? "reauth" : tier === 2 ? "confirm" : "none");

const SPECS: ApprovalSpec[] = [
  {
    key: "beckerMail",
    type: "send_email",
    action: "E-Mail an Frau Becker senden",
    tier: 2,
    agent: "kommunikation",
    task: "becker",
    rationale: "Frau Becker hat um eine Terminbestätigung gebeten; der Entwurf liegt vor und der Termin ist im Kalender frei.",
    impacts: [{ kind: "communication", description: "Externe Person erhält eine verbindliche Terminzusage.", severity: "warning" }],
    preview: {
      kind: "email",
      title: "Terminbestätigung 21.10.",
      body: "Sehr geehrte Frau Becker,\n\ngerne bestätige ich unseren Termin am 21.10.2026 um 10:00 Uhr in Hannover.\n\nMit freundlichen Grüßen\nErik Brandt",
      fields: [
        { label: "An", value: "k.becker@becker-maschinenbau.example" },
        { label: "Betreff", value: "Terminbestätigung 21.10." },
      ],
    },
    expiresInMs: 60 * MIN,
    status: "pending",
    createdAgoMs: 15 * MIN,
    editable: true,
    sourceRef: (story) => ({ type: "draft", id: story.drafts.becker, label: "Entwurf Terminbestätigung" }),
  },
  {
    key: "terminVerschieben",
    type: "change_event",
    action: "Lieferantengespräch von Donnerstag auf Freitag verschieben",
    tier: 2,
    agent: "kalender",
    task: "kalenderKw43",
    rationale: "Das Lieferantengespräch überschneidet sich mit dem Workshop Projekt Leuchtturm. Freitag 09:30 Uhr ist für alle Teilnehmer frei.",
    impacts: [
      { kind: "schedule", description: "Zwei externe Teilnehmer erhalten eine Terminänderung.", severity: "warning" },
      { kind: "communication", description: "Einladung wird aktualisiert und versendet.", severity: "info" },
    ],
    preview: {
      kind: "calendar",
      title: "Lieferantengespräch Nordlicht IT",
      body: "Termin wird um einen Tag verschoben, die Dauer von 60 Minuten bleibt gleich.",
      fields: [
        { label: "Bisher", value: "Do 22.10.2026, 14:00–15:00" },
        { label: "Neu", value: "Fr 23.10.2026, 09:30–10:30" },
        { label: "Teilnehmer", value: "J. Kühnemann, M. Hoffmann" },
      ],
    },
    expiresInMs: 1 * DAY,
    status: "pending",
    createdAgoMs: 40 * MIN,
    editable: true,
    sourceRef: (story) => ({ type: "calendar_event", id: story.events.lieferanten, label: "Lieferantengespräch" }),
  },
  {
    key: "backupLoeschen",
    type: "delete_file",
    action: "Altes Backup dashboard-backup-2026-08.zip löschen",
    tier: 2,
    agent: "system",
    rationale: "Die Sicherung ist älter als 60 Tage und durch drei neuere Sicherungen ersetzt. Löschen gibt 1,8 GB auf D:\\ frei.",
    impacts: [{ kind: "data", description: "Datei wird dauerhaft gelöscht und kann nicht wiederhergestellt werden.", severity: "warning" }],
    preview: {
      kind: "file",
      title: "dashboard-backup-2026-08.zip",
      body: "Pfad: D:\\Friday\\Backups\\alt\\dashboard-backup-2026-08.zip\nGröße: 1,8 GB\nErstellt: 15.08.2026",
      fields: [
        { label: "Speicherort", value: "D:\\Friday\\Backups\\alt" },
        { label: "Freigegebener Speicher", value: "1,8 GB" },
      ],
    },
    expiresInMs: 2 * DAY,
    status: "pending",
    createdAgoMs: 2 * HOUR,
    editable: false,
    sourceRef: (story) => ({ type: "file", id: story.files.altesBackup, label: "dashboard-backup-2026-08.zip" }),
  },
  {
    key: "bestellung",
    type: "order",
    action: "Anzahlung für Büromöbel bei Büro-Nord Einrichtungen leisten",
    tier: 2,
    agent: "recherche",
    task: "bueromoebel",
    rationale: "Büro-Nord ist im Vergleich der günstigste Anbieter mit Lieferzeit unter vier Wochen. Die Anzahlung sichert den Liefertermin vor dem Umzug.",
    impacts: [
      { kind: "money", description: "Anzahlung über 2.000,00 EUR wird fällig.", severity: "warning" },
      { kind: "legal", description: "Die Bestellung ist nach Bestätigung verbindlich.", severity: "warning" },
    ],
    preview: {
      kind: "order",
      title: "Bestellung Büro-Nord Einrichtungen GmbH",
      body: "6 Schreibtische höhenverstellbar, 6 Bürostühle, 2 Rollcontainer.\nGesamtpreis netto 11.840,00 EUR, Lieferung in 3 Wochen.",
      fields: [
        { label: "Anbieter", value: "Büro-Nord Einrichtungen GmbH, Hannover" },
        { label: "Anzahlung", value: "2.000,00 EUR" },
        { label: "Lieferung", value: "KW 46" },
      ],
    },
    expiresInMs: 1 * DAY + 4 * HOUR,
    status: "pending",
    createdAgoMs: 30 * MIN,
    editable: true,
  },
  {
    key: "zahlung",
    type: "payment",
    action: "Rechnung 2026-1142 der Nordlicht IT-Systeme GmbH bezahlen",
    tier: 3,
    agent: "kommunikation",
    task: "rechnung",
    rationale: "Rechnung stimmt mit Bestellung und Leistungsnachweis überein. Zahlungsziel ist der 28.10.2026 (Skonto bis 21.10.).",
    impacts: [{ kind: "money", description: "Überweisung über 4.287,60 EUR brutto.", severity: "critical" }],
    preview: {
      kind: "payment",
      title: "Überweisung Nordlicht IT-Systeme GmbH",
      body: "Rechnung 2026-1142 vom 06.10.2026, Wartung und Support Q3.",
      fields: [
        { label: "Empfänger", value: "Nordlicht IT-Systeme GmbH" },
        { label: "IBAN", value: "DE•• •••• •••• •••• 4821 00" },
        { label: "Betrag", value: "4.287,60 EUR" },
        { label: "Verwendungszweck", value: "RE 2026-1142" },
      ],
    },
    expiresInMs: 2 * DAY,
    status: "pending",
    createdAgoMs: 25 * MIN,
    editable: false,
  },
  {
    key: "vertrag",
    type: "contract",
    action: "Wartungsvertrag Serverraum mit Nordlicht IT-Systeme unterzeichnen",
    tier: 3,
    agent: "task",
    rationale: "Der Vertrag verlängert die Wartung um 24 Monate zu unveränderten Konditionen. Kündigungsfrist 3 Monate zum Laufzeitende.",
    impacts: [
      { kind: "legal", description: "Rechtlich bindende Laufzeit von 24 Monaten.", severity: "critical" },
      { kind: "money", description: "Jährliche Kosten 3.540,00 EUR netto.", severity: "warning" },
    ],
    preview: {
      kind: "contract",
      title: "Wartungsvertrag Serverraum",
      body: "Vertragspartner: Nordlicht IT-Systeme GmbH. Laufzeit 01.11.2026 bis 31.10.2028. Reaktionszeit 4 Stunden an Werktagen.",
      fields: [
        { label: "Laufzeit", value: "24 Monate" },
        { label: "Kosten p. a.", value: "3.540,00 EUR netto" },
      ],
    },
    expiresInMs: 3 * DAY,
    status: "pending",
    createdAgoMs: 5 * HOUR,
    editable: false,
  },
  {
    key: "systemUpdate",
    type: "system_change",
    action: "Windows-Updates auf dem Worker installieren",
    tier: 2,
    agent: "system",
    task: "windowsUpdates",
    rationale: "Sicherheitsupdates vom Oktober-Patchday stehen bereit; der Neustart ist für die Nachtstunden geplant.",
    impacts: [{ kind: "system", description: "Windows-Worker startet einmalig neu (ca. 6 Minuten Ausfall).", severity: "warning" }],
    preview: {
      kind: "command",
      title: "Installation Patchday Oktober",
      body: "Befehl: wuinstall --security --reboot-after\nBetroffen: windows-worker",
    },
    expiresInMs: null,
    status: "executed",
    createdAgoMs: 3 * HOUR + 30 * MIN,
    decidedAgoMs: 3 * HOUR + 12 * MIN,
    comment: "Freigegeben, Neustart nach Mitternacht.",
    executionResult: "Updates wurden heruntergeladen. Die Installation wurde durch einen Timeout des Workers abgebrochen.",
    editable: false,
  },
  {
    key: "telegramNachricht",
    type: "send_message",
    action: "Telegram-Nachricht an Lena Brückner senden",
    tier: 1,
    agent: "kommunikation",
    rationale: "Statusmeldung zum Windpark-Projekt: Unterlagen sind vollständig. Nachricht bestätigt den Erhalt.",
    impacts: [{ kind: "communication", description: "Externe Person erhält eine kurze Statusnachricht.", severity: "info" }],
    preview: {
      kind: "message",
      title: "Telegram an Lena Brückner",
      body: "Hallo Lena, die Unterlagen für Nordwind sind vollständig eingegangen. Ich melde mich morgen mit den offenen Punkten.",
      fields: [{ label: "Kanal", value: "Telegram" }],
    },
    expiresInMs: null,
    status: "rejected",
    createdAgoMs: 1 * DAY + 2 * HOUR,
    decidedAgoMs: 1 * DAY + 1 * HOUR,
    comment: "Nicht nötig, ich rufe sie selbst an.",
    editable: true,
  },
  {
    key: "abgelaufen",
    type: "send_email",
    action: "Zahlungserinnerung an Hoffmann Logistik AG senden",
    tier: 2,
    agent: "kommunikation",
    rationale: "Die Rechnung 2026-0917 ist seit 14 Tagen überfällig. Freundliche Erinnerung ohne Mahngebühr.",
    impacts: [{ kind: "communication", description: "Kunde erhält eine Zahlungserinnerung.", severity: "warning" }],
    preview: {
      kind: "email",
      title: "Zahlungserinnerung RE 2026-0917",
      body: "Sehr geehrte Frau Dr. Hoffmann,\n\nunsere Rechnung 2026-0917 ist noch offen. Bitte prüfen Sie den Zahlungseingang.\n\nMit freundlichen Grüßen\nErik Brandt",
      fields: [{ label: "An", value: "m.hoffmann@hoffmann-logistik.example" }],
    },
    expiresInMs: -6 * HOUR,
    status: "expired",
    createdAgoMs: 2 * DAY,
    editable: true,
  },
  {
    key: "fehlgeschlagen",
    type: "send_email",
    action: "Angebotsanfrage an Arbeitswelt Leine KG senden",
    tier: 2,
    agent: "recherche",
    task: "bueromoebel",
    rationale: "Rückfrage zu den Montagekosten, damit der Angebotsvergleich vollständig wird.",
    impacts: [{ kind: "communication", description: "Externe Anfrage im Namen von Erik Brandt.", severity: "info" }],
    preview: {
      kind: "email",
      title: "Anfrage Montagekosten",
      body: "Guten Tag,\n\nbitte teilen Sie uns die Montagekosten für Ihr Angebot vom 09.10.2026 mit.",
      fields: [{ label: "An", value: "vertrieb@arbeitswelt-leine.example" }],
    },
    expiresInMs: null,
    status: "failed",
    createdAgoMs: 20 * HOUR,
    decidedAgoMs: 19 * HOUR,
    comment: "Bitte senden.",
    executionResult: "Versand fehlgeschlagen: Mail-Adapter meldete ADAPTER_TIMEOUT. Entwurf bleibt erhalten.",
    editable: true,
  },
];

export function buildCuratedApprovals(ctx: SeedContext, story: Story): Approval[] {
  return SPECS.map((spec) => {
    const decided = spec.decidedAgoMs !== undefined;
    const approval: Approval = {
      id: story.approvals[spec.key],
      version: spec.status === "pending" ? 1 : decided ? 3 : 2,
      createdAt: ctx.at(-spec.createdAgoMs),
      updatedAt: ctx.at(-(spec.decidedAgoMs ?? spec.createdAgoMs)),
      source: ctx.src("approvals"),
      type: spec.type,
      action: spec.action,
      riskTier: spec.tier,
      agentId: story.agents[spec.agent],
      taskId: spec.task ? story.tasks[spec.task] : null,
      rationale: spec.rationale,
      impacts: spec.impacts,
      preview: spec.preview,
      expiresAt: spec.expiresInMs === null ? null : ctx.at(spec.expiresInMs),
      requiredAuth: tierAuth(spec.tier),
      status: spec.status,
      decidedAt: decided ? ctx.at(-(spec.decidedAgoMs ?? 0)) : null,
      decidedBy: decided && spec.status !== "expired" ? ctx.owner : null,
      decisionComment: spec.comment ?? null,
      sourceRef: spec.sourceRef ? spec.sourceRef(story) : null,
      editable: spec.editable,
      correlationId: ctx.id("corr"),
    };
    if (spec.executionResult) approval.executionResult = spec.executionResult;
    return approval;
  });
}

const BULK_ACTIONS: { type: ApprovalType; action: string; tier: RiskTier; kind: ApprovalPreview["kind"] }[] = [
  { type: "send_email", action: "E-Mail an den Kunden senden", tier: 2, kind: "email" },
  { type: "send_message", action: "Telegram-Nachricht senden", tier: 1, kind: "message" },
  { type: "change_event", action: "Termin verschieben", tier: 2, kind: "calendar" },
  { type: "delete_file", action: "Temporäre Datei löschen", tier: 1, kind: "file" },
  { type: "order", action: "Bestellung auslösen", tier: 2, kind: "order" },
  { type: "payment", action: "Zahlung freigeben", tier: 3, kind: "payment" },
  { type: "system_change", action: "Dienst neu starten", tier: 2, kind: "command" },
];

const BULK_STATUSES: [ApprovalStatus, number][] = [
  ["pending", 30],
  ["approved", 4],
  ["executed", 24],
  ["rejected", 14],
  ["expired", 10],
  ["cancelled", 10],
  ["failed", 8],
];

export function buildBulkApprovals(ctx: SeedContext, count: number, agentIds: string[], taskIds: string[], forcedStatuses: ApprovalStatus[] = []): Approval[] {
  const approvals: Approval[] = [];
  for (let i = 0; i < count; i++) {
    const template = ctx.rng.pick(BULK_ACTIONS);
    const status = forcedStatuses[i] ?? ctx.rng.weighted(BULK_STATUSES);
    const createdAgo = ctx.rng.int(5, 60 * 24 * 5) * MIN;
    const decided = status !== "pending" && status !== "expired";
    const decidedAgo = Math.max(MIN, createdAgo - ctx.rng.int(1, 120) * MIN);
    approvals.push({
      id: ctx.id("appr"),
      version: decided ? 3 : 1,
      createdAt: ctx.at(-createdAgo),
      updatedAt: ctx.at(-(decided ? decidedAgo : createdAgo)),
      source: ctx.src("approvals"),
      type: template.type,
      action: `${template.action} (${i + 1})`,
      riskTier: template.tier,
      agentId: agentIds.length ? ctx.rng.pick(agentIds) : null,
      taskId: taskIds.length && ctx.rng.chance(0.6) ? ctx.rng.pick(taskIds) : null,
      rationale: "Automatisch vorgeschlagene Aktion aus einer laufenden Aufgabe; bitte Auswirkungen prüfen.",
      impacts: [{ kind: "other", description: "Aktion wirkt sich auf externe Systeme aus.", severity: "info" }],
      preview: { kind: template.kind, title: template.action, body: "Vorschau der geplanten Aktion (Mock-Daten)." },
      expiresAt: status === "pending" ? ctx.at(ctx.rng.int(10, 3000) * MIN) : status === "expired" ? ctx.at(-ctx.rng.int(10, 600) * MIN) : null,
      requiredAuth: tierAuth(template.tier),
      status,
      decidedAt: decided ? ctx.at(-decidedAgo) : null,
      decidedBy: decided ? ctx.owner : null,
      decisionComment: null,
      sourceRef: null,
      editable: template.tier < 3,
      ...(status === "executed" ? { executionResult: "Aktion wurde erfolgreich ausgeführt." } : {}),
      ...(status === "failed" ? { executionResult: "Ausführung fehlgeschlagen: Zielsystem nicht erreichbar." } : {}),
      correlationId: ctx.id("corr"),
    });
  }
  return approvals;
}
