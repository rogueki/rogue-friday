import {
  CONTRACT_VERSION,
  type CommandRequest,
  type CommandResponse,
  type ResearchCreateRequest,
} from "@friday/sdk";
import { createId } from "@friday/observability";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { NativeExecutableAction } from "../services/native-approval-requests";
import { ApiError, conflict, validationFailed } from "../util/errors";
import { LOCAL_RESEARCH_ENDPOINT } from "../services/research-setup";
import { stableUserId } from "../security/auth-service";

const PREVIEW_ID = /^corr_[0-9A-Za-z]{26}$/;
const freshness = () => ({ state: "fresh" as const, asOf: new Date().toISOString() });
const single = (data: unknown) => ({ contractVersion: CONTRACT_VERSION, data, freshness: freshness() });
const list = (
  items: unknown[],
  pageInfo = { nextCursor: null as string | null, hasNextPage: false, totalCount: items.length },
) => ({
  contractVersion: CONTRACT_VERSION,
  items,
  pageInfo,
  freshness: freshness(),
  sources: items.length
    ? [{ adapterId: "local-searxng", system: "searxng", lastSyncedAt: new Date().toISOString() }]
    : [],
});

export const researchActionHandlers: Partial<Record<OperationId, Handler>> = {
  async getResearchProvider(ctx) {
    const setup = await ctx.runtime.researchSetup.status();
    return { status: 200, body: single({ ...ctx.runtime.research.configuration(), setup }) };
  },
  async updateResearchProvider(ctx) {
    const body = ctx.body as { endpoint: string; installLocal?: boolean };
    const version = ctx.mutation.ifMatchVersion;
    if (version === undefined) throw validationFailed("If-Match-Version fuer den Suchprovider fehlt.");
    if (body.installLocal) {
      if (body.endpoint !== LOCAL_RESEARCH_ENDPOINT)
        throw validationFailed("Die lokale Einrichtung erlaubt nur den festen Friday-Suchdienst-Endpunkt.");
      if (ctx.runtime.research.configuration().version !== version)
        throw conflict("Suchprovider wurde zwischenzeitlich geaendert.");
      await ctx.runtime.researchSetup.install();
    }
    const config = ctx.runtime.research.configure(body.endpoint, version);
    const setup = await ctx.runtime.researchSetup.status();
    ctx.audit.action = "research.provider_configured";
    ctx.audit.after = { provider: config.provider, configured: config.configured, localSetup: setup.state };
    return { status: 200, body: single({ ...config, setup }) };
  },
  async createResearchProject(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const body = ctx.body as ResearchCreateRequest;
    const topic = body.topic.trim();
    if (topic.length < 3 || topic.length > 500)
      throw validationFailed("Recherchethema muss 3 bis 500 Zeichen lang sein.");
    const previewId = ctx.headers["x-action-preview-id"];
    if (previewId !== undefined && !PREVIEW_ID.test(previewId))
      throw validationFailed("Die Vorschaukennung ist ungueltig.");
    if (!previewId) ctx.runtime.research.assertConfigured();
    const providerVersion = previewId
      ? (() => {
          const stored = ctx.runtime.nativeApprovals.readAction(ownerId, previewId);
          if (!stored || stored.kind !== "research.create")
            throw conflict("Der Entwurf passt nicht zur Recherche.");
          return stored.providerVersion;
        })()
      : ctx.runtime.research.configuration().version;
    const action: NativeExecutableAction = { kind: "research.create", body: { topic }, providerVersion };
    if (!previewId) {
      ctx.runtime.nativeApprovals.propose({
        ownerId,
        requestKey: ctx.correlationId,
        correlationId: ctx.correlationId,
        riskTier: 2,
        type: "system_change",
        action: `Recherche suchen: ${topic}`,
        rationale: "Suchanfrage aus bestaetigter API-Anfrage",
        preview: { kind: "text", title: "Recherche starten", body: JSON.stringify(action) },
        impacts: [],
        execution: action,
      });
      throw new ApiError({
        code: "APPROVAL_REQUIRED",
        message: "Recherche zuerst bestaetigen.",
        details: {
          stage: "preview",
          previewId: ctx.correlationId,
          previewText: `Das Thema „${topic}“ an ${ctx.runtime.research.configuration().provider === "wikipedia" ? "Wikipedia" : "den lokalen SearXNG-Dienst"} senden, bis zu zehn Treffer und drei Seiten speichern und bei eingerichtetem Hermes-Modell einen Syntheseversuch mit maximal 700 Ausgabetokens starten? Ein Modellaufruf kann Kosten verursachen; Belege bleiben unverifiziert. Keine automatische Wiederholung.`,
        },
      });
    }
    const policy = ctx.runtime.nativeApprovals.confirm(ownerId, previewId, action);
    if (policy.approval)
      throw new ApiError({
        code: "APPROVAL_REQUIRED",
        message: "Recherche wartet auf Freigabe.",
        details: {
          stage: "approval",
          approvalId: policy.approval.id,
          targetRoute: `/approvals?approval=${policy.approval.id}`,
        },
      });
    const id = await ctx.runtime.nativeApprovals.executeWithoutApproval(
      ownerId,
      previewId,
      async (saved, key) => {
        if (saved.kind !== "research.create")
          throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
        return (await ctx.runtime.research.create(ownerId, saved.body.topic, key, saved.providerVersion)).id;
      },
    );
    const project = ctx.runtime.research.get(ownerId, id);
    ctx.audit.action = "research.source_discovery_started";
    ctx.audit.after = { id, status: project.status, sourceCount: project.sourceCount };
    return { status: 201, body: single(project), headers: { Location: `/api/v1/research/projects/${id}` } };
  },
};

export async function executeResearchCommand(
  ctx: Parameters<Handler>[0],
  request: CommandRequest,
  topic: string,
): Promise<Awaited<ReturnType<Handler>>> {
  const ownerId = ctx.voiceBridgeAuthorized ? stableUserId("owner") : ctx.principal?.userId;
  if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
  const key = request.confirm ? request.previewId : ctx.correlationId;
  if (!key) throw validationFailed("Eine bestaetigte Vorschau fehlt.");
  if (!request.confirm && !request.previewId) ctx.runtime.research.assertConfigured();
  const providerVersion =
    request.confirm || request.previewId
      ? (() => {
          const stored = ctx.runtime.nativeApprovals.readAction(ownerId, request.previewId ?? key);
          if (!stored || stored.kind !== "research.create")
            throw conflict("Der Entwurf passt nicht zur Recherche.");
          return stored.providerVersion;
        })()
      : ctx.runtime.research.configuration().version;
  const action: NativeExecutableAction = { kind: "research.create", body: { topic }, providerVersion };
  const base = {
    contractVersion: CONTRACT_VERSION,
    commandId: createId("cmd"),
    correlationId: ctx.correlationId,
    riskTier: 2 as const,
  };
  if (!request.confirm && request.previewId) {
    ctx.runtime.nativeApprovals.cancelDraft(ownerId, request.previewId, action);
    return {
      status: 200,
      body: {
        ...base,
        status: "rejected",
        requiresConfirmation: false,
        previewText: null,
        approvalId: null,
        result: { message: "Entwurf verworfen." },
      } satisfies CommandResponse,
    };
  }
  const policy = request.confirm
    ? ctx.runtime.nativeApprovals.confirm(ownerId, key, action)
    : ctx.runtime.nativeApprovals.propose({
        ownerId,
        requestKey: key,
        correlationId: ctx.correlationId,
        riskTier: 2,
        type: "system_change",
        action: `Recherche suchen: ${topic}`,
        rationale: "Recherche aus bestaetigtem Sprach-/Textbefehl",
        preview: { kind: "text", title: "Recherche starten", body: JSON.stringify(action) },
        impacts: [],
        execution: action,
      });
  if (!request.confirm)
    return {
      status: 200,
      body: {
        ...base,
        status: "requires_confirmation",
        requiresConfirmation: true,
        previewId: key,
        previewText: `„${topic}“ bei ${ctx.runtime.research.configuration().provider === "wikipedia" ? "Wikipedia" : "SearXNG"} suchen, bis zu zehn Treffer und drei Seiten speichern und bei eingerichtetem Hermes-Modell einen Syntheseversuch mit maximal 700 Ausgabetokens starten? Ein Modellaufruf kann Kosten verursachen; Belege bleiben unverifiziert. Keine automatische Wiederholung.`,
        approvalId: null,
        result: null,
      } satisfies CommandResponse,
    };
  if (policy.approval)
    return {
      status: 200,
      body: {
        ...base,
        status: "requires_approval",
        requiresConfirmation: false,
        previewText: null,
        approvalId: policy.approval.id,
        result: {
          message: "Recherche wartet auf Freigabe.",
          targetRoute: `/approvals?approval=${policy.approval.id}`,
        },
      } satisfies CommandResponse,
    };
  const id = await ctx.runtime.nativeApprovals.executeWithoutApproval(
    ownerId,
    key,
    async (saved, requestKey) => {
      if (saved.kind !== "research.create")
        throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
      return (await ctx.runtime.research.create(ownerId, saved.body.topic, requestKey, saved.providerVersion))
        .id;
    },
  );
  const project = ctx.runtime.research.get(ownerId, id);
  return {
    status: 200,
    body: {
      ...base,
      status: project.status === "failed" ? "failed" : "executed",
      requiresConfirmation: false,
      previewText: null,
      approvalId: null,
      result: {
        message:
          project.status === "failed"
            ? "Die Suche ist fehlgeschlagen. Es wurden keine Quellen bestaetigt."
            : `${project.sourceCount} unverifizierte Suchtreffer gespeichert. Quellen bitte pruefen.`,
        targetRoute: `/research?project=${project.id}`,
      },
    } satisfies CommandResponse,
  };
}

export function researchReads(base: Map<OperationId, Handler>): Partial<Record<OperationId, Handler>> {
  const original = new Map<OperationId, Handler>(base);
  const fallback = (operationId: OperationId, ctx: Parameters<Handler>[0]) => original.get(operationId)!(ctx);
  return {
    async listResearchProjects(ctx) {
      if (ctx.runtime.config.dataMode === "mock") return fallback("listResearchProjects", ctx);
      const ownerId = ctx.principal?.userId;
      if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
      const cursor = ctx.query.cursor;
      if (cursor && !/^offset:[0-9]+$/.test(String(cursor)))
        throw validationFailed("Ungueltiger Recherche-Cursor.");
      const offset = cursor ? Number(String(cursor).slice(7)) : 0;
      if (!Number.isSafeInteger(offset) || offset > 1_000_000)
        throw validationFailed("Ungueltiger Recherche-Cursor.");
      const limit = Math.min(Math.max(Number(ctx.query.limit ?? 50), 1), 200);
      const totalCount = ctx.runtime.research.count(ownerId, ctx.query.q as string | undefined);
      const items = ctx.runtime.research.list(ownerId, ctx.query.q as string | undefined, limit, offset);
      return {
        status: 200,
        body: list(items, {
          nextCursor: offset + items.length < totalCount ? `offset:${offset + items.length}` : null,
          hasNextPage: offset + items.length < totalCount,
          totalCount,
        }),
      };
    },
    async getResearchProject(ctx) {
      if (ctx.runtime.config.dataMode === "mock") return fallback("getResearchProject", ctx);
      const ownerId = ctx.principal?.userId;
      if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
      return { status: 200, body: single(ctx.runtime.research.get(ownerId, ctx.pathParams.id!)) };
    },
    async listResearchSources(ctx) {
      if (ctx.runtime.config.dataMode === "mock") return fallback("listResearchSources", ctx);
      const ownerId = ctx.principal?.userId;
      if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
      if (ctx.query.cursor) throw validationFailed("Recherche-Cursor wird derzeit nicht unterstuetzt.");
      return {
        status: 200,
        body: list(ctx.runtime.research.sources(ownerId, ctx.pathParams.id!, Number(ctx.query.limit ?? 200))),
      };
    },
    async listResearchFindings(ctx) {
      if (ctx.runtime.config.dataMode === "mock") return fallback("listResearchFindings", ctx);
      const ownerId = ctx.principal?.userId;
      if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
      if (ctx.query.cursor) throw validationFailed("Recherche-Cursor wird derzeit nicht unterstuetzt.");
      return {
        status: 200,
        body: list(
          ctx.runtime.research.findings(ownerId, ctx.pathParams.id!, Number(ctx.query.limit ?? 200)),
        ),
      };
    },
    async listResearchArtifacts(ctx) {
      if (ctx.runtime.config.dataMode === "mock") return fallback("listResearchArtifacts", ctx);
      const ownerId = ctx.principal?.userId;
      if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
      ctx.runtime.research.get(ownerId, ctx.pathParams.id!);
      return { status: 200, body: list([]) };
    },
  };
}
