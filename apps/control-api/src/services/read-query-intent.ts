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

const READ_CUE = /\b(zeige|zeig|liste|list|show|search|suche|such|find|finde|was|welche|welcher|welches|what|which|recent|latest|aktuell|aktuelle|letzte|letzten|recenten|export|exportieren|exportiere|download)\b/;
const FAMILY_PATTERNS = [
  { family: "activity", pattern: /\b(activity|activities|aktivitaet|aktivitaeten|aktivitaetsverlauf)\b/ },
  { family: "notifications", pattern: /\b(alert|alerts|notification|notifications|benachrichtigung|benachrichtigungen|meldung|meldungen)\b/ },
  { family: "approvals", pattern: /\b(approval|approvals|freigabe|freigaben)\b/ },
  { family: "audit", pattern: /\b(audit|auditprotokoll|pruefprotokoll|auditlog)\b/ },
] as const;
const ID_PATTERN = /\b(act|ntf|appr|aud)_[0-9A-Za-z]{26}\b/g;

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}_]+/gu, " ").trim();
}

function readStatus(text: string, family: string): string[] {
  const result: string[] = [];
  const add = (pattern: RegExp, value: string): void => { if (pattern.test(text)) result.push(value); };
  if (family === "activity") {
    add(/\b(failed|failure|fehlgeschlag\w*|fehlerhaft)\b/, "failed");
    add(/\b(running|laeuft|laufend|in arbeit)\b/, "running");
    add(/\b(started|gestartet)\b/, "started");
    add(/\b(succeeded|successful|erfolgreich|abgeschlossen)\b/, "succeeded");
    add(/\b(cancelled|canceled|abgebrochen)\b/, "cancelled");
  } else if (family === "notifications") {
    add(/\b(open|offen|offene|aktiv)\b/, "open");
    add(/\b(acknowledged|acknowledge|bestaetigt|quittiert)\b/, "acknowledged");
    add(/\b(snoozed|zurueckgestellt|pausiert)\b/, "snoozed");
    add(/\b(resolved|geloest|erledigt)\b/, "resolved");
  } else if (family === "approvals") {
    add(/\b(pending|offen|ausstehend|ausstehende)\b/, "pending");
    add(/\b(approved|genehmigt|freigegeben)\b/, "approved");
    add(/\b(rejected|abgelehnt)\b/, "rejected");
    add(/\b(expired|abgelaufen)\b/, "expired");
    add(/\b(cancelled|canceled|abgebrochen)\b/, "cancelled");
    add(/\b(executed|ausgefuehrt)\b/, "executed");
    add(/\b(failed|fehlgeschlagen)\b/, "failed");
  } else if (family === "audit") {
    add(/\b(failed|failure|fehlgeschlagen|fehler)\b/, "failure");
    add(/\b(denied|denied|verweigert|abgewiesen)\b/, "denied");
    add(/\b(success|successful|erfolgreich)\b/, "success");
    add(/\b(pending|ausstehend)\b/, "pending");
  }
  return [...new Set(result)];
}

function lookbackHours(text: string): number | undefined {
  if (/\b(today|heute)\b/.test(text)) return 24;
  if (/\b(yesterday|gestern)\b/.test(text)) return 48;
  const match = /\b(?:last|letzte|letzten)\s+(\d{1,3})\s+(hour|hours|stunde|stunden|day|days|tag|tage|week|weeks|woche|wochen)\b/.exec(text);
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
  if (family === "audit" && /\b(export|exportieren|exportiere|download)\b/.test(text)) return { kind: "audit.exportUnsupported" };
  const ids = [...input.matchAll(ID_PATTERN)].map((match) => ({ prefix: match[1], id: match[0] }));
  if (ids.length > 1) return { kind: "clarify", message: "Bitte nenne nur eine vollständige Kennung." };
  const id = ids[0];
  if (id) {
    const expected = family === "activity" ? "act" : family === "notifications" ? "ntf" : family === "approvals" ? "appr" : "aud";
    if (id.prefix !== expected) return { kind: "clarify", message: "Die Kennung gehört zu einem anderen Bereich. Bitte Activity, Benachrichtigung, Freigabe oder Audit passend zur Kennung nennen." };
    if (family === "activity") return { kind: "activity.get", id: id.id };
    if (family === "notifications") return { kind: "notifications.unsupportedDetail", id: id.id };
    if (family === "approvals") return { kind: "approvals.get", id: id.id };
    return { kind: "audit.get", id: id.id };
  }

  const statuses = readStatus(text, family);
  if (statuses.length > 1) return { kind: "clarify", message: "Der Status ist mehrdeutig. Bitte genau einen Status angeben." };
  const hours = lookbackHours(text);
  if (hours === -1) return { kind: "clarify", message: "Der Zeitraum ist zu groß. Bitte höchstens 30 Tage angeben." };
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
    return { items: [...native, ...remote.items]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
      .slice(0, MAX_RESULTS), hasNextPage: remote.pageInfo.hasNextPage || native.length + remote.items.length > MAX_RESULTS };
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
      return baseResponse(ctx, `Benachrichtigung ${intent.id}: Es gibt keine Detail-Leseoperation. Bitte nach Status oder Priorität filtern.`, "rejected");
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
