import { authorize } from "@friday/auth";
import { CONTRACT_VERSION, parseStudioPlan, type CommandRequest, type CommandResponse, type ContentPlanDocument, type SettingsPatch } from "@friday/sdk";
import { Buffer } from "node:buffer";
import { createId } from "@friday/observability";
import type { HandlerResult, RequestContext } from "../http/context";
import type { NativeExecutableAction } from "../services/native-approval-requests";
import type { SettingsContentMutationIntent } from "../services/settings-content-mutation-intent";
import { contentStudioHandlers } from "./content-studio";
import { settingsHandlers } from "./settings";
import { conflict, forbidden, validationFailed } from "../util/errors";

const baseResponse = (ctx: RequestContext, status: CommandResponse["status"], values: Partial<CommandResponse> = {}): HandlerResult => ({
  status: 200,
  body: {
    contractVersion: CONTRACT_VERSION, commandId: createId("cmd"), correlationId: ctx.correlationId, riskTier: 1,
    status, requiresConfirmation: status === "requires_confirmation", previewText: null, approvalId: null, result: null,
    ...values,
  } satisfies CommandResponse,
});

function isOwner(ctx: RequestContext): string {
  if (!ctx.principal) throw forbidden("Owner-Anmeldung erforderlich.");
  if (ctx.principal.role !== "owner") throw forbidden("Diese Befehle sind nur fuer den Owner verfuegbar.");
  return ctx.principal.userId;
}

function sameIntent(action: NativeExecutableAction, intent: SettingsContentMutationIntent): boolean {
  if (intent.kind === "settings.dashboard.compact")
    return action.kind === intent.kind && action.value === intent.value;
  if (intent.kind === "contentStudio.idea.add")
    return action.kind === intent.kind && action.idea.titel === intent.title;
  if (intent.kind === "contentStudio.idea.status")
    return action.kind === intent.kind && action.title.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE")
      && action.status === intent.status;
  return false;
}

function storedAction(ctx: RequestContext, ownerId: string, request: CommandRequest,
  intent: SettingsContentMutationIntent): NativeExecutableAction | null {
  if (!request.previewId) return null;
  const action = ctx.runtime.nativeApprovals.readAction(ownerId, request.previewId);
  if (!action || !sameIntent(action, intent)) throw conflict("Der Entwurf passt nicht zur beschriebenen Aenderung.");
  return action;
}

function makeAction(ctx: RequestContext, intent: SettingsContentMutationIntent): NativeExecutableAction {
  if (intent.kind === "settings.dashboard.compact") {
    if (!authorize(ctx.principal!.role, "settings.update").allowed) throw forbidden("Einstellungen duerfen nur vom Owner geaendert werden.");
    const current = ctx.runtime.settings.get();
    const patch: SettingsPatch = { dashboard: { ...current.dashboard, compact: intent.value } };
    ctx.runtime.settings.validateAreas(patch);
    return { kind: intent.kind, expectedVersion: current.version, value: intent.value };
  }
  if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
  const current = ctx.runtime.contentStudioPlan.get();
  if (intent.kind === "contentStudio.idea.status") {
    const matches = (current.plan?.content ?? []).filter((idea) => idea.titel.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE"));
    if (matches.length === 0) throw validationFailed("Keine Idee mit diesem Titel gefunden.");
    if (matches.length !== 1) throw conflict("Mehrere Ideen haben diesen Titel. Bitte im Dashboard eindeutig auswaehlen.");
    return { kind: intent.kind, expectedRevision: current.revision, ideaId: matches[0]!.id, title: matches[0]!.titel, status: intent.status };
  }
  if ((current.plan?.content.length ?? 0) >= 1000) throw validationFailed("Der Content-Plan enthaelt bereits die maximale Zahl von 1000 Ideen.");
  const exportiert_am = current.plan?.exportiert_am ?? new Date(ctx.runtime.nowMs()).toISOString();
  const candidate = {
    version: 1 as const,
    exportiert_am,
    content: [...(current.plan?.content ?? []), {
      id: createId("idea"), titel: intent.title, plattform: "LinkedIn" as const, ziele: ["LinkedIn" as const],
      format: "Feed-Post" as const, beschreibung: "", zieldatum: "", status: "idee" as const,
    }],
    postings: current.plan?.postings ?? [],
  };
  const plan: ContentPlanDocument = parseStudioPlan(candidate);
  if (Buffer.byteLength(JSON.stringify(plan), "utf8") > 2_000_000) throw validationFailed("Der gespeicherte Plan ist zu gross fuer eine weitere Idee.");
  return { kind: intent.kind, expectedRevision: current.revision, idea: plan.content.at(-1)! };
}

function proposalText(action: NativeExecutableAction): string {
  if (action.kind === "settings.dashboard.compact")
    return `Dashboard-Kompaktansicht auf ${action.value ? "ein" : "aus"} setzen? Gespeicherte Revision ${action.expectedVersion}; Laufzeitwirkung wird nach dem Speichern nicht separat verifiziert.`;
  if (action.kind === "contentStudio.idea.add")
    return `Content-Idee „${action.idea.titel}“ hinzufuegen? Defaults: LinkedIn, Feed-Post, Status Idee. Planrevision ${action.expectedRevision}.`;
  if (action.kind === "contentStudio.idea.status")
    return `Status der Idee „${action.title}“ auf ${action.status} setzen? Planrevision ${action.expectedRevision}.`;
  throw conflict("Nicht unterstuetzte Einstellungen-/Content-Studio-Aktion.");
}

export async function executeSettingsContentMutation(ctx: RequestContext, request: CommandRequest,
  intent: SettingsContentMutationIntent): Promise<HandlerResult> {
  const ownerId = isOwner(ctx);
  if (intent.kind === "settings.dashboard.compact" && !authorize(ctx.principal!.role, "settings.update").allowed)
    throw forbidden("Einstellungen duerfen nur vom Owner geaendert werden.");
  if (intent.kind.startsWith("contentStudio.idea.") && ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true)
    throw forbidden("Content Studio ist deaktiviert.");

  let action: NativeExecutableAction;
  if (request.previewId) action = storedAction(ctx, ownerId, request, intent)!;
  else {
    if (request.confirm) throw validationFailed("Eine bestaetigte Vorschau fehlt.", [{ path: "previewId", message: "erforderlich" }]);
    action = makeAction(ctx, intent);
  }

  if (!request.confirm && request.previewId) {
    ctx.runtime.nativeApprovals.cancelDraft(ownerId, request.previewId, action);
    return baseResponse(ctx, "rejected", { result: { message: "Entwurf verworfen." } });
  }

  const requestKey = request.confirm ? request.previewId : ctx.correlationId;
  if (!requestKey) throw validationFailed("Eine Vorschaukennung fehlt.", [{ path: "previewId", message: "erforderlich" }]);
  const policy = request.confirm
    ? ctx.runtime.nativeApprovals.confirm(ownerId, requestKey, action)
    : ctx.runtime.nativeApprovals.propose({ ownerId, requestKey, correlationId: ctx.correlationId, riskTier: 1,
        type: "system_change", action: proposalText(action), rationale: "Owner-ausgeloeste lokale Aenderung mit Versionsschutz",
        preview: { kind: "text", title: action.kind === "settings.dashboard.compact" ? "Dashboard-Einstellung" : "Content-Idee", body: proposalText(action) },
        impacts: [], execution: action });

  if (!request.confirm) {
    return baseResponse(ctx, "requires_confirmation", { previewText: proposalText(action), previewId: requestKey });
  }
  if (policy.approval) return baseResponse(ctx, "requires_approval", { requiresConfirmation: false, approvalId: policy.approval.id,
    result: { message: "Die Aenderung wartet auf Freigabe.", targetRoute: `/approvals?approval=${policy.approval.id}` } });

  const revision = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, requestKey, async (saved, idempotencyKey) => {
    if (saved.kind === "settings.dashboard.compact") {
      const current = ctx.runtime.settings.get();
      if (current.version !== saved.expectedVersion) throw conflict("Einstellungen wurden inzwischen geaendert. Bitte neu laden.");
      const patch: SettingsPatch = { dashboard: { ...current.dashboard, compact: saved.value } };
      const result = await settingsHandlers.updateSettings!({ ...ctx, body: patch,
        mutation: { ...ctx.mutation, ifMatchVersion: saved.expectedVersion, idempotencyKey } });
      const version = (result.body as { data?: { version?: number } }).data?.version;
      if (typeof version !== "number") throw conflict("Settings wurden gespeichert, aber die neue Revision ist nicht lesbar.");
      return String(version);
    }
    if (saved.kind === "contentStudio.idea.add") {
      if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
      const current = ctx.runtime.contentStudioPlan.get();
      if (current.revision !== saved.expectedRevision) throw conflict("Der Plan wurde inzwischen geaendert. Bitte neu laden und die Idee erneut pruefen.");
      const candidate = {
        version: 1 as const,
        exportiert_am: current.plan?.exportiert_am ?? new Date(ctx.runtime.nowMs()).toISOString(),
        content: [...(current.plan?.content ?? []), saved.idea],
        postings: current.plan?.postings ?? [],
      };
      const plan: ContentPlanDocument = parseStudioPlan(candidate);
      const result = await contentStudioHandlers.putContentStudioPlan!({ ...ctx, body: plan,
        mutation: { ...ctx.mutation, ifMatchVersion: saved.expectedRevision, idempotencyKey } });
      const nextRevision = (result.body as { data?: { revision?: number } }).data?.revision;
      if (typeof nextRevision !== "number") throw conflict("Der Content-Plan wurde gespeichert, aber die neue Revision ist nicht lesbar.");
      return String(nextRevision);
    }
    if (saved.kind === "contentStudio.idea.status") {
      if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
      const current = ctx.runtime.contentStudioPlan.get();
      if (current.revision !== saved.expectedRevision) throw conflict("Der Plan wurde inzwischen geaendert. Bitte neu laden und die Aenderung erneut pruefen.");
      const ideas = current.plan?.content ?? [];
      if (!ideas.some((idea) => idea.id === saved.ideaId && idea.titel === saved.title)) throw conflict("Die ausgewaehlte Idee ist nicht mehr vorhanden.");
      const candidate = { version: 1 as const, exportiert_am: current.plan?.exportiert_am ?? new Date(ctx.runtime.nowMs()).toISOString(),
        content: ideas.map((idea) => idea.id === saved.ideaId ? { ...idea, status: saved.status } : idea),
        postings: current.plan?.postings ?? [] };
      const plan: ContentPlanDocument = parseStudioPlan(candidate);
      const result = await contentStudioHandlers.putContentStudioPlan!({ ...ctx, body: plan,
        mutation: { ...ctx.mutation, ifMatchVersion: saved.expectedRevision, idempotencyKey } });
      const nextRevision = (result.body as { data?: { revision?: number } }).data?.revision;
      if (typeof nextRevision !== "number") throw conflict("Der Content-Plan wurde aktualisiert, aber die neue Revision ist nicht lesbar.");
      return String(nextRevision);
    }
    throw conflict("Gespeicherte Aktion passt nicht zu diesem Mutationspfad.");
  });
  const message = action.kind === "settings.dashboard.compact"
    ? `Dashboard-Kompaktansicht gespeichert (Revision ${revision}). Laufzeitwirkung nicht separat verifiziert.`
    : action.kind === "contentStudio.idea.add"
      ? `Content-Idee „${action.idea.titel}“ gespeichert (Planrevision ${revision}).`
      : action.kind === "contentStudio.idea.status"
        ? `Status der Idee „${action.title}“ gespeichert (Planrevision ${revision}).`
      : (() => { throw conflict("Gespeicherte Aktion passt nicht zu diesem Mutationspfad."); })();
  return baseResponse(ctx, "executed", { requiresConfirmation: false, previewText: null, result: { message } });
}
