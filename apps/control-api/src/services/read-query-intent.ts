import { authorize, type Role } from "@friday/auth";
import { isAdapterError } from "@friday/adapter-core";
import { CONTRACT_VERSION, type ActivityEvent, type Agent, type AgentStatus, type Automation, type Approval, type AuditEvent, type CalendarEvent, type CommandResponse, type ContentPlanState, type Freshness, type FileCategory, type FileItem, type Memory, type MemoryType, type ResearchProject, type Notification, type Settings, type Task, type TaskStatus, type Thread, type VoiceStatusResponse } from "@friday/sdk";
import { createId } from "@friday/observability";
import type { HandlerResult, RequestContext } from "../http/context";
import { ApiError, forbidden, validationFailed } from "../util/errors";
import { auditTrailEvent, auditTrailPage } from "./audit-trail";
import { localDayRange } from "./calendar-day-range";

const MAX_RESULTS = 5;
const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, owner: 2 };

export type ReadQueryIntent =
  | { kind: "settings.get"; area?: SettingsReadArea }
  | { kind: "contentStudio.plan" }
  | { kind: "tasks.list"; status?: TaskStatus[] }
  | { kind: "tasks.get"; id: string }
  | { kind: "calendar.list"; dayOffset: 0 | 1 }
  | { kind: "communication.list"; status?: Array<"open" | "waiting" | "replied" | "archived">; needsReply?: boolean }
  | { kind: "agents.list"; status?: AgentStatus[] }
  | { kind: "agents.get"; id: string }
  | { kind: "automations.list"; enabled?: boolean }
  | { kind: "automations.get"; id: string }
  | { kind: "memory.list"; pinned?: boolean; type?: MemoryType[] }
  | { kind: "memory.get"; id: string }
  | { kind: "research.list" }
  | { kind: "research.get"; id: string }
  | { kind: "files.list"; category?: FileCategory[] }
  | { kind: "files.get"; id: string }
  | { kind: "activity.list"; status?: string; lookbackHours?: number }
  | { kind: "activity.get"; id: string }
  | { kind: "notifications.list"; status?: Array<"open" | "acknowledged" | "snoozed" | "resolved"> }
  | { kind: "notifications.unsupportedDetail"; id: string }
  | { kind: "approvals.list"; status?: Array<"pending" | "approved" | "rejected" | "expired" | "cancelled" | "executed" | "failed"> }
  | { kind: "approvals.get"; id: string }
  | { kind: "audit.list"; result?: Array<"success" | "failure" | "denied" | "pending">; securityOnly?: boolean; lookbackHours?: number }
  | { kind: "audit.get"; id: string }
  | { kind: "audit.exportUnsupported" }
  | { kind: "clarify"; message: string };

export type SettingsReadArea = "profile" | "dashboard" | "theme" | "orb" | "navigation" | "modelsRouting" | "voice" | "notifications" | "approvals" | "dataRetention" | "backups" | "developer" | "security";

const READ_CUE = /\b(zeige|zeig|liste|list|show|search|suche|such|find|finde|get|open|abruf|abrufe|hole|detail|details|was|wie|welche|welcher|welches|what|which|recent|latest|aktuell|aktuelle|letzte|letzten|recenten|export|exportieren|exportiere|download)\b/;
const SETTINGS_AREA_PATTERNS: Array<{ area: SettingsReadArea; pattern: RegExp }> = [
  { area: "profile", pattern: /\b(profile|profil|konto|account)\b/ },
  { area: "dashboard", pattern: /\b(dashboard|dashboards|uebersicht|oberflaeche)\b/ },
  { area: "theme", pattern: /\b(theme|design|erscheinungsbild)\b/ },
  { area: "orb", pattern: /\b(orb|kugel)\b/ },
  { area: "navigation", pattern: /\b(navigation|seitenleiste|menue)\b/ },
  { area: "modelsRouting", pattern: /\b(model|models|modell|modelle|routing|modellrouting)\b/ },
  { area: "voice", pattern: /\b(voice|stimme|audio|mikrofon|sprache)\b/ },
  { area: "notifications", pattern: /\b(notification(?:s)?(?:einstellungen|settings)?|benachrichtigung(?:en)?(?:seinstellungen|skanaele|skanale)?|meldungen|alerts|ruhezeiten)\b/ },
  { area: "approvals", pattern: /\b(approval(?:s)?(?:einstellungen|settings)?|freigabe(?:n)?(?:einstellungen|regeln)?|freigaben)\b/ },
  { area: "dataRetention", pattern: /\b(retention|aufbewahrung|datenaufbewahrung|loeschfristen)\b/ },
  { area: "backups", pattern: /\b(backup|backups|sicherung|sicherungen)\b/ },
  { area: "developer", pattern: /\b(developer|entwickler|debug|protokollierung)\b/ },
  { area: "security", pattern: /\b(security|sicherheit|zugriffsschutz)\b/ },
];
const FAMILY_PATTERNS = [
  { family: "tasks", pattern: /\b(aufgabe|aufgaben|task|tasks|todo|todos)\b/ },
  { family: "activity", pattern: /\b(activity|activities|aktivitaet|aktivitaeten|aktivitaetsverlauf)\b/ },
  { family: "notifications", pattern: /\b(alert|alerts|notification|notifications|benachrichtigung|benachrichtigungen|meldung|meldungen)\b/ },
  { family: "approvals", pattern: /\b(approval|approvals|freigabe|freigaben)\b/ },
  { family: "audit", pattern: /\b(audit|auditprotokoll|pruefprotokoll|auditlog)\b/ },
] as const;
export const READ_STATUS_ALIASES: Array<{ terms: string[]; mapsTo: Partial<Record<"tasks" | "activity" | "notifications" | "approvals" | "audit", string>> }> = [
  { terms: ["failed", "failure", "fehlgeschlagen", "fehlgeschlagene", "fehlgeschlagenen", "fehler", "fehlerhaft"], mapsTo: { tasks: "failed", activity: "failed", approvals: "failed", audit: "failure" } },
  { terms: ["running", "laeuft", "laufend", "laufende", "laufenden", "in arbeit"], mapsTo: { tasks: "running", activity: "running" } },
  { terms: ["waiting", "wartend", "wartende", "wartenden", "wartet"], mapsTo: { tasks: "waiting" } },
  { terms: ["review", "pruefung"], mapsTo: { tasks: "review" } },
  { terms: ["ready", "bereit"], mapsTo: { tasks: "ready" } },
  { terms: ["triage", "eingang"], mapsTo: { tasks: "triage" } },
  { terms: ["started", "gestartet"], mapsTo: { activity: "started" } },
  { terms: ["succeeded", "successful", "erfolgreich", "abgeschlossen", "abgeschlossene", "abgeschlossenen"], mapsTo: { tasks: "done", activity: "succeeded", audit: "success" } },
  { terms: ["cancelled", "canceled", "abgebrochen", "abgebrochene", "abgebrochenen"], mapsTo: { tasks: "cancelled", activity: "cancelled", approvals: "cancelled" } },
  { terms: ["info", "informational", "information", "informativ"], mapsTo: { activity: "info" } },
  { terms: ["open", "offen", "offene", "offenen", "aktiv"], mapsTo: { tasks: "open", notifications: "open", approvals: "pending" } },
  { terms: ["acknowledged", "acknowledge", "bestaetigt", "quittiert"], mapsTo: { notifications: "acknowledged" } },
  { terms: ["snoozed", "zurueckgestellt", "pausiert"], mapsTo: { notifications: "snoozed" } },
  { terms: ["resolved", "geloest", "erledigt", "erledigte", "erledigten"], mapsTo: { tasks: "done", notifications: "resolved" } },
  { terms: ["pending", "ausstehend", "ausstehende"], mapsTo: { approvals: "pending", audit: "pending" } },
  { terms: ["approved", "genehmigt", "freigegeben"], mapsTo: { approvals: "approved" } },
  { terms: ["rejected", "abgelehnt"], mapsTo: { approvals: "rejected" } },
  { terms: ["expired", "abgelaufen"], mapsTo: { approvals: "expired" } },
  { terms: ["executed", "ausgefuehrt"], mapsTo: { approvals: "executed" } },
  { terms: ["denied", "verweigert", "abgewiesen"], mapsTo: { audit: "denied" } },
  { terms: ["success", "erfolgreich"], mapsTo: { audit: "success" } },
];
const STATUS_WORDS = new Set(READ_STATUS_ALIASES.flatMap(({ terms }) => terms.filter((term) => !term.includes(" "))));
const ID_PATTERN = /\b(act|ntf|appr|aud|task)_[0-9A-Za-z]{26}\b/g;

function normalize(text: string): string {
  return text.toLowerCase().replace(/[äæ]/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}_]+/gu, " ").trim();
}

function readStatus(text: string, family: string): string[] {
  const result = READ_STATUS_ALIASES.flatMap(({ terms, mapsTo }) => {
    const matched = terms.filter((term) => statusTermPattern(term).test(text));
    return matched.length > 0 && mapsTo[family as keyof typeof mapsTo] ? [mapsTo[family as keyof typeof mapsTo]!] : [];
  });
  return [...new Set(result)];
}

function escapeRegex(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function statusTermPattern(term: string): RegExp { return new RegExp(`\\b${term.split(" ").map(escapeRegex).join("\\s+")}\\b`); }

function hasForeignStatus(text: string, family: string): boolean {
  const matchedTerms = new Set(READ_STATUS_ALIASES.flatMap(({ terms }) => terms.filter((term) => statusTermPattern(term).test(text))));
  return [...matchedTerms].some((term) => !READ_STATUS_ALIASES.some(({ terms, mapsTo }) =>
    terms.includes(term) && Boolean(mapsTo[family as keyof typeof mapsTo])));
}

const LOOKBACK_PATTERN = /\b(?:last|letzte|letzten)\s+(\d{1,3})\s+(hour|hours|stunde|stunden|day|days|tag|tage|week|weeks|woche|wochen)\b/g;

function lookbackHours(text: string): number | undefined {
  // Civil-day boundaries require an explicit timezone. Do not approximate them as rolling hours.
  if (/\b(today|heute|yesterday|gestern)\b/.test(text)) return -2;
  const matches = [...text.matchAll(LOOKBACK_PATTERN)];
  if (matches.length > 1) return -3;
  const match = matches[0];
  if (!match) return undefined;
  const count = Number(match[1]);
  const unit = match[2] ?? "";
  const hours = unit.startsWith("hour") || unit.startsWith("stunde") ? count
    : unit.startsWith("week") || unit.startsWith("woche") ? count * 168 : count * 24;
  return hours > 0 && hours <= 24 * 30 ? hours : -1;
}

/** Deliberately finite grammar: free text is never passed as an adapter filter or interpreted as SQL. */
export function parseReadQueryIntent(input: string): ReadQueryIntent | null {
  const text = normalize(input);
  if (!READ_CUE.test(text)) return null;
  const settingsRead = /\b(settings?|einstellungen?|konfiguration|configuration|configured|eingestellt)\b/.test(text);
  const planRead = /\b(content studio|contentstudio|content plan|redaktionsplan)\b/.test(text) && /\b(plan|planung|redaktionsplan|postings|content)\b/.test(text);
  const matchedSettingsAreas = SETTINGS_AREA_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ area }) => area);
  const legacyFamilies = FAMILY_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ family }) => family);
  if (settingsRead || planRead) {
    const unrelatedLegacyFamily = legacyFamilies.some((family) => family !== "notifications" && family !== "approvals");
    if (settingsRead && planRead || unrelatedLegacyFamily || matchedSettingsAreas.length > 1)
      return { kind: "clarify", message: "Bitte frage entweder eine einzelne Einstellung oder den Content-Studio-Plan ab." };
    if (planRead) {
      const planWords = new Set("show zeige zeig get was what wie the der die das im in my me meine mein mir den dem meinen current currenten aktuell aktuellen saved gespeichert content studio contentstudio plan planung redaktionsplan postings bitte".split(" "));
      const residual = text.split(/\s+/).find((word) => !planWords.has(word));
      return residual ? { kind: "clarify", message: `Der Content-Studio-Planfilter „${residual}“ wird nicht unterstützt. Bitte nur nach dem gespeicherten Plan fragen.` }
        : { kind: "contentStudio.plan" };
    }
    const controlWords = new Set("settings setting einstellung einstellungen konfiguration configuration configured eingestellt show zeige zeig what was wie ist sind my meine mein the der die das current aktuell aktuellen saved gespeichert applied angewendet effective wirksam fuer for von im in bitte".split(" "));
    const residual = text.split(/\s+/).filter((word) => !controlWords.has(word) && !matchedSettingsAreas.some((area) => word === area.toLowerCase())
      && !SETTINGS_AREA_PATTERNS.some(({ pattern }) => pattern.test(word)));
    if (residual.length > 0) return { kind: "clarify", message: `Die Einstellung „${residual[0]}“ wird in dieser Abfrage nicht unterstützt. Bitte einen benannten Einstellungsbereich angeben.` };
    return { kind: "settings.get", ...(matchedSettingsAreas[0] ? { area: matchedSettingsAreas[0] } : {}) };
  }
  const calendarArea = /\b(termine?|kalender|calendar)\b/.test(text);
  if (calendarArea) {
    if (/\b(erstelle|erstellen|anlegen|anlege|trage|eintragen|plane|planen|verschiebe|verschieben|aendere|aendern|loesche|loeschen|absagen|einladen)\b/.test(text))
      return { kind: "clarify", message: "Der Text enthält zugleich eine Leseabfrage und eine Änderungsaktion. Bitte nur die Terminabfrage formulieren." };
    if (/\b\d{1,2}(?::\d{2})?\s*uhr\b/.test(text) || /\b\d{1,2}:\d{2}\b/.test(text))
      return { kind: "clarify", message: "Eine Uhrzeit grenzt den Zeitraum ein. Bitte nur 'heute' oder 'morgen' fragen." };
    if (/\b(uebermorgen|woche|wochen|monat|monate|naechste|naechsten|naechster)\b/.test(text))
      return { kind: "clarify", message: "Diesen Zeitraum unterstützt die Terminabfrage noch nicht. Bitte 'heute' oder 'morgen' fragen." };
    const dayOffset = /\bheute\b/.test(text) ? 0 : /\bmorgen\b/.test(text) ? 1 : null;
    if (dayOffset === null) return { kind: "clarify", message: "Für welchen Tag? Bitte 'heute' oder 'morgen' nennen." };
    return { kind: "calendar.list", dayOffset };
  }
  // Eine zweite Lesefamilie im selben Satz wird nicht stillschweigend verworfen, sondern nachgefragt.
  const otherFamilies = FAMILY_PATTERNS.filter(({ pattern }) => pattern.test(text));
  const communicationArea = /\b(unterhaltungen?|threads?|kommunikation|conversations?|nachrichten|mails?|postfach|inbox)\b/.test(text);
  if (communicationArea) {
    if (otherFamilies.length > 0)
      return { kind: "clarify", message: "Der Text nennt zwei Bereiche zugleich. Bitte nur die Unterhaltungsabfrage formulieren." };
    if (/\b(erstelle|erstellen|schreibe|schreiben|sende|senden|antworte|antworten|entwerfe|entwerfen|loesche|loeschen|archiviere|archivieren|markiere|markieren)\b/.test(text))
      return { kind: "clarify", message: "Der Text enthält zugleich eine Leseabfrage und eine Änderungsaktion. Bitte nur die Unterhaltungsabfrage formulieren." };
    if (/\b(ungelesen|ungelesene|unread|neu|neue|neuen)\b/.test(text))
      return { kind: "clarify", message: "Ungelesene Unterhaltungen kann die Abfrage noch nicht filtern. Bitte nach Status fragen: offen, wartend, beantwortet oder archiviert." };
    if (/\b\d{1,2}(?::\d{2})?\s*uhr\b/.test(text) || /\b(letzte[rn]?\s+\d+|letzten?\s+tag|woche|monat)\b/.test(text))
      return { kind: "clarify", message: "Diesen Zeitraum unterstützt die Unterhaltungsabfrage noch nicht. Bitte nach Status oder 'braucht Antwort' fragen." };
    const needsReply = /\b(unbeantwortet\w*|ohne antwort|antwort (?:offen|ausstehend)|(?:eine )?antwort (?:brauchen|braucht)|auf (?:eine )?antwort warten|needs reply)\b/.test(text);
    const statuses = (["open", "waiting", "replied", "archived"] as const).filter((status) =>
      new RegExp(`\\b(?:${status}|${status === "open" ? "offen|offene" : status === "waiting" ? "wartend|wartende" : status === "replied" ? "beantwortet|beantwortete" : "archiviert|archivierte"})\\b`).test(text));
    if (statuses.length > 1) return { kind: "clarify", message: "Bitte genau einen Status nennen: offen, wartend, beantwortet oder archiviert." };
    if (needsReply && statuses.length > 0)
      return { kind: "clarify", message: "Bitte entweder einen Status oder 'braucht Antwort' nennen, nicht beides." };
    return {
      kind: "communication.list",
      ...(statuses[0] ? { status: [statuses[0]] } : {}),
      ...(needsReply ? { needsReply: true } : {}),
    };
  }
  const filesArea = /\b(datei|dateien|files?|dokument|dokumente|dokumenten)\b/.test(text);
  if (filesArea) {
    if (otherFamilies.length > 0 || /\b(automationen?|automations?|zeitplaene?|zeitplan|schedules?|memory|memories|gedaechtnis|gedaechtnisses|agenten?|agents?|assistenten?)\b/.test(text))
      return { kind: "clarify", message: "Der Text nennt zwei Bereiche zugleich. Bitte nur die Dateiabfrage formulieren." };
    if (/\b(loesche|loeschen|benenne|benennen|umbenennen|verschiebe|verschieben|hochladen|aendere|aendern|teile|teilen|erstelle|erstellen)\b/.test(text))
      return { kind: "clarify", message: "Der Text enthält zugleich eine Leseabfrage und eine Änderungsaktion. Bitte nur die Dateiabfrage formulieren." };
    if (/\b(suche|such|finde|find|search|namens|heisst|heissen|nach)\b/.test(text))
      return { kind: "clarify", message: "Die Dateiabfrage sucht nicht nach Namen. Bitte nach einer Kategorie fragen oder die Datei-Kennung nennen." };
    const fileIds = [...input.matchAll(/\bfile_[0-9A-Za-z]{26}\b/g)].map((match) => match[0]);
    if (fileIds.length > 1) return { kind: "clarify", message: "Bitte nenne nur eine Datei-Kennung." };
    const categories = FILE_CATEGORIES.filter((category) => new RegExp(`\\b(?:${FILE_CATEGORY_WORDS[category]})\\b`).test(text));
    if (fileIds[0]) {
      if (categories.length > 0) return { kind: "clarify", message: "Eine Kennung kann nicht mit einem Filter kombiniert werden." };
      return { kind: "files.get", id: fileIds[0] };
    }
    return { kind: "files.list", ...(categories.length > 0 ? { category: categories } : {}) };
  }
  const automationArea = /\b(automationen?|automations?|zeitplaene?|zeitplan|schedules?)\b/.test(text);
  if (automationArea) {
    if (otherFamilies.length > 0)
      return { kind: "clarify", message: "Der Text nennt zwei Bereiche zugleich. Bitte nur die Automationabfrage formulieren." };
    if (/\b(erstelle|erstellen|aktiviere|aktivieren|deaktiviere|deaktivieren|loesche|loeschen|pausiere|pausieren|starte|starten|aendere|aendern)\b/.test(text))
      return { kind: "clarify", message: "Der Text enthält zugleich eine Leseabfrage und eine Änderungsaktion. Bitte nur die Automationabfrage formulieren." };
    const automationIds = [...input.matchAll(/\bautomation_[0-9A-Za-z]{26}\b/g)].map((match) => match[0]);
    if (automationIds.length > 1) return { kind: "clarify", message: "Bitte nenne nur eine Automation-Kennung." };
    const wantsEnabled = /\b(aktiv|aktive|aktiven|aktiviert|aktivierte|aktivierten|eingeschaltet|eingeschaltete|eingeschalteten)\b/.test(text);
    const wantsDisabled = /\b(inaktiv|inaktive|inaktiven|deaktiviert|deaktivierte|deaktivierten|ausgeschaltet|ausgeschaltete|ausgeschalteten|pausiert|pausierte|pausierten)\b/.test(text);
    if (wantsEnabled && wantsDisabled) return { kind: "clarify", message: "Bitte entweder aktive oder deaktivierte Automationen abfragen." };
    const enabled = wantsEnabled ? true : wantsDisabled ? false : undefined;
    if (automationIds[0]) {
      if (enabled !== undefined) return { kind: "clarify", message: "Eine Kennung kann nicht mit einem Statusfilter kombiniert werden." };
      return { kind: "automations.get", id: automationIds[0] };
    }
    return { kind: "automations.list", ...(enabled !== undefined ? { enabled } : {}) };
  }
  const memoryArea = /\b(memory|memories|gedaechtnis|gedaechtnisses|gedaechtniseintrag|gedaechtniseintraege|wissenseintrag|wissenseintraege)\b/.test(text);
  const researchArea = /\b(recherche|recherchen|rechercheprojekt|rechercheprojekte|research|forschungsprojekt|forschungsprojekte)\b/.test(text);
  if (memoryArea) {
    // A content search ("suche im gedaechtnis nach lieferzeit") is the dedicated memory search with its own result
    // view; this parser only lists or reads entries.
    if (/\b(suche|such|finde|durchsuche|search|find)\b/.test(text)) return null;
    if (otherFamilies.length > 0 || researchArea)
      return { kind: "clarify", message: "Der Text nennt zwei Bereiche zugleich. Bitte nur die Gedächtnisabfrage formulieren." };
    if (/\b(merke|merken|speichere|speichern|vergiss|vergessen|loesche|loeschen|aendere|aendern|bestaetige|bestaetigen|anheften|anpinnen)\b/.test(text))
      return { kind: "clarify", message: "Der Text enthält zugleich eine Leseabfrage und eine Änderungsaktion. Bitte nur die Gedächtnisabfrage formulieren." };
    const memoryIds = [...input.matchAll(/\bmem_[0-9A-Za-z]{26}\b/g)].map((match) => match[0]);
    if (memoryIds.length > 1) return { kind: "clarify", message: "Bitte nenne nur eine Gedächtnis-Kennung." };
    const pinned = /\b(angeheftet|angeheftete|angehefteten|angepinnt|angepinnte|angepinnten|gepinnt|gepinnte|gepinnten|pinned)\b/.test(text);
    const memoryTypes = MEMORY_TYPES.filter((type) => new RegExp(`\\b(?:${MEMORY_TYPE_WORDS[type]})\\b`).test(text));
    if (memoryIds[0]) {
      if (pinned || memoryTypes.length > 0) return { kind: "clarify", message: "Eine Kennung kann nicht mit einem Filter kombiniert werden." };
      return { kind: "memory.get", id: memoryIds[0] };
    }
    return { kind: "memory.list", ...(pinned ? { pinned: true } : {}), ...(memoryTypes.length > 0 ? { type: memoryTypes } : {}) };
  }
  if (researchArea) {
    if (otherFamilies.length > 0)
      return { kind: "clarify", message: "Der Text nennt zwei Bereiche zugleich. Bitte nur die Rechercheabfrage formulieren." };
    if (/\b(starte|starten|erstelle|erstellen|recherchiere|recherchieren|breche|abbrechen|loesche|loeschen|wiederhole|wiederholen)\b/.test(text))
      return { kind: "clarify", message: "Der Text enthält zugleich eine Leseabfrage und eine Änderungsaktion. Bitte nur die Rechercheabfrage formulieren." };
    if (/\b(laufend|laufende|laufenden|fertig|fertige|abgeschlossen|abgeschlossene|fehlgeschlagen|fehlgeschlagene|abgebrochen|abgebrochene|geplant|geplante)\b/.test(text))
      return { kind: "clarify", message: "Die Rechercheabfrage kann noch nicht nach Status filtern. Bitte ohne Status fragen." };
    const researchIds = [...input.matchAll(/\brsp_[0-9A-Za-z]{26}\b/g)].map((match) => match[0]);
    if (researchIds.length > 1) return { kind: "clarify", message: "Bitte nenne nur eine Recherche-Kennung." };
    if (researchIds[0]) return { kind: "research.get", id: researchIds[0] };
    return { kind: "research.list" };
  }
  const agentArea = /\b(agenten?|agents?|assistenten?)\b/.test(text);
  if (agentArea) {
    if (otherFamilies.length > 0)
      return { kind: "clarify", message: "Der Text nennt zwei Bereiche zugleich. Bitte nur die Agentenabfrage formulieren." };
    if (/\b(starte|starten|stoppe|stoppen|pausiere|pausieren|fortsetzen|weise|zuweisen|beende|beenden|loesche|loeschen)\b/.test(text))
      return { kind: "clarify", message: "Der Text enthält zugleich eine Leseabfrage und eine Änderungsaktion. Bitte nur die Agentenabfrage formulieren." };
    const agentIds = [...input.matchAll(/\bagent_[0-9A-Za-z]{26}\b/g)].map((match) => match[0]);
    if (agentIds.length > 1) return { kind: "clarify", message: "Bitte nenne nur eine Agenten-Kennung." };
    const explicit = (["idle", "starting", "working", "waiting", "paused", "error", "offline"] as const).filter((status) =>
      new RegExp(`\\b(?:${AGENT_STATUS_WORDS[status]})\\b`).test(text));
    // "aktiv" heisst hier: nicht pausiert, nicht offline, nicht fehlerhaft - dieselbe Logik wie bei offenen Aufgaben.
    const activeOnly = /\b(aktiv|aktive|aktiven|aktivitaet|betrieb)\b/.test(text) && explicit.length === 0;
    if (agentIds[0]) {
      if (explicit.length > 0 || activeOnly) return { kind: "clarify", message: "Eine Kennung kann nicht mit einem Statusfilter kombiniert werden." };
      return { kind: "agents.get", id: agentIds[0] };
    }
    if (explicit.length > 1) return { kind: "clarify", message: "Bitte genau einen Agentenstatus nennen." };
    const status = activeOnly ? ACTIVE_AGENT_STATUSES : explicit.length === 1 ? [explicit[0]!] : [];
    return { kind: "agents.list", ...(status.length > 0 ? { status } : {}) };
  }
  const families = FAMILY_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ family }) => family);
  if (families.length === 0) return null;
  if (families.length > 1) return { kind: "clarify", message: "Meinst du Aufgaben, Activity, Benachrichtigungen, Freigaben oder Audit? Bitte nur einen Bereich nennen." };

  const family = families[0]!;
  if (/\b(create|add|update|change|delete|remove|approve|reject|start|stop|pause|resume|erstelle|erstellen|hinzufuegen|aendere|aendern|loesche|entferne|genehmige|genehmigen|lehne|ablehnen|starte|starten|stoppe|stoppen|pausiere|pausieren)\b/.test(text))
    return { kind: "clarify", message: "Der Text enthält zugleich eine Leseabfrage und eine Änderungsaktion. Bitte nur die gewünschte Leseabfrage formulieren." };
  if (family === "audit" && /\b(export|exportieren|exportiere|download)\b/.test(text)) return { kind: "audit.exportUnsupported" };
  const ids = [...input.matchAll(ID_PATTERN)].map((match) => ({ prefix: match[1], id: match[0] }));
  if (ids.length > 1) return { kind: "clarify", message: "Bitte nenne nur eine vollständige Kennung." };
  const id = ids[0];
  if (id) {
    const expected = family === "tasks" ? "task" : family === "activity" ? "act" : family === "notifications" ? "ntf" : family === "approvals" ? "appr" : "aud";
    if (id.prefix !== expected) return { kind: "clarify", message: "Die Kennung gehört zu einem anderen Bereich. Bitte Aufgabe, Activity, Benachrichtigung, Freigabe oder Audit passend zur Kennung nennen." };
  }

  const openIdCue = Boolean(id && /^open\b/.test(text));
  const statusText = openIdCue ? text.replace(/^open\b\s*/, "") : text;
  const statuses = readStatus(statusText, family);
  if (statuses.length > 1) return { kind: "clarify", message: "Der Status ist mehrdeutig. Bitte genau einen Status angeben." };
  if (hasForeignStatus(statusText, family))
    return { kind: "clarify", message: "Der genannte Status gehört nicht zu diesem Lesebereich. Bitte den Status für den genannten Bereich prüfen." };
  const hours = lookbackHours(text);
  if (hours === -2) return { kind: "clarify", message: "Heute/Gestern benötigen eine Zeitzone für korrekte Tagesgrenzen. Bitte einen eindeutigen Zeitraum wie 'letzte 24 Stunden' angeben." };
  if (hours === -1) return { kind: "clarify", message: "Der Zeitraum ist zu groß. Bitte höchstens 30 Tage angeben." };
  if (hours === -3) return { kind: "clarify", message: "Bitte nur einen Zeitraum angeben." };
  const periodMatches = [...text.matchAll(LOOKBACK_PATTERN)];
  if (periodMatches.length > 1) return { kind: "clarify", message: "Bitte nur einen Zeitraum angeben." };
  const periodNumber = periodMatches[0]?.[1];
  const allowedWords = new Set(("zeige zeig liste list show search suche such find finde get open abruf abrufe hole detail details mir meine meinen mein my den die das der des im in von fuer und oder bei aufgabe aufgaben task tasks todo todos was what which welche welcher welches ist sind wurde wurden aktuell aktuelle aktuellen recent latest letzte letzten last today yesterday heute gestern hours hour stunden stunde days day tage tag weeks week wochen woche activity activities aktivitaet aktivitaeten aktivitaetsverlauf ereignis ereignisse verlauf event events record records entries eintrag eintraege benachrichtigung benachrichtigungen meldung meldungen alert alerts notification notifications approval approvals freigabe freigaben audit auditprotokoll pruefprotokoll auditlog logs log security sicherheit export exportieren exportiere download").split(/\s+/));
  for (const statusWord of STATUS_WORDS) allowedWords.add(statusWord);
  for (const alias of READ_STATUS_ALIASES.flatMap(({ terms }) => terms.filter((term) => term.includes(" ") && statusTermPattern(term).test(text))))
    for (const word of alias.split(" ")) allowedWords.add(word);
  let periodNumberAvailable = periodNumber !== undefined;
  for (const word of text.split(/\s+/)) {
    if (word === periodNumber && periodNumberAvailable) { periodNumberAvailable = false; continue; }
    if (/^[a-z]{2,4}_[0-9a-z]{26}$/.test(word)) continue;
    if (!allowedWords.has(word)) return { kind: "clarify", message: `Der Filter „${word}“ wird für diesen Lesebereich nicht unterstützt. Bitte Bereich und unterstützten Status nennen.` };
  }
  if (id) {
    if (statuses.length > 0 || hasForeignStatus(statusText, family) || hours !== undefined || /\b(recent|latest|aktuell|aktuelle|recenten)\b/.test(text))
      return { kind: "clarify", message: "Eine Kennung kann nicht mit einem Listenfilter oder Zeitraum kombiniert werden. Bitte nur die Kennung nennen." };
    if (family === "tasks") return { kind: "tasks.get", id: id.id };
    if (family === "activity") return { kind: "activity.get", id: id.id };
    if (family === "notifications") return { kind: "notifications.unsupportedDetail", id: id.id };
    if (family === "approvals") return { kind: "approvals.get", id: id.id };
    return { kind: "audit.get", id: id.id };
  }
  if (hours && family !== "activity" && family !== "audit")
    return { kind: "clarify", message: "Der Lesepfad unterstützt hier keinen Zeitraumfilter. Bitte einen Status oder eine andere Abfrage angeben." };
  if (family === "tasks") return { kind: "tasks.list", ...(statuses[0] ? { status: taskStatuses(statuses[0]) } : {}) };
  if (family === "activity") return { kind: "activity.list", ...(statuses[0] ? { status: statuses[0] } : {}), ...(hours ? { lookbackHours: hours } : {}) };
  if (family === "notifications") return { kind: "notifications.list", ...(statuses[0] ? { status: [statuses[0] as "open" | "acknowledged" | "snoozed" | "resolved"] } : {}) };
  if (family === "approvals") return { kind: "approvals.list", ...(statuses[0] ? { status: [statuses[0] as "pending" | "approved" | "rejected" | "expired" | "cancelled" | "executed" | "failed"] } : {}) };
  return { kind: "audit.list", ...(statuses[0] ? { result: [statuses[0] as "success" | "failure" | "denied" | "pending"] } : {}), ...(hours ? { lookbackHours: hours } : {}), ...(/\b(security|sicherheit)\b/.test(text) ? { securityOnly: true } : {}) };
}

/** German surface forms per file category; only these reach the route as a filter. */
const FILE_CATEGORY_WORDS: Record<FileCategory, string> = {
  generated: "erzeugte|erzeugten|generierte|generierten",
  uploaded: "hochgeladene|hochgeladenen",
  reports: "berichte|berichten|reports",
  presentations: "praesentationen|praesentation",
  invoices: "rechnungen|rechnung",
  research: "recherche|recherchen|recherchedateien",
  exports: "exporte|exportierte|exportierten",
  temporary: "temporaere|temporaeren|temporaer",
};

const FILE_CATEGORIES = ["generated", "uploaded", "reports", "presentations", "invoices", "research", "exports", "temporary"] as const;

/** German surface forms per memory type; only these reach the route as a filter. */
const MEMORY_TYPE_WORDS: Record<"fact" | "preference" | "person" | "company" | "project" | "instruction", string> = {
  fact: "fakten|fakt",
  preference: "vorlieben|praeferenzen|praeferenz",
  person: "personen|person",
  company: "firmen|firma|unternehmen",
  project: "projekte|projekt",
  instruction: "anweisungen|anweisung",
};

const MEMORY_TYPES = ["fact", "preference", "person", "company", "project", "instruction"] as const;

/** German surface forms per agent status; only these reach the route as a filter. */
const AGENT_STATUS_WORDS: Record<"idle" | "starting" | "working" | "waiting" | "paused" | "error" | "offline", string> = {
  idle: "idle|untätig|untaetig|bereit|bereite",
  starting: "starting|startet|startende|startenden",
  working: "working|laeuft|laufend|laufende|laufenden|arbeitet|arbeitende",
  waiting: "waiting|wartet|wartend|wartende|wartenden",
  paused: "paused|pausiert|pausierte|pausierten|angehalten",
  error: "error|fehler|fehlerhaft|fehlerhafte|fehlern|gestoert|gestoerte",
  offline: "offline|getrennt|getrennte",
};

/** "aktive Agenten" means every state except paused, error and offline. */
const ACTIVE_AGENT_STATUSES: AgentStatus[] = ["idle", "starting", "working", "waiting"];

/** "offene Aufgaben" means everything that is not closed; an explicit status stays one-to-one. */
const OPEN_TASK_STATUSES: TaskStatus[] = ["todo", "ready", "running", "waiting", "review"];

function taskStatuses(status: string): TaskStatus[] {
  return status === "open" ? OPEN_TASK_STATUSES : [status as TaskStatus];
}

function requireReadRole(ctx: RequestContext, resource: string, requiredRole: Role): void {
  const principal = ctx.principal;
  if (!principal) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  if (!authorize(principal.role, `read:${resource}`).allowed || ROLE_RANK[principal.role] < ROLE_RANK[requiredRole]) {
    throw new ApiError({ code: "FORBIDDEN", message: "Für diesen Lesebereich fehlt die erforderliche Rolle.", details: { resource, requiredRole } });
  }
}

function baseResponse(ctx: RequestContext, message: string, status: CommandResponse["status"] = "executed"): HandlerResult {
  return { status: 200, body: {
    contractVersion: CONTRACT_VERSION,
    commandId: createId("cmd"),
    correlationId: ctx.correlationId,
    status,
    requiresConfirmation: false,
    previewText: null,
    riskTier: 1,
    approvalId: null,
    result: { message },
  } satisfies CommandResponse };
}

function boundedPeriod(ctx: RequestContext, hours?: number): { from?: string } {
  return hours ? { from: new Date(ctx.runtime.nowMs() - hours * 60 * 60 * 1000).toISOString() } : {};
}

function listMessage<T>(label: string, items: T[], hasNextPage: boolean, line: (item: T) => string): string {
  if (items.length === 0) return `Keine passenden ${label} gefunden.`;
  const rows = items.slice(0, MAX_RESULTS).map(line);
  return `${rows.length} ${label} geladen${hasNextPage ? " (weitere vorhanden)" : ""}: ${rows.join("; ")}`;
}

function settingAreaSummary(settings: Settings, area: SettingsReadArea): string {
  switch (area) {
    case "profile": return `Sprache ${settings.profile.locale}, Zeitzone ${settings.profile.timeZone}, Datumsformat ${settings.profile.dateFormat}, Zeitformat ${settings.profile.timeFormat}, Wochenstart ${settings.profile.firstDayOfWeek}`;
    case "dashboard": return `Layout ${settings.dashboard.activeLayoutId}, Schrift ${settings.dashboard.fontScale}, kompakt ${settings.dashboard.compact}, Aktualisierung ${settings.dashboard.autoRefreshSeconds} Sekunden, Content Studio ${settings.dashboard.contentStudioEnabled === true ? "aktiviert" : "deaktiviert"}`;
    case "theme": return `Theme ${settings.theme.activeThemeId}, Cyan-Intensität ${settings.theme.cyanIntensity}, Panel-Deckkraft ${settings.theme.panelOpacity}, Gold-Intensität ${settings.theme.goldIntensity}`;
    case "orb": return `Preset ${settings.orb.preset}, Größe ${settings.orb.size}, Intensität ${settings.orb.intensity}, Animation ${settings.orb.animations}, Qualität ${settings.orb.quality}, Render-Modus ${settings.orb.renderMode}`;
    case "navigation": return `Modus ${settings.navigation.mode}, Startseite ${settings.navigation.defaultPage}, ausgeblendete Bereiche ${settings.navigation.hidden.length}, Reihenfolge mit ${settings.navigation.order.length} Einträgen`;
    case "modelsRouting": return `Standardmodell ${settings.modelsRouting.defaultModel}, lokale Modelle bevorzugt ${settings.modelsRouting.localFirst}, Aufgabenrouten ${settings.modelsRouting.routes.length}`;
    case "voice": return `Wakeword aktiviert ${settings.voice.wakeWordEnabled}, Sprecherprüfung ${settings.voice.speakerVerificationRequired}, Rohaufnahmen speichern ${settings.voice.storeRawRecordings}, Voice-Verlauf ${settings.voice.voiceHistoryEnabled}, TTS-Stimme ${settings.voice.ttsVoice || "nicht gesetzt"}, TTS-Rate ${settings.voice.ttsRate}. Wakeword und Gerätekennungen werden nicht ausgegeben`;
    case "notifications": return `Kanäle ${settings.notifications.channels.map((channel) => `${channel.kind} ${channel.enabled ? "an" : "aus"} ab ${channel.minPriority}`).join(", ")}, Ruhezeiten ${settings.notifications.quietHours.enabled ? `${settings.notifications.quietHours.from}–${settings.notifications.quietHours.to}` : "aus"}, Standard-Snooze ${settings.notifications.snoozeDefaultMinutes} Minuten`;
    case "approvals": return `Standardablauf ${settings.approvals.draftOnlyByDefault ? "Entwurf" : "direkt"}, Ablauf ${settings.approvals.defaultExpiryMinutes} Minuten, Tier-2-Bestätigung ${settings.approvals.confirmTier2}, Reauth für Tier 3 ${settings.approvals.reauthTier3}, Benachrichtigung ${settings.approvals.notifyOnRequest}`;
    case "dataRetention": return `Activity ${settings.dataRetention.activityDays} Tage, Audit ${settings.dataRetention.auditDays} Tage, Voice-Verlauf ${settings.dataRetention.voiceHistoryDays} Tage, Benachrichtigungen ${settings.dataRetention.notificationDays} Tage, temporäre Dateien ${settings.dataRetention.temporaryFileDays} Tage, Memory-Standard ${settings.dataRetention.memoryDefaultTtlDays ?? "unbegrenzt"} Tage`;
    case "backups": return `aktiv ${settings.backups.enabled}, Zeitplan ${settings.backups.schedule}, Aufbewahrung ${settings.backups.retentionCount}, letzter Status ${settings.backups.lastBackupStatus}${settings.backups.lastBackupAt ? ` am ${settings.backups.lastBackupAt}` : ""}. Zielpfad wird nicht ausgegeben`;
    case "developer": return `Debug ${settings.developer.debugMode}, Rohdatenansicht ${settings.developer.showRawJson}, Szenariokonsole ${settings.developer.scenarioConsole}, Log-Level ${settings.developer.logLevel}`;
    case "security": return `Login erforderlich ${settings.security.loginRequired === true}, Remotezugriff ${settings.security.allowRemoteAccess}, Sitzungszeitlimit ${settings.security.sessionTimeoutMinutes} Minuten, Reauth-Fenster ${settings.security.reauthWindowMinutes} Minuten, Hash-Chain ${settings.security.auditHashChain}, vertrauenswürdige Origins ${settings.security.trustedOrigins.length}. Origin-Adressen werden nicht ausgegeben`;
  }
}

const VOICE_READBACK_MAX_AGE_MS = 60_000;

function knownValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function formatVoiceRuntimeReadback(
  settings: Pick<Settings["voice"], "ttsVoice" | "inputDeviceId" | "outputDeviceId">,
  response: Pick<VoiceStatusResponse, "data" | "freshness">,
  nowMs = Date.now(),
): string {
  const freshness: Freshness = response.freshness;
  const asOfMs = typeof freshness.asOf === "string" ? Date.parse(freshness.asOf) : Number.NaN;
  const ageMs = nowMs - asOfMs;
  if (freshness.state !== "fresh" || !Number.isFinite(asOfMs) || ageMs < -5_000 || ageMs > VOICE_READBACK_MAX_AGE_MS)
    return "Laufzeit-Readback: nicht verifiziert (Statusquelle unbekannt, offline, veraltet oder ohne frischen Zeitstempel)";

  const status = response.data;
  const configuredVoice = knownValue(settings.ttsVoice);
  const actualVoice = knownValue(status.ttsVoiceChoice);
  const voiceComparison = configuredVoice && actualVoice
    ? actualVoice === configuredVoice ? "TTS-Stimme stimmt mit dem gespeicherten Wert ueberein" : "TTS-Stimme weicht vom gespeicherten Wert ab"
    : "TTS-Stimme nicht verglichen (gespeicherter oder aufgeloester Wert fehlt)";
  const compareDevice = (configured: unknown, actual: unknown): string => {
    const saved = knownValue(configured);
    const resolved = knownValue(actual);
    if (!saved) return "Default-Policy gespeichert; aufgeloestes Geraet nicht verglichen";
    if (!resolved) return "Geraetevergleich nicht verifiziert (Dienst meldet keine aufgeloeste Kennung)";
    return saved === resolved ? "Kennung stimmt ueberein" : "Kennung weicht ab";
  };
  return `Laufzeit-Readback (${freshness.asOf}): ${voiceComparison}; Eingabegeraet ${compareDevice(settings.inputDeviceId, status.audioInputDeviceId)}; Ausgabegeraet ${compareDevice(settings.outputDeviceId, status.audioOutputDeviceId)}; STT ${status.stt?.state ?? "unbekannt"}, TTS ${status.tts?.state ?? "unbekannt"}`;
}

async function voiceRuntimeReadback(ctx: RequestContext, settings: Settings): Promise<string> {
  try {
    const response = await ctx.runtime.registry.getPort("voice").getVoiceStatus({}, ctx.call);
    return formatVoiceRuntimeReadback(settings.voice, response);
  } catch (error) {
    if (isAdapterError(error) && ["CAPABILITY_MISSING", "ADAPTER_UNAVAILABLE"].includes(error.code))
      return "Laufzeit-Readback: nicht verfuegbar; angewendeter Zustand nicht verifiziert";
    throw error;
  }
}

const idStatus = (id: string, status: string, date: string): string => `${id} · ${status} · ${date}`;
// Sensitive and restricted titles and contents are never spoken back.
const memoryTitle = (memory: Memory): string => memory.sensitivity === "normal" ? memory.title ?? "" : "vertraulich";
const truncate = (text: string, max: number): string => text.length > max ? `${text.slice(0, max - 1)}…` : text;
const fileSize = (bytes: number): string => bytes < 1024 ? `${bytes} Byte`
  : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

async function listApprovals(ctx: RequestContext, status?: Array<"pending" | "approved" | "rejected" | "expired" | "cancelled" | "executed" | "failed">): Promise<{ items: Approval[]; hasNextPage: boolean }> {
  const ownerId = ctx.principal!.userId;
  const params = { limit: MAX_RESULTS, ...(status ? { status } : {}) };
  const native = ctx.runtime.nativeApprovals.listApprovals(ownerId).filter((approval) => !status || status.includes(approval.status));
  try {
    const remote = await ctx.runtime.registry.getPort("approvals").listApprovals(params, ctx.call);
    // Match the authoritative GET handler's native-first merge, then impose the command's output bound.
    return { items: [...native, ...remote.items].slice(0, MAX_RESULTS),
      hasNextPage: remote.pageInfo.hasNextPage || native.length + remote.items.length > MAX_RESULTS };
  } catch (error) {
    if (isAdapterError(error) && ["CAPABILITY_MISSING", "ADAPTER_UNAVAILABLE"].includes(error.code))
      return { items: native.slice(0, MAX_RESULTS), hasNextPage: native.length > MAX_RESULTS };
    throw error;
  }
}

export async function executeReadQuery(ctx: RequestContext, intent: ReadQueryIntent): Promise<HandlerResult> {
  if (intent.kind === "clarify") return baseResponse(ctx, intent.message, "rejected");
  if (intent.kind === "settings.get") requireReadRole(ctx, "settings", "viewer");
  if (intent.kind === "contentStudio.plan") requireReadRole(ctx, "content-studio-plan", "owner");
  if (intent.kind.startsWith("tasks.")) requireReadRole(ctx, "tasks", "viewer");
  if (intent.kind === "calendar.list") requireReadRole(ctx, "calendar", "viewer");
  if (intent.kind === "communication.list") requireReadRole(ctx, "communication", "viewer");
  if (intent.kind.startsWith("agents.")) requireReadRole(ctx, "agents", "viewer");
  if (intent.kind.startsWith("automations.")) requireReadRole(ctx, "automations", "viewer");
  if (intent.kind.startsWith("memory.")) requireReadRole(ctx, "memory", "viewer");
  if (intent.kind.startsWith("research.")) requireReadRole(ctx, "research", "viewer");
  if (intent.kind.startsWith("files.")) requireReadRole(ctx, "files", "viewer");
  if (intent.kind.startsWith("activity.")) requireReadRole(ctx, "activity", "viewer");
  if (intent.kind.startsWith("notifications.")) requireReadRole(ctx, "notifications", "viewer");
  if (intent.kind.startsWith("approvals.")) requireReadRole(ctx, "approvals", "viewer");
  if (intent.kind === "audit.exportUnsupported") requireReadRole(ctx, "audit", "owner");
  else if (intent.kind.startsWith("audit.")) requireReadRole(ctx, "audit", "viewer");

  switch (intent.kind) {
    case "settings.get": {
      const settings = ctx.runtime.settings.get();
      const labels: Record<SettingsReadArea, string> = {
        profile: "Profil", dashboard: "Dashboard", theme: "Theme", orb: "Orb", navigation: "Navigation",
        modelsRouting: "Modelrouting", voice: "Voice", notifications: "Benachrichtigungen", approvals: "Freigaben",
        dataRetention: "Datenaufbewahrung", backups: "Backups", developer: "Entwickler", security: "Sicherheit",
      };
      if (!intent.area) return baseResponse(ctx,
        `Gespeicherter Settings-Stand einschließlich Vorgabewerten, Revision ${settings.version}, zuletzt geändert ${settings.updatedAt}. Bereiche: ${Object.values(labels).join(", ")}. Dieser Abruf bestätigt keinen angewendeten oder effektiven Laufzeitzustand.`);
      const detail = settingAreaSummary(settings, intent.area);
      const runtime = intent.area === "voice" ? await voiceRuntimeReadback(ctx, settings)
        : "Angewendet/effektiv: durch diesen Abruf nicht separat verifiziert";
      return baseResponse(ctx, `Sichere Zusammenfassung ${labels[intent.area]} des gespeicherten Settings-Stands einschließlich Vorgabewerten (Revision ${settings.version}): ${detail}. ${runtime}.`);
    }
    case "contentStudio.plan": {
      if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
      const state: ContentPlanState = ctx.runtime.contentStudioPlan.get();
      if (!state.plan) return baseResponse(ctx, `Der gespeicherte Content-Studio-Plan ist leer (Revision ${state.revision}).`);
      const ideaLimit = Math.min(state.plan.content.length, MAX_RESULTS);
      const postingLimit = Math.max(0, MAX_RESULTS - ideaLimit);
      const ideas = state.plan.content.slice(0, ideaLimit).map((item) => `${item.titel} · ${item.plattform} · ${item.status} · Ziel ${item.zieldatum || "ohne Datum"}`);
      const postings = state.plan.postings.slice(0, postingLimit).map((item) => `${item.titel} · ${item.plattform} · ${item.status} · ${item.datum} ${item.uhrzeit}`);
      const more = state.plan.content.length + state.plan.postings.length > MAX_RESULTS;
      return baseResponse(ctx, `Gespeicherter Content-Studio-Plan, Revision ${state.revision}: ${state.plan.content.length} Ideen und ${state.plan.postings.length} Postings. ${[
        ...ideas.map((item) => `Idee: ${item}`), ...postings.map((item) => `Posting: ${item}`),
      ].join("; ") || "Keine Einträge."}${more ? " (weitere vorhanden)" : ""}`);
    }
    case "automations.list": {
      const page = await ctx.runtime.registry.getPort("automations").listAutomations({
        limit: MAX_RESULTS,
        ...(intent.enabled !== undefined ? { enabled: intent.enabled } : {}),
      }, ctx.call);
      return baseResponse(ctx, listMessage("Automationen", page.items, page.pageInfo.hasNextPage,
        (automation: Automation) => idStatus(automation.id, `${automation.name} (${automation.enabled ? "aktiv" : "deaktiviert"})`, automation.nextRunAt ?? automation.updatedAt)));
    }
    case "automations.get": {
      const automation = (await ctx.runtime.registry.getPort("automations").getAutomation({ id: intent.id }, ctx.call)).data;
      return baseResponse(ctx, `Automation ${automation.id}: ${automation.name}, ${automation.enabled ? "aktiv" : "deaktiviert"}${automation.nextRunAt ? `, nächster Lauf ${automation.nextRunAt}` : ""}${automation.lastError ? `, letzter Fehler: ${automation.lastError}` : ""}.`);
    }
    case "memory.list": {
      const page = await ctx.runtime.registry.getPort("memory").listMemory({
        limit: MAX_RESULTS,
        ...(intent.pinned ? { pinned: true } : {}),
        ...(intent.type ? { type: intent.type } : {}),
      }, ctx.call);
      return baseResponse(ctx, listMessage("Gedächtniseinträge", page.items, page.pageInfo.hasNextPage,
        (memory: Memory) => idStatus(memory.id, `${memory.type} · ${memoryTitle(memory)}`, memory.updatedAt)));
    }
    case "memory.get": {
      const memory = (await ctx.runtime.registry.getPort("memory").getMemory({ id: intent.id }, ctx.call)).data;
      return baseResponse(ctx, `Gedächtniseintrag ${memory.id}: ${memory.type}, ${memoryTitle(memory)}${memory.sensitivity === "normal" ? `: ${truncate(memory.content ?? "", 300)}` : ""}${memory.pinned ? ", angeheftet" : ""}.`);
    }
    case "research.list": {
      // Mirrors the GET handler, which only falls back to the adapter in mock mode.
      let items: ResearchProject[];
      let hasNextPage: boolean;
      if (ctx.runtime.config.dataMode === "mock") {
        const page = await ctx.runtime.registry.getPort("research").listResearchProjects({ limit: MAX_RESULTS }, ctx.call);
        items = page.items;
        hasNextPage = page.pageInfo.hasNextPage;
      } else {
        const ownerId = ctx.principal!.userId;
        items = ctx.runtime.research.list(ownerId, undefined, MAX_RESULTS, 0);
        hasNextPage = ctx.runtime.research.count(ownerId) > items.length;
      }
      return baseResponse(ctx, listMessage("Recherchen", items, hasNextPage,
        (project: ResearchProject) => idStatus(project.id, `${project.status} · ${project.topic}`, project.updatedAt)));
    }
    case "research.get": {
      const project = ctx.runtime.config.dataMode === "mock"
        ? (await ctx.runtime.registry.getPort("research").getResearchProject({ id: intent.id }, ctx.call)).data
        : ctx.runtime.research.get(ctx.principal!.userId, intent.id);
      return baseResponse(ctx, `Recherche ${project.id}: ${project.topic}, Status ${project.status}, ${project.sourceCount ?? 0} Quellen, ${project.findingCount ?? 0} Erkenntnisse.`);
    }
    case "files.list": {
      const page = await ctx.runtime.registry.getPort("files").listFiles({
        limit: MAX_RESULTS,
        ...(intent.category ? { category: intent.category } : {}),
      }, ctx.call);
      return baseResponse(ctx, listMessage("Dateien", page.items, page.pageInfo.hasNextPage,
        (file: FileItem) => idStatus(file.id, `${file.category} · ${file.name}`, file.updatedAt)));
    }
    case "files.get": {
      const file = (await ctx.runtime.registry.getPort("files").getFile({ id: intent.id }, ctx.call)).data;
      return baseResponse(ctx, `Datei ${file.id}: ${file.name}, Kategorie ${file.category}, ${fileSize(file.sizeBytes)}, Version ${file.currentVersion}, geändert ${file.updatedAt}.`);
    }
    case "agents.list": {
      const page = await ctx.runtime.registry.getPort("agents").listAgents({ limit: MAX_RESULTS, ...(intent.status ? { status: intent.status } : {}) }, ctx.call);
      return baseResponse(ctx, listMessage("Agenten", page.items, page.pageInfo.hasNextPage,
        (agent: Agent) => idStatus(agent.id, `${agent.status}/${agent.name}${agent.model ? ` (${agent.model})` : ""}`, agent.lastActivityAt ?? agent.updatedAt)));
    }
    case "agents.get": {
      const agent = (await ctx.runtime.registry.getPort("agents").getAgent({ id: intent.id }, ctx.call)).data;
      return baseResponse(ctx, `Agent ${agent.id}: ${agent.name}, ${agent.status}${agent.model ? `, ${agent.model}` : ""}${agent.lastError ? `, letzter Fehler: ${agent.lastError}` : ""}.`);
    }
    case "communication.list": {
      const page = await ctx.runtime.registry.getPort("communication").listThreads({
        limit: MAX_RESULTS,
        ...(intent.status ? { status: intent.status } : {}),
        ...(intent.needsReply ? { needsReply: true } : {}),
      }, ctx.call);
      return baseResponse(ctx, listMessage("Unterhaltungen", page.items, page.pageInfo.hasNextPage,
        (thread: Thread) => idStatus(thread.id, `${thread.channelKind}/${thread.status}${thread.needsReply ? "/Antwort offen" : ""} ${thread.subject}`, thread.lastMessageAt)));
    }
    case "calendar.list": {
      const timeZone = ctx.runtime.settings.area("profile").timeZone;
      const range = localDayRange(ctx.runtime.nowMs(), timeZone, intent.dayOffset);
      if (!range) {
        return baseResponse(ctx, "Ohne gültige Zeitzone im Profil kann ich Tagesgrenzen nicht berechnen. Bitte die Zeitzone in den Einstellungen setzen.");
      }
      const page = await ctx.runtime.registry.getPort("calendar").listCalendarEvents({ from: range.from, to: range.to, limit: MAX_RESULTS }, ctx.call);
      return baseResponse(ctx, listMessage(intent.dayOffset === 0 ? "Termine heute" : "Termine morgen", page.items, page.pageInfo.hasNextPage,
        (event: CalendarEvent) => idStatus(event.id, `${event.start} ${event.title}`, event.start)));
    }
    case "tasks.list": {
      const page = await ctx.runtime.registry.getPort("tasks").listTasks({ limit: MAX_RESULTS, sort: "priority", ...(intent.status ? { status: intent.status } : {}) }, ctx.call);
      return baseResponse(ctx, listMessage("Aufgaben", page.items, page.pageInfo.hasNextPage,
        (task: Task) => idStatus(task.id, `${task.status}/${task.priority} ${task.title}`, task.updatedAt)));
    }
    case "tasks.get": {
      const task = (await ctx.runtime.registry.getPort("tasks").getTask({ id: intent.id }, ctx.call)).data;
      return baseResponse(ctx, `Aufgabe ${task.id}: ${task.title}, ${task.status}/${task.priority}, aktualisiert ${task.updatedAt}.`);
    }
    case "activity.list": {
      const page = await ctx.runtime.registry.getPort("activity").listActivity({ limit: MAX_RESULTS, ...(intent.status ? { status: intent.status } : {}), ...boundedPeriod(ctx, intent.lookbackHours) }, ctx.call);
      return baseResponse(ctx, listMessage("Activity-Ereignisse", page.items, page.pageInfo.hasNextPage,
        (event: ActivityEvent) => idStatus(event.id, `${event.kind}/${event.status}/${event.severity}`, event.occurredAt)));
    }
    case "activity.get": {
      const event = (await ctx.runtime.registry.getPort("activity").getActivityEvent({ id: intent.id }, ctx.call)).data;
      return baseResponse(ctx, `Activity ${event.id}: ${event.kind}, ${event.status}, ${event.severity}, ${event.occurredAt}.`);
    }
    case "notifications.list": {
      const page = await ctx.runtime.registry.getPort("notifications").listNotifications({ limit: MAX_RESULTS, ...(intent.status ? { status: intent.status } : {}) }, ctx.call);
      return baseResponse(ctx, listMessage("Benachrichtigungen", page.items, page.pageInfo.hasNextPage,
        (item: Notification) => idStatus(item.id, `${item.status}/${item.priority}/${item.category}`, item.updatedAt)));
    }
    case "notifications.unsupportedDetail":
      return baseResponse(ctx, `Benachrichtigung ${intent.id}: Es gibt keine Detail-Leseoperation. Du kannst die Liste nach Status filtern (offen, bestätigt, zurückgestellt oder erledigt).`, "rejected");
    case "approvals.list": {
      const page = await listApprovals(ctx, intent.status);
      return baseResponse(ctx, listMessage("Freigaben", page.items, page.hasNextPage,
        (item: Approval) => idStatus(item.id, `${item.status}/Tier ${item.riskTier}`, item.updatedAt)));
    }
    case "approvals.get": {
      const native = ctx.runtime.nativeApprovals.getApproval(ctx.principal!.userId, intent.id);
      const approval = native ?? (await ctx.runtime.registry.getPort("approvals").getApproval({ id: intent.id }, ctx.call)).data;
      return baseResponse(ctx, `Freigabe ${approval.id}: ${approval.status}, Tier ${approval.riskTier}, aktualisiert ${approval.updatedAt}.`);
    }
    case "audit.list": {
      const period = boundedPeriod(ctx, intent.lookbackHours) as { from?: string; to?: string };
      const page = auditTrailPage(ctx.runtime.db, {
        limit: MAX_RESULTS,
        ...(period.from ? { from: period.from } : {}),
        ...(period.to ? { to: period.to } : {}),
        ...(intent.result?.length ? { result: [intent.result[0]!] } : {}),
        ...(intent.securityOnly ? { category: ["security"] } : {}),
      });
      return baseResponse(ctx, listMessage("Audit-Ereignisse", page.items, page.pageInfo.hasNextPage,
        (event: AuditEvent) => idStatus(event.id, `${event.category}/${event.result}/${event.severity}`, event.occurredAt)));
    }
    case "audit.get": {
      const event = auditTrailEvent(ctx.runtime.db, intent.id);
      if (!event) throw new ApiError({ code: "NOT_FOUND", message: "Audit-Ereignis nicht gefunden." });
      return baseResponse(ctx, `Audit ${event.id}: ${event.category}, ${event.result}, ${event.severity}, ${event.occurredAt}.`);
    }
    case "audit.exportUnsupported":
      return baseResponse(ctx, "Ein Audit-Export ist kein NL-Lesebefehl. Verwende den owner-berechtigten Export im Audit-Bereich.", "rejected");
  }
  throw validationFailed("Der Lesebefehl wird nicht unterstützt.", [{ path: "text", message: "unbekannter typed read intent" }]);
}
