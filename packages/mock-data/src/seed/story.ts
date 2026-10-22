import type { SeedContext } from "./context";

export const AGENT_KEYS = [
  "coding",
  "recherche",
  "memory",
  "browser",
  "task",
  "system",
  "kommunikation",
  "kalender",
] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const TASK_KEYS = [
  "bueromoebel",
  "postfach",
  "becker",
  "apiClient",
  "quartalsbericht",
  "memoryKonsolidierung",
  "steuer",
  "backup",
  "kalenderKw43",
  "rechnung",
  "windowsUpdates",
  "newsletter",
  "foerderung",
  "lieferantenportal",
] as const;
export type TaskKey = (typeof TASK_KEYS)[number];

export const APPROVAL_KEYS = [
  "beckerMail",
  "terminVerschieben",
  "backupLoeschen",
  "bestellung",
  "zahlung",
  "vertrag",
  "systemUpdate",
  "telegramNachricht",
  "abgelaufen",
  "fehlgeschlagen",
] as const;
export type ApprovalKey = (typeof APPROVAL_KEYS)[number];

export const THREAD_KEYS = [
  "becker",
  "albrecht",
  "hoffmann",
  "nordlicht",
  "kuehnemann",
  "bruecker",
  "telegramLena",
  "whatsappFamilie",
  "newsletter",
  "bank",
] as const;
export type ThreadKey = (typeof THREAD_KEYS)[number];

export const EVENT_KEYS = [
  "daily",
  "becker",
  "lieferanten",
  "steuer",
  "zahnarzt",
  "workshop",
  "umzug",
  "hoffmann",
  "review",
  "fokus",
] as const;
export type EventKey = (typeof EVENT_KEYS)[number];

export const FILE_KEYS = [
  "angebotsvergleich",
  "quartalsbericht",
  "backupLog",
  "altesBackup",
  "steuerListe",
  "rechnungNordlicht",
  "foerderRecherche",
  "agentProtokoll",
  "praesentationQ3",
  "exportMemory",
  "upload",
  "temp",
  "newsletter",
] as const;
export type FileKey = (typeof FILE_KEYS)[number];

export const CHANNEL_KEYS = ["email", "telegram", "whatsapp", "discord", "sms", "phone"] as const;
export type ChannelKey = (typeof CHANNEL_KEYS)[number];

export const AUTOMATION_KEYS = ["wichtigeMail", "morgenBriefing", "backupCheck", "terminKonflikt", "rechnungen", "nachtruhe"] as const;
export type AutomationKey = (typeof AUTOMATION_KEYS)[number];

export const RESEARCH_KEYS = ["foerderung", "lieferanten", "ki"] as const;
export type ResearchKey = (typeof RESEARCH_KEYS)[number];

type Keyed<K extends string> = Record<K, string>;

/** Pre-allocated ids for the curated cast so independent seed modules can cross-reference each other. */
export interface Story {
  agents: Keyed<AgentKey>;
  tasks: Keyed<TaskKey>;
  approvals: Keyed<ApprovalKey>;
  threads: Keyed<ThreadKey>;
  events: Keyed<EventKey>;
  files: Keyed<FileKey>;
  channels: Keyed<ChannelKey>;
  automations: Keyed<AutomationKey>;
  research: Keyed<ResearchKey>;
  drafts: { becker: string; albrecht: string; hoffmann: string };
}

function allocate<K extends string>(ctx: SeedContext, prefix: string, keys: readonly K[]): Keyed<K> {
  const out = {} as Keyed<K>;
  for (const key of keys) out[key] = ctx.id(prefix);
  return out;
}

export function createStory(ctx: SeedContext): Story {
  return {
    agents: allocate(ctx, "agent", AGENT_KEYS),
    tasks: allocate(ctx, "task", TASK_KEYS),
    approvals: allocate(ctx, "appr", APPROVAL_KEYS),
    threads: allocate(ctx, "thr", THREAD_KEYS),
    events: allocate(ctx, "cal", EVENT_KEYS),
    files: allocate(ctx, "file", FILE_KEYS),
    channels: allocate(ctx, "chan", CHANNEL_KEYS),
    automations: allocate(ctx, "auto", AUTOMATION_KEYS),
    research: allocate(ctx, "rsp", RESEARCH_KEYS),
    drafts: { becker: ctx.id("draft"), albrecht: ctx.id("draft"), hoffmann: ctx.id("draft") },
  };
}
