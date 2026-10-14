import type { EntityRef, Notification, Priority } from "@jarvis/sdk";
import { DAY, HOUR, MIN, type SeedContext } from "./context";
import type { Story } from "./story";

type Channel = Notification["escalation"][number]["channel"];
type Category = Notification["category"];
type Status = Notification["status"];

interface NotificationSpec {
  priority: Priority;
  category: Category;
  title: string;
  body: string;
  status: Status;
  createdAgoMs: number;
  chain: Channel[];
  /** Delay between escalation steps in ms. */
  stepMs: number;
  /** How many steps have been sent already (the rest is pending). */
  sent: number;
  ackAfterMs?: number;
  snoozeForMs?: number;
  ref?: (story: Story) => { ref: EntityRef; route: string };
}

const SPECS: NotificationSpec[] = [
  {
    priority: "P1",
    category: "adapter",
    title: "Windows-Worker antwortet verzögert",
    body: "Der Windows-Worker benötigt im Mittel 2,1 Sekunden pro Anfrage; der letzte Update-Lauf wurde abgebrochen.",
    status: "open",
    createdAgoMs: 3 * HOUR,
    chain: ["dashboard", "telegram"],
    stepMs: 10 * MIN,
    sent: 2,
  },
  {
    priority: "P1",
    category: "approval",
    title: "Freigabe erforderlich: Zahlung über 4.287,60 EUR",
    body: "Die Zahlung an Nordlicht IT-Systeme GmbH benötigt Re-Authentifizierung (Risikostufe 3).",
    status: "open",
    createdAgoMs: 25 * MIN,
    chain: ["dashboard", "telegram", "phone"],
    stepMs: 10 * MIN,
    sent: 2,
    ref: (story) => ({
      ref: { type: "approval", id: story.approvals.zahlung, label: "Zahlung Nordlicht IT-Systeme" },
      route: `/approvals?approval=${story.approvals.zahlung}`,
    }),
  },
  {
    priority: "P2",
    category: "mail",
    title: "Wichtige Mail von Katharina Becker",
    body: "Bitte um schriftliche Terminbestätigung für den 21.10. Ein Antwortentwurf liegt zur Freigabe vor.",
    status: "open",
    createdAgoMs: 3 * HOUR,
    chain: ["dashboard"],
    stepMs: 0,
    sent: 1,
    ref: (story) => ({
      ref: { type: "thread", id: story.threads.becker, label: "Terminbestätigung 21.10." },
      route: `/communication?thread=${story.threads.becker}`,
    }),
  },
  {
    priority: "P2",
    category: "calendar",
    title: "Terminkonflikt am Donnerstag, 22.10.",
    body: "Lieferantengespräch und Workshop Projekt Leuchtturm überschneiden sich. Verschiebung wurde zur Freigabe vorgeschlagen.",
    status: "open",
    createdAgoMs: 2 * HOUR,
    chain: ["dashboard"],
    stepMs: 0,
    sent: 1,
    ref: (story) => ({
      ref: { type: "calendar_event", id: story.events.lieferanten, label: "Lieferantengespräch" },
      route: `/calendar?event=${story.events.lieferanten}`,
    }),
  },
  {
    priority: "P2",
    category: "security",
    title: "Verdächtige E-Mail erkannt",
    body: "Die Nachricht 'Wichtiger Sicherheitshinweis zu Ihrem Konto' wirkt wie Phishing (Absenderdomain stimmt nicht mit der Bank überein).",
    status: "open",
    createdAgoMs: 50 * MIN,
    chain: ["dashboard", "telegram"],
    stepMs: 15 * MIN,
    sent: 2,
    ref: (story) => ({
      ref: { type: "thread", id: story.threads.bank, label: "Sicherheitshinweis zum Konto" },
      route: `/communication?thread=${story.threads.bank}`,
    }),
  },
  {
    priority: "P3",
    category: "task",
    title: "Aufgabe fehlgeschlagen: Windows-Updates",
    body: "Die Aufgabe 'Windows-Updates auf dem Worker einspielen' wurde nach einem Timeout abgebrochen.",
    status: "acknowledged",
    createdAgoMs: 3 * HOUR,
    chain: ["dashboard"],
    stepMs: 0,
    sent: 1,
    ackAfterMs: 20 * MIN,
    ref: (story) => ({
      ref: { type: "task", id: story.tasks.windowsUpdates, label: "Windows-Updates einspielen" },
      route: `/tasks?task=${story.tasks.windowsUpdates}`,
    }),
  },
  {
    priority: "P3",
    category: "voice",
    title: "Gastprofil Büro ist nicht kalibriert",
    body: "Für das Gastprofil liegen nur sechs Sprachproben vor. Die Sprecherverifikation ist unzuverlässig.",
    status: "snoozed",
    createdAgoMs: 1 * DAY,
    chain: ["dashboard"],
    stepMs: 0,
    sent: 1,
    snoozeForMs: 2 * HOUR,
  },
  {
    priority: "P3",
    category: "automation",
    title: "Automation 'Terminkonflikte melden' fehlgeschlagen",
    body: "Beim letzten Lauf war der Task-Adapter nicht erreichbar. Der Konflikt wurde dennoch im Kalender markiert.",
    status: "resolved",
    createdAgoMs: 3 * DAY,
    chain: ["dashboard"],
    stepMs: 0,
    sent: 1,
    ackAfterMs: 30 * MIN,
    ref: (story) => ({
      ref: { type: "automation", id: story.automations.terminKonflikt, label: "Terminkonflikte melden" },
      route: `/automations?automation=${story.automations.terminKonflikt}`,
    }),
  },
  {
    priority: "P4",
    category: "system",
    title: "Backup erfolgreich verifiziert",
    body: "Die Sicherung vom 13.10.2026 (12,4 GB) wurde geprüft, alle 1 482 Prüfsummen stimmen.",
    status: "resolved",
    createdAgoMs: 14 * HOUR,
    chain: ["dashboard"],
    stepMs: 0,
    sent: 1,
    ackAfterMs: HOUR,
    ref: (story) => ({
      ref: { type: "task", id: story.tasks.backup, label: "Backup-Verifikation" },
      route: `/tasks?task=${story.tasks.backup}`,
    }),
  },
  {
    priority: "P4",
    category: "system",
    title: "Neue Version der Control API verfügbar",
    body: "Version 1.0.1 enthält Korrekturen für den Event-Stream. Installation erfolgt nur nach Bestätigung.",
    status: "open",
    createdAgoMs: 1 * DAY + 2 * HOUR,
    chain: ["dashboard"],
    stepMs: 0,
    sent: 1,
  },
];

export function buildEscalation(
  ctx: SeedContext,
  chain: Channel[],
  createdAgoMs: number,
  stepMs: number,
  sent: number,
  ackAfterMs?: number,
): Notification["escalation"] {
  return chain.map((channel, index) => {
    const scheduledOffset = -createdAgoMs + index * stepMs;
    const wasSent = index < sent;
    const acknowledged = wasSent && ackAfterMs !== undefined && index === sent - 1;
    return {
      step: index + 1,
      channel,
      state: acknowledged ? "acknowledged" : wasSent ? "sent" : ackAfterMs !== undefined ? "skipped" : "pending",
      scheduledAt: ctx.at(scheduledOffset),
      sentAt: wasSent ? ctx.at(scheduledOffset + 2_000) : null,
      acknowledgedAt: acknowledged ? ctx.at(-createdAgoMs + ackAfterMs) : null,
    };
  });
}

export function buildNotifications(ctx: SeedContext, story: Story): Notification[] {
  return SPECS.map((spec) => {
    const target = spec.ref ? spec.ref(story) : null;
    const ackAt = spec.ackAfterMs !== undefined ? ctx.at(-spec.createdAgoMs + spec.ackAfterMs) : null;
    const resolved = spec.status === "resolved";
    const notification: Notification = {
      id: ctx.id("ntf"),
      version: resolved ? 3 : spec.status === "open" ? 1 : 2,
      createdAt: ctx.at(-spec.createdAgoMs),
      updatedAt: ctx.at(-Math.max(MIN, spec.createdAgoMs - (spec.ackAfterMs ?? 0))),
      source: ctx.src("notifications"),
      priority: spec.priority,
      category: spec.category,
      title: spec.title,
      body: spec.body,
      status: spec.status,
      acknowledged: spec.status === "acknowledged" || resolved,
      acknowledgedAt: ackAt,
      snoozedUntil: spec.snoozeForMs !== undefined ? ctx.at(spec.snoozeForMs) : null,
      resolved,
      resolvedAt: resolved ? ctx.at(-spec.createdAgoMs + (spec.ackAfterMs ?? 0) + 5 * MIN) : null,
      escalation: buildEscalation(ctx, spec.chain, spec.createdAgoMs, spec.stepMs, spec.sent, spec.ackAfterMs),
      sourceRef: target?.ref ?? null,
      targetRoute: target?.route ?? null,
    };
    return notification;
  });
}

const BULK_TITLES: { category: Category; title: string }[] = [
  { category: "task", title: "Aufgabe abgeschlossen" },
  { category: "mail", title: "Neue wichtige Mail" },
  { category: "calendar", title: "Termin beginnt in 15 Minuten" },
  { category: "system", title: "Speicherplatz auf D:\\ wird knapp" },
  { category: "adapter", title: "Adapter antwortet langsam" },
  { category: "automation", title: "Automation ausgeführt" },
  { category: "approval", title: "Neue Freigabe erforderlich" },
  { category: "voice", title: "Sprecherprofil aktualisiert" },
];

export function buildBulkNotifications(ctx: SeedContext, count: number): Notification[] {
  const out: Notification[] = [];
  for (let i = 0; i < count; i++) {
    const template = ctx.rng.pick(BULK_TITLES);
    const priority = ctx.rng.weighted<Priority>([["P1", 12], ["P2", 28], ["P3", 40], ["P4", 20]]);
    const status = ctx.rng.weighted<Status>([["open", 35], ["acknowledged", 20], ["snoozed", 5], ["resolved", 40]]);
    const createdAgo = ctx.rng.int(5, 60 * 24 * 7) * MIN;
    const resolved = status === "resolved";
    out.push({
      id: ctx.id("ntf"),
      version: 1,
      createdAt: ctx.at(-createdAgo),
      updatedAt: ctx.at(-createdAgo + MIN),
      source: ctx.src("notifications"),
      priority,
      category: template.category,
      title: `${template.title} (${i + 1})`,
      body: "Automatisch erzeugte Benachrichtigung (Mock-Daten).",
      status,
      acknowledged: status === "acknowledged" || resolved,
      acknowledgedAt: status === "acknowledged" || resolved ? ctx.at(-createdAgo + 2 * MIN) : null,
      snoozedUntil: status === "snoozed" ? ctx.at(ctx.rng.int(10, 600) * MIN) : null,
      resolved,
      resolvedAt: resolved ? ctx.at(-createdAgo + 5 * MIN) : null,
      escalation: buildEscalation(ctx, ["dashboard"], createdAgo, 0, 1, status === "open" ? undefined : 2 * MIN),
      sourceRef: null,
      targetRoute: null,
    });
  }
  return out;
}
