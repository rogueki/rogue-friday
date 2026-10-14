import type {
  Attachment,
  Channel,
  ChannelKind,
  Draft,
  Message,
  Participant,
  Priority,
  Thread,
} from "@jarvis/sdk";
import { DAY, HOUR, MIN, type SeedContext } from "./context";
import { fileSpec } from "./files";
import type { ChannelKey, FileKey, Story, TaskKey, ThreadKey } from "./story";

const ME: Participant = { name: "Erik Brandt", address: "erik.brandt@gmx.example", role: "owner" };

const PEOPLE = {
  becker: { name: "Katharina Becker", address: "k.becker@becker-maschinenbau.example", role: "Kundin" },
  albrecht: { name: "Thomas Albrecht", address: "t.albrecht@albrecht-partner.example", role: "Steuerberater" },
  hoffmann: { name: "Dr. Miriam Hoffmann", address: "m.hoffmann@hoffmann-logistik.example", role: "Kundin" },
  nordlicht: { name: "Jan-Hendrik Voss", address: "voss@nordlicht-it.example", role: "IT-Dienstleister" },
  kuehnemann: { name: "Jens Kühnemann", address: "info@kuehnemann-haustechnik.example", role: "Handwerker" },
  bruecker: { name: "Lena Brückner", address: "l.brueckner@nordwind-energie.example", role: "Projektleitung" },
  telegramLena: { name: "Lena Brückner", address: "@lena_brueckner", role: "Projektleitung" },
  familie: { name: "Familie Brandt", address: "+49 511 0000000", role: "Familie" },
  newsletter: { name: "Energiewende aktuell", address: "redaktion@energiewende-aktuell.example", role: "Newsletter" },
  bank: { name: "Hannoversche Volksbank Service", address: "service@hannoversche-bank-sicherheit.example", role: "Absender unbekannt" },
} as const;

interface MessageSpec {
  from: keyof typeof PEOPLE | "me";
  agoMs: number;
  body: string;
  summary?: string;
  files?: FileKey[];
}

interface ThreadSpec {
  key: ThreadKey;
  channel: ChannelKey;
  subject: string;
  person: keyof typeof PEOPLE;
  priority: Priority;
  needsReply: boolean;
  status: Thread["status"];
  summary: string | null;
  deadlineInMs: number | null;
  task?: TaskKey;
  draft?: keyof Story["drafts"];
  unread: number;
  messages: MessageSpec[];
  extractedEvents?: Thread["extractedEvents"];
  extractedTasks?: Thread["extractedTasks"];
  suggestedReply?: string | null;
}

const THREADS: ThreadSpec[] = [
  {
    key: "becker",
    channel: "email",
    subject: "Terminbestätigung 21.10. – Besprechung Anlagenwartung",
    person: "becker",
    priority: "P1",
    needsReply: true,
    status: "open",
    summary: "Frau Becker bittet um Bestätigung des Termins am 21.10. um 10:00 Uhr und fragt, ob das Wartungsprotokoll mitgebracht wird.",
    deadlineInMs: 90 * MIN,
    task: "becker",
    draft: "becker",
    unread: 1,
    messages: [
      {
        from: "me",
        agoMs: 2 * DAY,
        body: "Guten Tag Frau Becker,\n\nich schlage für die Besprechung zur Anlagenwartung den 21.10. vor. Passt Ihnen 10:00 Uhr?\n\nViele Grüße\nErik Brandt",
        summary: "Terminvorschlag 21.10. um 10:00 Uhr.",
      },
      {
        from: "becker",
        agoMs: 3 * HOUR,
        body: "Hallo Herr Brandt,\n\nder 21.10. um 10:00 Uhr passt gut. Bitte bestätigen Sie den Termin kurz schriftlich. Bringen Sie das Wartungsprotokoll der letzten Inspektion mit?\n\nFreundliche Grüße\nKatharina Becker",
        summary: "Zusage für den 21.10., bittet um schriftliche Bestätigung und fragt nach dem Wartungsprotokoll.",
      },
    ],
    extractedEvents: [{ title: "Besprechung Anlagenwartung", start: "2026-10-21T08:00:00.000Z", end: "2026-10-21T09:30:00.000Z" }],
    extractedTasks: [{ title: "Wartungsprotokoll der letzten Inspektion bereitlegen", dueAt: "2026-10-20T15:00:00.000Z" }],
    suggestedReply: "Sehr geehrte Frau Becker, gerne bestätige ich unseren Termin am 21.10.2026 um 10:00 Uhr. Das Wartungsprotokoll bringe ich mit.",
  },
  {
    key: "albrecht",
    channel: "email",
    subject: "Steuererklärung 2025 – drei Belege fehlen noch",
    person: "albrecht",
    priority: "P2",
    needsReply: true,
    status: "open",
    summary: "Steuerberater Albrecht benötigt bis Freitag drei fehlende Belege (Tankquittung, Fortbildung, Handwerkerrechnung).",
    deadlineInMs: 2 * DAY + 3 * HOUR,
    task: "steuer",
    draft: "albrecht",
    unread: 1,
    messages: [
      {
        from: "albrecht",
        agoMs: 3 * DAY,
        body: "Guten Tag Herr Brandt,\n\nfür die Erklärung 2025 liegen mir noch nicht alle Belege vor. Bitte senden Sie mir bis Freitag die Fortbildungsrechnung aus Hamburg, die Tankquittung vom Mai und die Handwerkerrechnung.\n\nBeste Grüße\nThomas Albrecht",
        summary: "Bitte um drei fehlende Belege bis Freitag.",
      },
      {
        from: "me",
        agoMs: 2 * DAY + 20 * HOUR,
        body: "Hallo Herr Albrecht, ich suche die Unterlagen zusammen und melde mich bis Donnerstag.",
        summary: "Zusage, Belege bis Donnerstag zu liefern.",
      },
      {
        from: "albrecht",
        agoMs: 5 * HOUR,
        body: "Vielen Dank. Die Handwerkerrechnung von Herrn Kühnemann reicht auch als Kopie.",
        summary: "Kopie der Handwerkerrechnung genügt.",
      },
    ],
    extractedTasks: [{ title: "Fehlende Belege an Steuerberater senden", dueAt: "2026-10-16T15:00:00.000Z" }],
    suggestedReply: "Sehr geehrter Herr Albrecht, anbei erhalten Sie die Fortbildungsrechnung und die Tankquittung. Die Handwerkerrechnung folgt als Kopie bis Donnerstag.",
  },
  {
    key: "hoffmann",
    channel: "email",
    subject: "Rechnung 2026-0917 – Zahlungseingang prüfen",
    person: "hoffmann",
    priority: "P2",
    needsReply: false,
    status: "waiting",
    summary: "Rechnung 2026-0917 ist seit 14 Tagen überfällig; Zahlungserinnerung wurde nicht freigegeben und ist abgelaufen.",
    deadlineInMs: null,
    draft: "hoffmann",
    unread: 0,
    messages: [
      {
        from: "me",
        agoMs: 21 * DAY,
        body: "Sehr geehrte Frau Dr. Hoffmann, anbei die Rechnung 2026-0917 über 6.180,00 EUR. Zahlungsziel 14 Tage.",
        summary: "Rechnung über 6.180,00 EUR versendet.",
      },
      {
        from: "hoffmann",
        agoMs: 19 * DAY,
        body: "Vielen Dank, die Rechnung ist eingegangen und wird zur Zahlung vorgemerkt.",
        summary: "Eingang bestätigt, Zahlung vorgemerkt.",
      },
    ],
    suggestedReply: "Sehr geehrte Frau Dr. Hoffmann, wir konnten den Zahlungseingang zur Rechnung 2026-0917 noch nicht feststellen. Bitte prüfen Sie dies kurz.",
  },
  {
    key: "nordlicht",
    channel: "email",
    subject: "Rechnung 2026-1142 und Wartungsvertrag Serverraum",
    person: "nordlicht",
    priority: "P2",
    needsReply: false,
    status: "waiting",
    summary: "Nordlicht IT-Systeme sendet die Q3-Rechnung (4.287,60 EUR) und den Verlängerungsvertrag zur Unterschrift.",
    deadlineInMs: 5 * DAY,
    task: "rechnung",
    unread: 0,
    messages: [
      {
        from: "nordlicht",
        agoMs: 3 * HOUR + 10 * MIN,
        body: "Sehr geehrter Herr Brandt,\n\nanbei die Rechnung 2026-1142 sowie der Wartungsvertrag zur Verlängerung. Bitte unterschrieben zurücksenden.\n\nMit freundlichen Grüßen\nJan-Hendrik Voss",
        summary: "Rechnung über 4.287,60 EUR und Verlängerungsvertrag zur Unterschrift.",
        files: ["rechnungNordlicht"],
      },
    ],
    extractedTasks: [{ title: "Wartungsvertrag prüfen und unterschreiben", dueAt: "2026-10-19T12:00:00.000Z" }],
  },
  {
    key: "kuehnemann",
    channel: "email",
    subject: "Handwerkerrechnung Gartenstraße – Beleg als Kopie",
    person: "kuehnemann",
    priority: "P3",
    needsReply: true,
    status: "open",
    summary: "Herr Kühnemann schickt die gewünschte Kopie der Rechnung zur Photovoltaik-Vorbereitung.",
    deadlineInMs: null,
    unread: 1,
    messages: [
      {
        from: "kuehnemann",
        agoMs: 6 * HOUR,
        body: "Hallo Herr Brandt, hier die Kopie der Rechnung für die Elektroarbeiten. Gruß J. Kühnemann",
        summary: "Kopie der Rechnung für Elektroarbeiten.",
      },
    ],
  },
  {
    key: "bruecker",
    channel: "email",
    subject: "Windpark Nordwind – Unterlagen vollständig?",
    person: "bruecker",
    priority: "P2",
    needsReply: true,
    status: "open",
    summary: "Frau Brückner fragt, ob die Genehmigungsunterlagen vollständig sind, und schlägt einen Telefontermin vor.",
    deadlineInMs: 1 * DAY,
    unread: 2,
    messages: [
      {
        from: "bruecker",
        agoMs: 8 * HOUR,
        body: "Guten Morgen Herr Brandt,\n\nsind die Unterlagen für das Projekt Nordwind aus Ihrer Sicht vollständig? Gern besprechen wir offene Punkte telefonisch.\n\nGrüße\nLena Brückner",
        summary: "Fragt nach Vollständigkeit der Unterlagen, schlägt Telefonat vor.",
      },
      {
        from: "bruecker",
        agoMs: 2 * HOUR,
        body: "Ich habe heute ab 14 Uhr Zeit für ein kurzes Telefonat.",
        summary: "Schlägt Telefonat heute ab 14 Uhr vor.",
      },
    ],
    extractedEvents: [{ title: "Telefonat Projekt Nordwind", start: "2026-10-14T12:00:00.000Z", end: "2026-10-14T12:30:00.000Z" }],
  },
  {
    key: "telegramLena",
    channel: "telegram",
    subject: "Lena Brückner",
    person: "telegramLena",
    priority: "P3",
    needsReply: false,
    status: "replied",
    summary: "Kurze Abstimmung zum Telefontermin.",
    deadlineInMs: null,
    unread: 0,
    messages: [
      { from: "telegramLena", agoMs: 2 * HOUR, body: "Passt 14 Uhr?", summary: "Fragt nach 14 Uhr." },
      { from: "me", agoMs: 100 * MIN, body: "Ja, 14 Uhr ist gut.", summary: "Bestätigt 14 Uhr." },
    ],
  },
  {
    key: "whatsappFamilie",
    channel: "whatsapp",
    subject: "Familie Brandt",
    person: "familie",
    priority: "P4",
    needsReply: false,
    status: "open",
    summary: "Familiengruppe: Planung für das Wochenende.",
    deadlineInMs: null,
    unread: 3,
    messages: [
      { from: "familie", agoMs: 5 * HOUR, body: "Wer bringt am Samstag den Kuchen mit?", summary: "Frage nach Kuchen für Samstag." },
      { from: "familie", agoMs: 4 * HOUR, body: "Ich backe den Apfelkuchen.", summary: "Jemand backt Apfelkuchen." },
    ],
  },
  {
    key: "newsletter",
    channel: "email",
    subject: "Energiewende aktuell – Ausgabe 41/2026",
    person: "newsletter",
    priority: "P4",
    needsReply: false,
    status: "archived",
    summary: "Newsletter: Neue Regeln zur Einspeisevergütung und Speicherförderung.",
    deadlineInMs: null,
    unread: 0,
    messages: [
      {
        from: "newsletter",
        agoMs: 3 * DAY,
        body: "In dieser Ausgabe: Neue Regeln zur Einspeisevergütung, Förderung für Batteriespeicher, Interview mit der Bundesnetzagentur.",
        summary: "Wochenüberblick Energiewende.",
      },
    ],
  },
  {
    key: "bank",
    channel: "email",
    subject: "Wichtiger Sicherheitshinweis zu Ihrem Konto – sofort handeln",
    person: "bank",
    priority: "P1",
    needsReply: false,
    status: "open",
    summary: "Mögliche Phishing-Nachricht: Absenderdomain passt nicht zur Bank, fordert zur Eingabe von Zugangsdaten über einen Link auf.",
    deadlineInMs: null,
    unread: 1,
    messages: [
      {
        from: "bank",
        agoMs: 50 * MIN,
        body: "Sehr geehrter Kunde, Ihr Konto wurde vorübergehend eingeschränkt. Bitte bestätigen Sie Ihre Daten unter dem folgenden Link innerhalb von 24 Stunden.",
        summary: "Warnung: verdächtige Aufforderung zur Dateneingabe, nicht antworten und Link nicht öffnen.",
      },
    ],
    suggestedReply: null,
  },
];

const CHANNEL_SPECS: {
  key: ChannelKey;
  kind: ChannelKind;
  name: string;
  status: Channel["status"];
  address?: string;
  caps: Channel["capabilities"];
  unread: number;
  syncedAgoMs: number | null;
}[] = [
  { key: "email", kind: "email", name: "GMX Postfach", status: "online", address: "erik.brandt@gmx.example", caps: { read: true, draft: true, send: true }, unread: 5, syncedAgoMs: 45_000 },
  { key: "telegram", kind: "telegram", name: "Telegram", status: "online", address: "@friday_erik_bot", caps: { read: true, draft: true, send: true }, unread: 0, syncedAgoMs: 20_000 },
  { key: "whatsapp", kind: "whatsapp", name: "WhatsApp", status: "read_only", caps: { read: true, draft: false, send: false }, unread: 3, syncedAgoMs: 2 * MIN },
  { key: "sms", kind: "sms", name: "SMS", status: "not_configured", caps: { read: false, draft: false, send: false }, unread: 0, syncedAgoMs: null },
  { key: "phone", kind: "phone", name: "Telefon", status: "degraded", caps: { read: true, draft: false, send: false }, unread: 1, syncedAgoMs: 15 * MIN },
];

export function buildChannels(ctx: SeedContext, story: Story): Channel[] {
  return CHANNEL_SPECS.map((spec) => ({
    id: story.channels[spec.key],
    version: ctx.rng.int(1, 6),
    createdAt: ctx.at(-60 * DAY),
    updatedAt: ctx.at(-(spec.syncedAgoMs ?? 5 * DAY)),
    source: ctx.src("communication"),
    kind: spec.kind,
    name: spec.name,
    status: spec.status,
    ...(spec.address ? { address: spec.address } : {}),
    capabilities: spec.caps,
    unreadCount: spec.unread,
    lastSyncAt: spec.syncedAgoMs === null ? null : ctx.at(-spec.syncedAgoMs),
  }));
}

export interface CommunicationSeed {
  threads: Thread[];
  messages: Message[];
  drafts: Draft[];
}

function participantFor(person: keyof typeof PEOPLE): Participant {
  const entry = PEOPLE[person];
  return { name: entry.name, address: entry.address, role: entry.role };
}

export function buildCuratedCommunication(ctx: SeedContext, story: Story): CommunicationSeed {
  const threads: Thread[] = [];
  const messages: Message[] = [];
  const messageIdsByThread: Record<string, string[]> = {};

  for (const spec of THREADS) {
    const threadId = story.threads[spec.key];
    const person = participantFor(spec.person);
    const sorted = [...spec.messages].sort((a, b) => b.agoMs - a.agoMs);
    const threadMessages: Message[] = sorted.map((entry) => {
      const sender = entry.from === "me" ? ME : participantFor(entry.from);
      const recipient = entry.from === "me" ? person : ME;
      const attachments: Attachment[] = (entry.files ?? []).map((key) => {
        const file = fileSpec(key);
        return { id: ctx.id("att"), name: file.name, mimeType: file.mimeType, sizeBytes: file.sizeBytes, fileId: story.files[key] };
      });
      return {
        id: ctx.id("msg"),
        version: 1,
        createdAt: ctx.at(-entry.agoMs),
        updatedAt: ctx.at(-entry.agoMs),
        source: ctx.src("communication"),
        threadId,
        direction: entry.from === "me" ? "outbound" : "inbound",
        from: sender,
        to: [recipient],
        sentAt: ctx.at(-entry.agoMs),
        bodyText: entry.body,
        aiSummary: entry.summary ?? null,
        attachments,
        originalRef: `gmx://INBOX/${ctx.rng.int(10000, 99999)}`,
      };
    });
    messages.push(...threadMessages);
    messageIdsByThread[threadId] = threadMessages.map((message) => message.id);
    const last = threadMessages[threadMessages.length - 1];
    const draftId = spec.draft ? story.drafts[spec.draft] : undefined;
    threads.push({
      id: threadId,
      version: ctx.rng.int(1, 7),
      createdAt: ctx.at(-(sorted[0]?.agoMs ?? HOUR)),
      updatedAt: last ? last.sentAt : ctx.at(-HOUR),
      source: ctx.src("communication"),
      channelId: story.channels[spec.channel],
      channelKind: spec.channel,
      subject: spec.subject,
      participants: [ME, person],
      priority: spec.priority,
      summary: spec.summary,
      needsReply: spec.needsReply,
      deadline: spec.deadlineInMs === null ? null : ctx.at(spec.deadlineInMs),
      status: spec.status,
      linkedTaskId: spec.task ? story.tasks[spec.task] : null,
      lastMessageAt: last ? last.sentAt : ctx.at(-HOUR),
      messageCount: threadMessages.length,
      unreadCount: spec.unread,
      hasDraft: Boolean(draftId),
      draftIds: draftId ? [draftId] : [],
      extractedEvents: spec.extractedEvents ?? [],
      extractedTasks: spec.extractedTasks ?? [],
      suggestedReply: spec.suggestedReply ?? null,
    });
  }

  const beckerMessageIds = messageIdsByThread[story.threads.becker] ?? [];
  const drafts: Draft[] = [
    {
      id: story.drafts.becker,
      version: 2,
      createdAt: ctx.at(-35 * MIN),
      updatedAt: ctx.at(-15 * MIN),
      source: ctx.src("communication"),
      channelId: story.channels.email,
      threadId: story.threads.becker,
      to: [participantFor("becker")],
      subject: "Terminbestätigung 21.10.",
      body: "Sehr geehrte Frau Becker,\n\ngerne bestätige ich unseren Termin am 21.10.2026 um 10:00 Uhr in Hannover. Das Wartungsprotokoll bringe ich mit.\n\nMit freundlichen Grüßen\nErik Brandt",
      status: "pending_approval",
      approvalId: story.approvals.beckerMail,
      generatedByAgentId: story.agents.kommunikation,
      replyToMessageId: beckerMessageIds[beckerMessageIds.length - 1] ?? null,
    },
    {
      id: story.drafts.albrecht,
      version: 1,
      createdAt: ctx.at(-20 * MIN),
      updatedAt: ctx.at(-20 * MIN),
      source: ctx.src("communication"),
      channelId: story.channels.email,
      threadId: story.threads.albrecht,
      to: [participantFor("albrecht")],
      subject: "Re: Steuererklärung 2025 – drei Belege fehlen noch",
      body: "Sehr geehrter Herr Albrecht,\n\nanbei erhalten Sie die Fortbildungsrechnung und die Tankquittung. Die Handwerkerrechnung folgt als Kopie bis Donnerstag.\n\nBeste Grüße\nErik Brandt",
      status: "draft",
      approvalId: null,
      generatedByAgentId: story.agents.kommunikation,
    },
    {
      id: story.drafts.hoffmann,
      version: 3,
      createdAt: ctx.at(-2 * DAY),
      updatedAt: ctx.at(-2 * DAY),
      source: ctx.src("communication"),
      channelId: story.channels.email,
      threadId: story.threads.hoffmann,
      to: [participantFor("hoffmann")],
      subject: "Zahlungserinnerung Rechnung 2026-0917",
      body: "Sehr geehrte Frau Dr. Hoffmann,\n\nunsere Rechnung 2026-0917 ist noch offen. Bitte prüfen Sie den Zahlungseingang.\n\nMit freundlichen Grüßen\nErik Brandt",
      status: "draft",
      approvalId: null,
      generatedByAgentId: story.agents.kommunikation,
    },
  ];
  return { threads, messages, drafts };
}

const BULK_SUBJECTS = [
  "Angebot Wartung Heizungsanlage",
  "Rückfrage zur Lieferung Bürostühle",
  "Terminverschiebung Besprechung Projekt Leuchtturm",
  "Protokoll der Projektsitzung vom Montag",
  "Rechnung Oktober – Bitte um Prüfung",
  "Einladung zum Fachvortrag Energiespeicher",
  "Neue Preisliste ab November",
  "Bestätigung Ihrer Bestellung",
  "Unterlagen für das Finanzamt Hannover-Nord",
  "Feedback zum Konzept Büroumzug",
];

const BULK_PEOPLE = [
  ["Sabine Wegener", "s.wegener@wegener-bau.example"],
  ["Matthias Ostermann", "ostermann@ostermann-elektro.example"],
  ["Ingrid Lührs", "i.luehrs@luehrs-beratung.example"],
  ["Björn Zander", "b.zander@zander-logistik.example"],
  ["Claudia Räuber", "claudia.raeuber@stadtwerke-hannover.example"],
  ["Hans-Peter Möller", "hp.moeller@moeller-metallbau.example"],
];

export function buildBulkThreads(ctx: SeedContext, story: Story, count: number, startIndex: number): CommunicationSeed {
  const threads: Thread[] = [];
  const messages: Message[] = [];
  const channelKeys: ChannelKey[] = ["email", "email", "email", "telegram", "whatsapp"];
  for (let i = 0; i < count; i++) {
    const channelKey = channelKeys[i % channelKeys.length] as ChannelKey;
    const [name, address] = ctx.rng.pick(BULK_PEOPLE) as [string, string];
    const subject = `${ctx.rng.pick(BULK_SUBJECTS)} (${startIndex + i + 1})`;
    const person: Participant = { name, address, role: "Kontakt" };
    const messageCount = ctx.rng.int(1, 4);
    const threadId = ctx.id("thr");
    const baseAgo = ctx.rng.int(1, 14 * 24) * HOUR;
    const threadMessages: Message[] = Array.from({ length: messageCount }, (_, index) => {
      const inbound = index % 2 === 0;
      const sentAgo = Math.max(MIN, baseAgo - index * ctx.rng.int(1, 6) * HOUR);
      return {
        id: ctx.id("msg"),
        version: 1,
        createdAt: ctx.at(-sentAgo),
        updatedAt: ctx.at(-sentAgo),
        source: ctx.src("communication"),
        threadId,
        direction: inbound ? "inbound" : "outbound",
        from: inbound ? person : ME,
        to: [inbound ? ME : person],
        sentAt: ctx.at(-sentAgo),
        bodyText: `${subject}\n\nGuten Tag, bitte um kurze Rückmeldung. (Mock-Nachricht ${index + 1})`,
        aiSummary: "Kurze Rückfrage mit Bitte um Rückmeldung.",
        attachments: [],
      };
    });
    messages.push(...threadMessages);
    const last = threadMessages[threadMessages.length - 1] as Message;
    const needsReply = last.direction === "inbound" && ctx.rng.chance(0.7);
    threads.push({
      id: threadId,
      version: 1,
      createdAt: threadMessages[0]?.sentAt ?? last.sentAt,
      updatedAt: last.sentAt,
      source: ctx.src("communication"),
      channelId: story.channels[channelKey],
      channelKind: channelKey,
      subject,
      participants: [ME, person],
      priority: ctx.rng.weighted<Priority>([["P1", 5], ["P2", 25], ["P3", 45], ["P4", 25]]),
      summary: "Zusammenfassung: Rückfrage zu einem laufenden Vorgang, Antwort erwünscht.",
      needsReply,
      deadline: needsReply && ctx.rng.chance(0.4) ? ctx.at(ctx.rng.int(2, 72) * HOUR) : null,
      status: needsReply ? "open" : ctx.rng.pick<Thread["status"]>(["waiting", "replied", "archived"]),
      linkedTaskId: null,
      lastMessageAt: last.sentAt,
      messageCount,
      unreadCount: needsReply ? 1 : 0,
      hasDraft: false,
      draftIds: [],
      extractedEvents: [],
      extractedTasks: [],
      suggestedReply: needsReply ? "Vielen Dank für Ihre Nachricht, ich melde mich bis morgen." : null,
    });
  }
  return { threads, messages, drafts: [] };
}
