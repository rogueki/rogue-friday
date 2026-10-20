import { authorize, type Role } from "@friday/auth";
import { isAdapterError } from "@friday/adapter-core";
import { CONTRACT_VERSION, type ActivityEvent, type Approval, type AuditEvent, type CommandResponse, type Notification } from "@friday/sdk";
import { createId } from "@friday/observability";
import type { HandlerResult, RequestContext } from "../http/context";
import { ApiError, validationFailed } from "../util/errors";

const MAX_RESULTS = 5;
const ROLE_RANK: Record<Role, number> = { viewer: 0, operator: 1, owner: 2 };

export type ReadQueryIntent =
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

const READ_CUE = /\b(zeige|zeig|liste|list|show|search|suche|such|find|finde|get|open|abruf|abrufe|hole|detail|details|was|welche|welcher|welches|what|which|recent|latest|aktuell|aktuelle|letzte|letzten|recenten|export|exportieren|exportiere|download)\b/;
const FAMILY_PATTERNS = [
  { family: "activity", pattern: /\b(activity|activities|aktivitaet|aktivitaeten|aktivitaetsverlauf)\b/ },
  { family: "notifications", pattern: /\b(alert|alerts|notification|notifications|benachrichtigung|benachrichtigungen|meldung|meldungen)\b/ },
  { family: "approvals", pattern: /\b(approval|approvals|freigabe|freigaben)\b/ },
  { family: "audit", pattern: /\b(audit|auditprotokoll|pruefprotokoll|auditlog)\b/ },
] as const;
export const READ_STATUS_ALIASES: Array<{ terms: string[]; mapsTo: Partial<Record<"activity" | "notifications" | "approvals" | "audit", string>> }> = [
  { terms: ["failed", "failure", "fehlgeschlagen", "fehlgeschlagene", "fehlgeschlagenen", "fehler", "fehlerhaft"], mapsTo: { activity: "failed", approvals: "failed", audit: "failure" } },
  { terms: ["running", "laeuft", "laufend", "in arbeit"], mapsTo: { activity: "running" } },
  { terms: ["started", "gestartet"], mapsTo: { activity: "started" } },
  { terms: ["succeeded", "successful", "erfolgreich", "abgeschlossen"], mapsTo: { activity: "succeeded", audit: "success" } },
  { terms: ["cancelled", "canceled", "abgebrochen"], mapsTo: { activity: "cancelled", approvals: "cancelled" } },
  { terms: ["info", "informational", "information", "informativ"], mapsTo: { activity: "info" } },
  { terms: ["open", "offen", "offene", "aktiv"], mapsTo: { notifications: "open", approvals: "pending" } },
  { terms: ["acknowledged", "acknowledge", "bestaetigt", "quittiert"], mapsTo: { notifications: "acknowledged" } },
  { terms: ["snoozed", "zurueckgestellt", "pausiert"], mapsTo: { notifications: "snoozed" } },
  { terms: ["resolved", "geloest", "erledigt"], mapsTo: { notifications: "resolved" } },
  { terms: ["pending", "ausstehend", "ausstehende"], mapsTo: { approvals: "pending", audit: "pending" } },
  { terms: ["approved", "genehmigt", "freigegeben"], mapsTo: { approvals: "approved" } },
  { terms: ["rejected", "abgelehnt"], mapsTo: { approvals: "rejected" } },
  { terms: ["expired", "abgelaufen"], mapsTo: { approvals: "expired" } },
  { terms: ["executed", "ausgefuehrt"], mapsTo: { approvals: "executed" } },
  { terms: ["denied", "verweigert", "abgewiesen"], mapsTo: { audit: "denied" } },
  { terms: ["success", "erfolgreich"], mapsTo: { audit: "success" } },
];
const STATUS_WORDS = new Set(READ_STATUS_ALIASES.flatMap(({ terms }) => terms.filter((term) => !term.includes(" "))));
const ID_PATTERN = /\b(act|ntf|appr|aud)_[0-9A-Za-z]{26}\b/g;

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
  const families = FAMILY_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ family }) => family);
  if (families.length === 0) return null;
  if (families.length > 1) return { kind: "clarify", message: "Meinst du Activity, Benachrichtigungen, Freigaben oder Audit? Bitte nur einen Bereich nennen." };

  const family = families[0]!;
  if (/\b(create|add|update|change|delete|remove|approve|reject|start|stop|pause|resume|erstelle|erstellen|hinzufuegen|aendere|aendern|loesche|entferne|genehmige|genehmigen|lehne|ablehnen|starte|starten|stoppe|stoppen|pausiere|pausieren)\b/.test(text))
    return { kind: "clarify", message: "Der Text enthält zugleich eine Leseabfrage und eine Änderungsaktion. Bitte nur die gewünschte Leseabfrage formulieren." };
  if (family === "audit" && /\b(export|exportieren|exportiere|download)\b/.test(text)) return { kind: "audit.exportUnsupported" };
  const ids = [...input.matchAll(ID_PATTERN)].map((match) => ({ prefix: match[1], id: match[0] }));
  if (ids.length > 1) return { kind: "clarify", message: "Bitte nenne nur eine vollständige Kennung." };
  const id = ids[0];
  if (id) {
    const expected = family === "activity" ? "act" : family === "notifications" ? "ntf" : family === "approvals" ? "appr" : "aud";
    if (id.prefix !== expected) return { kind: "clarify", message: "Die Kennung gehört zu einem anderen Bereich. Bitte Activity, Benachrichtigung, Freigabe oder Audit passend zur Kennung nennen." };
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
  const allowedWords = new Set(("zeige zeig liste list show search suche such find finde get open abruf abrufe hole detail details mir den die das der des im in von fuer und oder bei was what which welche welcher welches ist sind wurde wurden aktuell aktuelle aktuellen recent latest letzte letzten last today yesterday heute gestern hours hour stunden stunde days day tage tag weeks week wochen woche activity activities aktivitaet aktivitaeten aktivitaetsverlauf ereignis ereignisse verlauf event events record records entries eintrag eintraege benachrichtigung benachrichtigungen meldung meldungen alert alerts notification notifications approval approvals freigabe freigaben audit auditprotokoll pruefprotokoll auditlog logs log security sicherheit export exportieren exportiere download").split(/\s+/));
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
    if (family === "activity") return { kind: "activity.get", id: id.id };
    if (family === "notifications") return { kind: "notifications.unsupportedDetail", id: id.id };
    if (family === "approvals") return { kind: "approvals.get", id: id.id };
    return { kind: "audit.get", id: id.id };
  }
  if (hours && family !== "activity" && family !== "audit")
    return { kind: "clarify", message: "Der Lesepfad unterstützt hier keinen Zeitraumfilter. Bitte einen Status oder eine andere Abfrage angeben." };
  if (family === "activity") return { kind: "activity.list", ...(statuses[0] ? { status: statuses[0] } : {}), ...(hours ? { lookbackHours: hours } : {}) };
  if (family === "notifications") return { kind: "notifications.list", ...(statuses[0] ? { status: [statuses[0] as "open" | "acknowledged" | "snoozed" | "resolved"] } : {}) };
  if (family === "approvals") return { kind: "approvals.list", ...(statuses[0] ? { status: [statuses[0] as "pending" | "approved" | "rejected" | "expired" | "cancelled" | "executed" | "failed"] } : {}) };
  return { kind: "audit.list", ...(statuses[0] ? { result: [statuses[0] as "success" | "failure" | "denied" | "pending"] } : {}), ...(hours ? { lookbackHours: hours } : {}), ...(/\b(security|sicherheit)\b/.test(text) ? { securityOnly: true } : {}) };
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

const idStatus = (id: string, status: string, date: string): string => `${id} · ${status} · ${date}`;

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
  if (intent.kind.startsWith("activity.")) requireReadRole(ctx, "activity", "viewer");
  if (intent.kind.startsWith("notifications.")) requireReadRole(ctx, "notifications", "viewer");
  if (intent.kind.startsWith("approvals.")) requireReadRole(ctx, "approvals", "viewer");
  if (intent.kind === "audit.exportUnsupported") requireReadRole(ctx, "audit", "owner");
  else if (intent.kind.startsWith("audit.")) requireReadRole(ctx, "audit", "viewer");

  switch (intent.kind) {
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
      const page = await ctx.runtime.registry.getPort("audit").listAuditEvents({ limit: MAX_RESULTS, ...boundedPeriod(ctx, intent.lookbackHours), ...(intent.result ? { result: intent.result } : {}), ...(intent.securityOnly ? { category: ["security"] } : {}) }, ctx.call);
      return baseResponse(ctx, listMessage("Audit-Ereignisse", page.items, page.pageInfo.hasNextPage,
        (event: AuditEvent) => idStatus(event.id, `${event.category}/${event.result}/${event.severity}`, event.occurredAt)));
    }
    case "audit.get": {
      const event = (await ctx.runtime.registry.getPort("audit").getAuditEvent({ id: intent.id }, ctx.call)).data;
      return baseResponse(ctx, `Audit ${event.id}: ${event.category}, ${event.result}, ${event.severity}, ${event.occurredAt}.`);
    }
    case "audit.exportUnsupported":
      return baseResponse(ctx, "Ein Audit-Export ist kein NL-Lesebefehl. Verwende den owner-berechtigten Export im Audit-Bereich.", "rejected");
  }
  throw validationFailed("Der Lesebefehl wird nicht unterstützt.", [{ path: "text", message: "unbekannter typed read intent" }]);
}
