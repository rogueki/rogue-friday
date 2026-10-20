import { authorize } from "@friday/auth";
import { CONTRACT_VERSION, ideaTargets, parseStudioPlan, type CommandRequest, type CommandResponse, type ContentPlanDocument, type SettingsPatch, type Posting, type ContentFormat, type Platform } from "@friday/sdk";
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
  if (intent.kind === "settings.dashboard.refresh")
    return action.kind === intent.kind && action.value === intent.value;
  if (intent.kind === "contentStudio.idea.add")
    return action.kind === intent.kind && action.idea.titel === intent.title;
  if (intent.kind === "contentStudio.idea.status")
    return action.kind === intent.kind && action.title.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE")
      && action.status === intent.status;
  if (intent.kind === "contentStudio.idea.rename")
    return action.kind === intent.kind && action.title.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE")
      && action.newTitle === intent.newTitle;
  if (intent.kind === "contentStudio.idea.description")
    return action.kind === intent.kind && action.title.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE")
      && action.description === intent.description;
  if (intent.kind === "contentStudio.idea.date")
    return action.kind === intent.kind && action.title.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE")
      && action.date === intent.date;
  if (intent.kind === "contentStudio.idea.format")
    return action.kind === intent.kind && action.title.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE")
      && action.format === intent.format;
  if (intent.kind === "contentStudio.idea.targets")
    return action.kind === intent.kind && action.title.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE")
      && JSON.stringify(action.targets) === JSON.stringify(intent.targets);
  if (intent.kind === "contentStudio.idea.remove")
    return action.kind === intent.kind && action.title.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE");
  if (intent.kind === "contentStudio.posting.fromIdea")
    return action.kind === intent.kind && action.posting.titel.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE")
      && action.posting.datum === intent.date;
  if (intent.kind === "contentStudio.posting.create")
    return action.kind === intent.kind && action.posting.titel === intent.title && action.posting.datum === intent.date
      && action.posting.uhrzeit === intent.time && action.posting.plattform === intent.platform && action.posting.format === intent.format;
  if (intent.kind === "contentStudio.posting.status")
    return action.kind === intent.kind && action.title.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE")
      && action.date === intent.date && action.time === intent.time && action.status === intent.status;
  if (intent.kind === "contentStudio.posting.remove")
    return action.kind === intent.kind && action.title.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE")
      && action.date === intent.date && action.time === intent.time;
  return false;
}

function resolveUniqueIdea(ctx: RequestContext, title: string) {
  const current = ctx.runtime.contentStudioPlan.get();
  const matches = (current.plan?.content ?? []).filter((idea) => idea.titel.toLocaleLowerCase("de-DE") === title.toLocaleLowerCase("de-DE"));
  if (matches.length === 0) throw validationFailed("Keine Idee mit diesem Titel gefunden.");
  if (matches.length !== 1) throw conflict("Mehrere Ideen haben diesen Titel. Bitte im Dashboard eindeutig auswaehlen.");
  return { current, idea: matches[0]! };
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
  if (intent.kind === "settings.dashboard.refresh") {
    if (!authorize(ctx.principal!.role, "settings.update").allowed) throw forbidden("Einstellungen duerfen nur vom Owner geaendert werden.");
    const current = ctx.runtime.settings.get();
    const patch: SettingsPatch = { dashboard: { ...current.dashboard, autoRefreshSeconds: intent.value } };
    ctx.runtime.settings.validateAreas(patch);
    return { kind: intent.kind, expectedVersion: current.version, value: intent.value };
  }
  if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
  const current = ctx.runtime.contentStudioPlan.get();
  if (intent.kind === "contentStudio.idea.status") {
    const { idea } = resolveUniqueIdea(ctx, intent.title);
    return { kind: intent.kind, expectedRevision: current.revision, ideaId: idea.id, title: idea.titel, status: intent.status };
  }
  if (intent.kind === "contentStudio.idea.rename") {
    const { idea } = resolveUniqueIdea(ctx, intent.title);
    if ((current.plan?.content ?? []).some((entry) => entry.id !== idea.id && entry.titel.toLocaleLowerCase("de-DE") === intent.newTitle.toLocaleLowerCase("de-DE")))
      throw conflict("Eine andere Idee hat bereits diesen Titel. Bitte einen eindeutigen Titel waehlen.");
    return { kind: intent.kind, expectedRevision: current.revision, ideaId: idea.id, title: idea.titel, newTitle: intent.newTitle };
  }
  if (intent.kind === "contentStudio.idea.description") {
    const { idea } = resolveUniqueIdea(ctx, intent.title);
    return { kind: intent.kind, expectedRevision: current.revision, ideaId: idea.id, title: idea.titel, description: intent.description };
  }
  if (intent.kind === "contentStudio.idea.date" || intent.kind === "contentStudio.idea.format" || intent.kind === "contentStudio.idea.targets") {
    const { idea } = resolveUniqueIdea(ctx, intent.title);
    if (intent.kind === "contentStudio.idea.date")
      return { kind: intent.kind, expectedRevision: current.revision, ideaId: idea.id, title: idea.titel, date: intent.date };
    if (intent.kind === "contentStudio.idea.format")
      return { kind: intent.kind, expectedRevision: current.revision, ideaId: idea.id, title: idea.titel, format: intent.format as ContentFormat };
    return { kind: intent.kind, expectedRevision: current.revision, ideaId: idea.id, title: idea.titel, targets: intent.targets as Platform[] };
  }
  if (intent.kind === "contentStudio.idea.remove") {
    const { idea } = resolveUniqueIdea(ctx, intent.title);
    return { kind: intent.kind, expectedRevision: current.revision, ideaId: idea.id, title: idea.titel };
  }
  if (intent.kind === "contentStudio.posting.fromIdea") {
    const { idea } = resolveUniqueIdea(ctx, intent.title);
    const postings = current.plan?.postings ?? [];
    if (postings.length >= 1000) throw validationFailed("Der Content-Plan enthaelt bereits die maximale Zahl von 1000 Postings.");
    const targets = ideaTargets(idea);
    const posting: Posting = { id: createId("posting"), titel: idea.titel, datum: intent.date, uhrzeit: "09:00",
      plattform: targets[0]!, ziele: targets, format: idea.format, status: "geplant" };
    parseStudioPlan({ version: 1, exportiert_am: current.plan?.exportiert_am ?? new Date(ctx.runtime.nowMs()).toISOString(),
      content: current.plan?.content ?? [], postings: [...postings, posting] });
    return { kind: intent.kind, expectedRevision: current.revision, posting };
  }
  if (intent.kind === "contentStudio.posting.create") {
    const postings = current.plan?.postings ?? [];
    if (postings.length >= 1000) throw validationFailed("Der Content-Plan enthaelt bereits die maximale Zahl von 1000 Postings.");
    const posting: Posting = { id: createId("posting"), titel: intent.title, datum: intent.date, uhrzeit: intent.time,
      plattform: intent.platform as Platform, ziele: [intent.platform as Platform], format: intent.format as ContentFormat, status: "geplant" };
    parseStudioPlan({ version: 1, exportiert_am: current.plan?.exportiert_am ?? new Date(ctx.runtime.nowMs()).toISOString(),
      content: current.plan?.content ?? [], postings: [...postings, posting] });
    return { kind: intent.kind, expectedRevision: current.revision, posting };
  }
  if (intent.kind === "contentStudio.posting.status") {
    const matches = (current.plan?.postings ?? []).filter((posting) => posting.titel.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE")
      && posting.datum === intent.date && posting.uhrzeit === intent.time);
    if (matches.length === 0) throw validationFailed("Kein Posting mit diesem Titel und Zeitplan gefunden.");
    if (matches.length !== 1) throw conflict("Mehrere Postings passen zu Titel und Zeit. Bitte im Dashboard eindeutig auswaehlen.");
    return { kind: intent.kind, expectedRevision: current.revision, postingId: matches[0]!.id, title: matches[0]!.titel,
      date: intent.date, time: intent.time, status: intent.status };
  }
  if (intent.kind === "contentStudio.posting.remove") {
    const matches = (current.plan?.postings ?? []).filter((posting) => posting.titel.toLocaleLowerCase("de-DE") === intent.title.toLocaleLowerCase("de-DE")
      && posting.datum === intent.date && posting.uhrzeit === intent.time);
    if (matches.length === 0) throw validationFailed("Kein Posting mit diesem Titel und Zeitplan gefunden.");
    if (matches.length !== 1) throw conflict("Mehrere Postings passen zu Titel und Zeit. Bitte im Dashboard eindeutig auswaehlen.");
    return { kind: intent.kind, expectedRevision: current.revision, postingId: matches[0]!.id, title: matches[0]!.titel,
      date: intent.date, time: intent.time };
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
  if (action.kind === "settings.dashboard.refresh")
    return `Dashboard-Aktualisierungsintervall auf ${action.value} Sekunden setzen? Gespeicherte Revision ${action.expectedVersion}; Laufzeitwirkung wird nach dem Speichern nicht separat verifiziert.`;
  if (action.kind === "contentStudio.idea.add")
    return `Content-Idee „${action.idea.titel}“ hinzufuegen? Defaults: LinkedIn, Feed-Post, Status Idee. Planrevision ${action.expectedRevision}.`;
  if (action.kind === "contentStudio.idea.status")
    return `Status der Idee „${action.title}“ auf ${action.status} setzen? Planrevision ${action.expectedRevision}.`;
  if (action.kind === "contentStudio.idea.rename")
    return `Idee „${action.title}“ in „${action.newTitle}“ umbenennen? Planrevision ${action.expectedRevision}.`;
  if (action.kind === "contentStudio.idea.description")
    return `Beschreibung der Idee „${action.title}“ auf „${action.description}“ setzen? Planrevision ${action.expectedRevision}.`;
  if (action.kind === "contentStudio.idea.date")
    return `Zieldatum der Idee „${action.title}“ auf ${action.date || "kein Datum"} setzen? Planrevision ${action.expectedRevision}.`;
  if (action.kind === "contentStudio.idea.format")
    return `Format der Idee „${action.title}“ auf ${action.format} setzen? Planrevision ${action.expectedRevision}.`;
  if (action.kind === "contentStudio.idea.targets")
    return `Zielplattformen der Idee „${action.title}“ auf ${action.targets.join(" + ")} setzen? Planrevision ${action.expectedRevision}.`;
  if (action.kind === "contentStudio.idea.remove")
    return `Idee „${action.title}“ aus dem Content-Plan entfernen? Zugehoerige Postings bleiben bestehen. Planrevision ${action.expectedRevision}.`;
  if (action.kind === "contentStudio.posting.fromIdea")
    return `Posting „${action.posting.titel}“ fuer ${action.posting.datum} um 09:00 einplanen? Plattform: ${action.posting.ziele?.join(" + ") ?? action.posting.plattform}. Planrevision ${action.expectedRevision}.`;
  if (action.kind === "contentStudio.posting.create")
    return `Posting „${action.posting.titel}“ fuer ${action.posting.datum} um ${action.posting.uhrzeit} auf ${action.posting.plattform} als ${action.posting.format} einplanen? Planrevision ${action.expectedRevision}.`;
  if (action.kind === "contentStudio.posting.status")
    return `Status des Postings „${action.title}“ vom ${action.date} um ${action.time} auf ${action.status} setzen? Planrevision ${action.expectedRevision}.`;
  if (action.kind === "contentStudio.posting.remove")
    return `Posting „${action.title}“ vom ${action.date} um ${action.time} entfernen? Planrevision ${action.expectedRevision}.`;
  throw conflict("Nicht unterstuetzte Einstellungen-/Content-Studio-Aktion.");
}

export async function executeSettingsContentMutation(ctx: RequestContext, request: CommandRequest,
  intent: SettingsContentMutationIntent): Promise<HandlerResult> {
  const ownerId = isOwner(ctx);
  if (intent.kind.startsWith("settings.") && !authorize(ctx.principal!.role, "settings.update").allowed)
    throw forbidden("Einstellungen duerfen nur vom Owner geaendert werden.");
  if (intent.kind.startsWith("contentStudio.") && ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true)
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
    if (saved.kind === "settings.dashboard.compact" || saved.kind === "settings.dashboard.refresh") {
      const current = ctx.runtime.settings.get();
      if (current.version !== saved.expectedVersion) throw conflict("Einstellungen wurden inzwischen geaendert. Bitte neu laden.");
      const patch: SettingsPatch = saved.kind === "settings.dashboard.compact"
        ? { dashboard: { ...current.dashboard, compact: saved.value } }
        : { dashboard: { ...current.dashboard, autoRefreshSeconds: saved.value } };
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
    if (saved.kind === "contentStudio.idea.rename" || saved.kind === "contentStudio.idea.description"
      || saved.kind === "contentStudio.idea.date" || saved.kind === "contentStudio.idea.format" || saved.kind === "contentStudio.idea.targets") {
      if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
      const current = ctx.runtime.contentStudioPlan.get();
      if (current.revision !== saved.expectedRevision) throw conflict("Der Plan wurde inzwischen geaendert. Bitte neu laden und die Aenderung erneut pruefen.");
      const ideas = current.plan?.content ?? [];
      const target = ideas.find((idea) => idea.id === saved.ideaId && idea.titel === saved.title);
      if (!target) throw conflict("Die ausgewaehlte Idee ist nicht mehr vorhanden.");
      const content = ideas.map((idea) => {
        if (idea.id !== saved.ideaId) return idea;
        if (saved.kind === "contentStudio.idea.rename") return { ...idea, titel: saved.newTitle };
        if (saved.kind === "contentStudio.idea.description") return { ...idea, beschreibung: saved.description };
        if (saved.kind === "contentStudio.idea.date") return { ...idea, zieldatum: saved.date };
        if (saved.kind === "contentStudio.idea.format") return { ...idea, format: saved.format };
        return { ...idea, plattform: saved.targets[0]!, ziele: saved.targets };
      });
      const plan: ContentPlanDocument = parseStudioPlan({ version: 1 as const,
        exportiert_am: current.plan?.exportiert_am ?? new Date(ctx.runtime.nowMs()).toISOString(), content,
        postings: current.plan?.postings ?? [] });
      const result = await contentStudioHandlers.putContentStudioPlan!({ ...ctx, body: plan,
        mutation: { ...ctx.mutation, ifMatchVersion: saved.expectedRevision, idempotencyKey } });
      const nextRevision = (result.body as { data?: { revision?: number } }).data?.revision;
      if (typeof nextRevision !== "number") throw conflict("Die Idee wurde gespeichert, aber die neue Revision ist nicht lesbar.");
      return String(nextRevision);
    }
    if (saved.kind === "contentStudio.idea.remove") {
      if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
      const current = ctx.runtime.contentStudioPlan.get();
      if (current.revision !== saved.expectedRevision) throw conflict("Der Plan wurde inzwischen geaendert. Bitte neu laden und die Entfernung erneut pruefen.");
      const ideas = current.plan?.content ?? [];
      if (!ideas.some((idea) => idea.id === saved.ideaId && idea.titel === saved.title)) throw conflict("Die ausgewaehlte Idee ist nicht mehr vorhanden.");
      const plan: ContentPlanDocument = parseStudioPlan({ version: 1 as const,
        exportiert_am: current.plan?.exportiert_am ?? new Date(ctx.runtime.nowMs()).toISOString(),
        content: ideas.filter((idea) => idea.id !== saved.ideaId), postings: current.plan?.postings ?? [] });
      const result = await contentStudioHandlers.putContentStudioPlan!({ ...ctx, body: plan,
        mutation: { ...ctx.mutation, ifMatchVersion: saved.expectedRevision, idempotencyKey } });
      const nextRevision = (result.body as { data?: { revision?: number } }).data?.revision;
      if (typeof nextRevision !== "number") throw conflict("Die Idee wurde entfernt, aber die neue Revision ist nicht lesbar.");
      return String(nextRevision);
    }
    if (saved.kind === "contentStudio.posting.fromIdea" || saved.kind === "contentStudio.posting.create") {
      if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
      const current = ctx.runtime.contentStudioPlan.get();
      if (current.revision !== saved.expectedRevision) throw conflict("Der Plan wurde inzwischen geaendert. Bitte neu laden und das Posting erneut pruefen.");
      const plan: ContentPlanDocument = parseStudioPlan({ version: 1 as const,
        exportiert_am: current.plan?.exportiert_am ?? new Date(ctx.runtime.nowMs()).toISOString(),
        content: current.plan?.content ?? [], postings: [...(current.plan?.postings ?? []), saved.posting] });
      const result = await contentStudioHandlers.putContentStudioPlan!({ ...ctx, body: plan,
        mutation: { ...ctx.mutation, ifMatchVersion: saved.expectedRevision, idempotencyKey } });
      const nextRevision = (result.body as { data?: { revision?: number } }).data?.revision;
      if (typeof nextRevision !== "number") throw conflict("Das Posting wurde gespeichert, aber die neue Revision ist nicht lesbar.");
      return String(nextRevision);
    }
    if (saved.kind === "contentStudio.posting.status") {
      if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
      const current = ctx.runtime.contentStudioPlan.get();
      if (current.revision !== saved.expectedRevision) throw conflict("Der Plan wurde inzwischen geaendert. Bitte neu laden und die Aenderung erneut pruefen.");
      const postings = current.plan?.postings ?? [];
      if (!postings.some((posting) => posting.id === saved.postingId && posting.titel === saved.title
        && posting.datum === saved.date && posting.uhrzeit === saved.time)) throw conflict("Das ausgewaehlte Posting ist nicht mehr vorhanden.");
      const plan: ContentPlanDocument = parseStudioPlan({ version: 1 as const,
        exportiert_am: current.plan?.exportiert_am ?? new Date(ctx.runtime.nowMs()).toISOString(),
        content: current.plan?.content ?? [],
        postings: postings.map((posting) => posting.id === saved.postingId ? { ...posting, status: saved.status } : posting) });
      const result = await contentStudioHandlers.putContentStudioPlan!({ ...ctx, body: plan,
        mutation: { ...ctx.mutation, ifMatchVersion: saved.expectedRevision, idempotencyKey } });
      const nextRevision = (result.body as { data?: { revision?: number } }).data?.revision;
      if (typeof nextRevision !== "number") throw conflict("Der Postingstatus wurde gespeichert, aber die neue Revision ist nicht lesbar.");
      return String(nextRevision);
    }
    if (saved.kind === "contentStudio.posting.remove") {
      if (ctx.runtime.settings.area("dashboard").contentStudioEnabled !== true) throw forbidden("Content Studio ist deaktiviert.");
      const current = ctx.runtime.contentStudioPlan.get();
      if (current.revision !== saved.expectedRevision) throw conflict("Der Plan wurde inzwischen geaendert. Bitte neu laden und die Entfernung erneut pruefen.");
      const postings = current.plan?.postings ?? [];
      if (!postings.some((posting) => posting.id === saved.postingId && posting.titel === saved.title
        && posting.datum === saved.date && posting.uhrzeit === saved.time)) throw conflict("Das ausgewaehlte Posting ist nicht mehr vorhanden.");
      const plan: ContentPlanDocument = parseStudioPlan({ version: 1 as const,
        exportiert_am: current.plan?.exportiert_am ?? new Date(ctx.runtime.nowMs()).toISOString(),
        content: current.plan?.content ?? [], postings: postings.filter((posting) => posting.id !== saved.postingId) });
      const result = await contentStudioHandlers.putContentStudioPlan!({ ...ctx, body: plan,
        mutation: { ...ctx.mutation, ifMatchVersion: saved.expectedRevision, idempotencyKey } });
      const nextRevision = (result.body as { data?: { revision?: number } }).data?.revision;
      if (typeof nextRevision !== "number") throw conflict("Das Posting wurde entfernt, aber die neue Revision ist nicht lesbar.");
      return String(nextRevision);
    }
    throw conflict("Gespeicherte Aktion passt nicht zu diesem Mutationspfad.");
  });
  const message = action.kind === "settings.dashboard.compact"
    ? `Dashboard-Kompaktansicht gespeichert (Revision ${revision}). Laufzeitwirkung nicht separat verifiziert.`
    : action.kind === "settings.dashboard.refresh"
      ? `Dashboard-Aktualisierungsintervall gespeichert (Revision ${revision}). Laufzeitwirkung nicht separat verifiziert.`
    : action.kind === "contentStudio.idea.add"
      ? `Content-Idee „${action.idea.titel}“ gespeichert (Planrevision ${revision}).`
      : action.kind === "contentStudio.idea.status"
        ? `Status der Idee „${action.title}“ gespeichert (Planrevision ${revision}).`
      : action.kind === "contentStudio.idea.rename"
        ? `Idee „${action.title}“ in „${action.newTitle}“ umbenannt (Planrevision ${revision}).`
      : action.kind === "contentStudio.idea.description"
        ? `Beschreibung der Idee „${action.title}“ gespeichert (Planrevision ${revision}).`
      : action.kind === "contentStudio.idea.date"
        ? `Zieldatum der Idee „${action.title}“ gespeichert (Planrevision ${revision}).`
      : action.kind === "contentStudio.idea.format"
        ? `Format der Idee „${action.title}“ gespeichert (Planrevision ${revision}).`
      : action.kind === "contentStudio.idea.targets"
        ? `Zielplattformen der Idee „${action.title}“ gespeichert (Planrevision ${revision}).`
      : action.kind === "contentStudio.idea.remove"
        ? `Idee „${action.title}“ entfernt (Planrevision ${revision}).`
      : action.kind === "contentStudio.posting.fromIdea"
        ? `Posting „${action.posting.titel}“ fuer ${action.posting.datum} eingeplant (Planrevision ${revision}).`
      : action.kind === "contentStudio.posting.create"
        ? `Posting „${action.posting.titel}“ fuer ${action.posting.datum} eingeplant (Planrevision ${revision}).`
      : action.kind === "contentStudio.posting.status"
        ? `Status des Postings „${action.title}“ gespeichert (Planrevision ${revision}).`
      : action.kind === "contentStudio.posting.remove"
        ? `Posting „${action.title}“ entfernt (Planrevision ${revision}).`
      : (() => { throw conflict("Gespeicherte Aktion passt nicht zu diesem Mutationspfad."); })();
  return baseResponse(ctx, "executed", { requiresConfirmation: false, previewText: null, result: { message } });
}
