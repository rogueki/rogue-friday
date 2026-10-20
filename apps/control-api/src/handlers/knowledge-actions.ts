import { CONTRACT_VERSION, type ActionResult, type Approval, type FileItem, type FileRenameRequest, type Memory, type MemoryConflictResolveRequest, type MemoryCreateRequest, type MemoryUpdateRequest } from "@friday/sdk";
import type { MutationContext } from "@friday/adapter-core";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import type { Runtime } from "../runtime/types";
import type { NativeExecutableAction } from "../services/native-approval-requests";
import { ApiError, conflict, notFound, validationFailed } from "../util/errors";

const PREVIEW_ID = /^corr_[0-9A-Za-z]{26}$/;
/** Mirrors the files port: small temporary files are removed immediately, everything else needs the adapter's approval. */
const IMMEDIATE_DELETE = (file: { category: string; sizeBytes: number }): boolean =>
  file.category === "temporary" && file.sizeBytes < 10_000_000;

/** The staged delete action kind mirrors the port rule, so the receipt sentence matches what the adapter will do. */
export function fileDeleteAction(file: FileItem): NativeExecutableAction {
  return IMMEDIATE_DELETE(file)
    ? { kind: "file.delete", id: file.id, version: file.version, name: file.name }
    : { kind: "file.delete.gated", id: file.id, version: file.version, name: file.name };
}

const single = <T>(data: T) => ({ contractVersion: CONTRACT_VERSION, data,
  freshness: { state: "fresh" as const, asOf: new Date().toISOString() } });

export const memoryLabel = (memory: { title?: string | null; content: string }): string =>
  (memory.title ?? "").trim() || memory.content.slice(0, 60);

export type KnowledgeResult =
  | { kind: "memory"; operation: "create" | "update" | "resolve"; memory: Memory }
  | { kind: "memory.deleted"; outcome: ActionResult }
  | { kind: "file"; file: FileItem }
  | { kind: "file.deleted"; outcome: ActionResult }
  | { kind: "file.approval"; approval: Approval; approvalFreshness: { state: string; asOf: string | null } };

export interface KnowledgeDispatch {
  /** Stable receipt id: the memory/file id, the deletion audit event id or the adapter approval id. */
  receipt: string;
  result: KnowledgeResult;
}

/**
 * Runs one stored knowledge action against the ports with the pipeline's idempotency key. Shared by the direct API
 * handlers, the command path and the approval decision: every caller stages and confirms the identical action first.
 */
export async function dispatchKnowledgeAction(runtime: Runtime, action: NativeExecutableAction,
  call: MutationContext): Promise<KnowledgeDispatch> {
  const memory = runtime.registry.getPort("memory");
  const files = runtime.registry.getPort("files");
  switch (action.kind) {
    case "memory.create": {
      if (!memory.createMemory) throw new ApiError({ code: "CAPABILITY_MISSING",
        message: "Gedaechtniseintraege koennen derzeit nicht angelegt werden." });
      const created = await memory.createMemory({ body: action.body }, call);
      return { receipt: created.data.id, result: { kind: "memory", operation: "create", memory: created.data } };
    }
    case "memory.update": {
      if (!memory.updateMemory) throw new ApiError({ code: "CAPABILITY_MISSING",
        message: "Gedaechtniseintraege koennen derzeit nicht geaendert werden." });
      const updated = await memory.updateMemory({ id: action.id, body: action.body },
        { ...call, ifMatchVersion: action.version });
      return { receipt: updated.data.id, result: { kind: "memory", operation: "update", memory: updated.data } };
    }
    case "memory.delete": {
      if (!memory.deleteMemory) throw new ApiError({ code: "CAPABILITY_MISSING",
        message: "Gedaechtniseintraege koennen derzeit nicht vergessen werden." });
      const outcome = await memory.deleteMemory({ id: action.id }, { ...call, ifMatchVersion: action.version });
      return { receipt: outcome.auditEventId ?? action.id,
        result: { kind: "memory.deleted", outcome: { contractVersion: CONTRACT_VERSION, ...outcome } } };
    }
    case "memory.resolveConflict": {
      if (!memory.resolveMemoryConflict) throw new ApiError({ code: "CAPABILITY_MISSING",
        message: "Gedaechtniskonflikte koennen derzeit nicht geloest werden." });
      const resolved = await memory.resolveMemoryConflict({ id: action.id, conflictId: action.conflictId,
        body: action.body }, { ...call, ifMatchVersion: action.version });
      return { receipt: resolved.data.id, result: { kind: "memory", operation: "resolve", memory: resolved.data } };
    }
    case "file.rename": {
      if (!files.renameFile) throw new ApiError({ code: "CAPABILITY_MISSING",
        message: "Dateien koennen derzeit nicht umbenannt werden." });
      const renamed = await files.renameFile({ id: action.id, body: action.body },
        { ...call, ifMatchVersion: action.version });
      return { receipt: renamed.data.id, result: { kind: "file", file: renamed.data } };
    }
    case "file.delete":
    case "file.delete.gated": {
      if (!files.deleteFile) throw new ApiError({ code: "CAPABILITY_MISSING",
        message: "Dateien koennen derzeit nicht geloescht werden." });
      const outcome = await files.deleteFile({ id: action.id }, { ...call, ifMatchVersion: action.version });
      if (outcome.kind === "deleted") {
        return { receipt: outcome.auditEventId ?? action.id,
          result: { kind: "file.deleted", outcome: { contractVersion: CONTRACT_VERSION, ...outcome } } };
      }
      return { receipt: outcome.approval.data.id, result: { kind: "file.approval",
        approval: outcome.approval.data, approvalFreshness: outcome.approval.freshness } };
    }
  }
  throw conflict("Aktion ist nicht ausfuehrbar.");
}

export interface KnowledgeWrite {
  action: NativeExecutableAction;
  actionText: string;
  previewTitle: string;
  previewText: string;
}

/**
 * Stages the exact write as a draft, binds confirmation to the unchanged action and either hands it to the tier-2
 * approval flow or lets the caller execute it once. Throws for every non-executable stage.
 */
function enforceKnowledgeWrite(ctx: RequestContext, ownerId: string, subject: string,
  waitMessage: string, write: KnowledgeWrite): string {
  const confirmedPreviewId = ctx.headers["x-action-preview-id"];
  if (confirmedPreviewId !== undefined && !PREVIEW_ID.test(confirmedPreviewId)) {
    throw validationFailed("Die Vorschaukennung ist ungueltig.", [{ path: "X-Action-Preview-Id", message: "ungueltig" }]);
  }
  if (!confirmedPreviewId) {
    const previewId = ctx.correlationId;
    ctx.runtime.nativeApprovals.propose({ ownerId, requestKey: previewId, correlationId: ctx.correlationId,
      riskTier: 2, type: "system_change", action: write.actionText,
      rationale: `${subject} aus bestaetigter API-Anfrage`, preview: { kind: "text", title: write.previewTitle,
        body: JSON.stringify(write.action) }, impacts: [], execution: write.action });
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: `${subject} zuerst mit unveraenderter Vorschau bestaetigen.`,
      details: { stage: "preview", previewId, previewText: write.previewText } });
  }
  const policy = ctx.runtime.nativeApprovals.confirm(ownerId, confirmedPreviewId, write.action);
  if (policy.approval) {
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: waitMessage,
      details: { stage: "approval", approvalId: policy.approval.id,
        targetRoute: `/approvals?approval=${policy.approval.id}` } });
  }
  return confirmedPreviewId;
}

/** The write for a confirm-only repeat: the request body re-binds against the stored draft, so a tampered repeat mismatches. */
function confirmWrite(ctx: RequestContext, ownerId: string, previewId: string,
  expected: { kind: NativeExecutableAction["kind"]; id?: string }, body?: unknown): KnowledgeWrite {
  const stored = ctx.runtime.nativeApprovals.readAction(ownerId, previewId);
  if (!stored || stored.kind !== expected.kind ||
      (expected.id !== undefined && (!("id" in stored) || stored.id !== expected.id))) {
    throw conflict("Der Entwurf passt nicht zur Aktion.");
  }
  const action = body === undefined ? stored : { ...stored, body } as NativeExecutableAction;
  return { action, actionText: "", previewTitle: "", previewText: "" };
}

/** If-Match (when present) must match the live version before anything is staged; the draft then carries the version. */
function stagedVersion(ctx: RequestContext, current: { id: string; version: number }, kind: string): number {
  const header = ctx.mutation.ifMatchVersion;
  if (header !== undefined && header !== current.version) {
    throw conflict(`${kind} ${current.id} wurde zwischenzeitlich geändert (erwartet Version ${header}, aktuell ${current.version}).`,
      { expectedVersion: header, currentVersion: current.version, id: current.id });
  }
  return header ?? current.version;
}

/** The contract pattern of FileRenameRequest plus the port rules for dot/space-only names (fail before staging). */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is being rejected
const FILE_NAME = /^[^\\/<>:|"|?*\u0000-\u001f]{1,255}$/;
export function assertValidFileName(name: string): void {
  if (!FILE_NAME.test(name) || /^\.+$/.test(name) || /[. ]$/.test(name)) {
    throw validationFailed("Der Dateiname ist ungültig.",
      [{ path: "name", message: "darf keine Pfadtrenner oder reservierten Zeichen enthalten und nicht mit Punkt/Leerzeichen enden" }]);
  }
}

/** A name taken by a sibling in the same folder fails 409 before anything is staged (the port re-checks at dispatch). */
export async function assertRenameTargetFree(ctx: RequestContext, current: FileItem, name: string): Promise<void> {
  const taken = (await ctx.runtime.registry.getPort("files").listFiles({ limit: 200 }, ctx.call)).items
    .some((other) => other.id !== current.id && other.location === current.location &&
      other.name.toLowerCase() === name.toLowerCase());
  if (taken) {
    throw conflict(`Im Ordner existiert bereits eine Datei mit dem Namen „${name}“.`, { name, location: current.location });
  }
}

/** Mirrors the memory port: a locked entry refuses content changes unless the same request unlocks it. */
export function assertMemoryWritable(memory: Memory, body: MemoryUpdateRequest): void {
  const contentFields: Array<keyof MemoryUpdateRequest> =
    ["type", "content", "title", "confidence", "tags", "entities", "sensitivity", "expiresAt"];
  if (memory.locked && contentFields.some((field) => body[field] !== undefined) && body.locked !== false) {
    throw conflict("Dieser Eintrag ist gesperrt. Entsperren Sie ihn zuerst, um Inhalte zu ändern.", { locked: true });
  }
}

function stagedCall(ctx: RequestContext, idempotencyKey: string): MutationContext {
  return { ...ctx.mutation, idempotencyKey };
}

/** Direct API memory writes share the same saved draft, approval decision and port receipt as command writes. */
export const knowledgeActionHandlers: Partial<Record<OperationId, Handler>> = {
  async createMemory(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const port = ctx.runtime.registry.getPort("memory");
    if (!port.createMemory || !ctx.runtime.capabilities().modules.memory.write) {
      throw new ApiError({ code: "CAPABILITY_MISSING", message: "Gedaechtniseintraege koennen derzeit nicht angelegt werden." });
    }
    const body = ctx.body as MemoryCreateRequest;
    const write = ctx.headers["x-action-preview-id"]
      ? confirmWrite(ctx, ownerId, ctx.headers["x-action-preview-id"], { kind: "memory.create" }, body)
      : ((): KnowledgeWrite => {
          const label = memoryLabel({ title: body.title ?? null, content: body.content });
          return { action: { kind: "memory.create", body }, actionText: `Gedaechtniseintrag anlegen: ${label}`,
            previewTitle: "Neuer Gedaechtniseintrag", previewText: `Gedächtniseintrag „${label}“ anlegen?` };
        })();
    const previewId = enforceKnowledgeWrite(ctx, ownerId, "Gedaechtniseintrag",
      "Gedaechtniseintrag wartet auf Freigabe.", write);
    const memoryId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
      async (savedAction, idempotencyKey) =>
        (await dispatchKnowledgeAction(ctx.runtime, savedAction, stagedCall(ctx, idempotencyKey))).receipt);
    const memory = await port.getMemory({ id: memoryId }, ctx.call);
    ctx.audit.action = "memory.created";
    ctx.audit.after = { id: memoryId };
    return { status: 201, body: single(memory.data), headers: { Location: `/api/v1/memory/${memoryId}` } };
  },

  async updateMemory(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const port = ctx.runtime.registry.getPort("memory");
    if (!port.updateMemory || !ctx.runtime.capabilities().modules.memory.write) {
      throw new ApiError({ code: "CAPABILITY_MISSING", message: "Gedaechtniseintraege koennen derzeit nicht geaendert werden." });
    }
    const id = ctx.pathParams.id as string;
    const body = ctx.body as MemoryUpdateRequest;
    let write: KnowledgeWrite;
    if (ctx.headers["x-action-preview-id"]) {
      write = confirmWrite(ctx, ownerId, ctx.headers["x-action-preview-id"], { kind: "memory.update", id }, body);
    } else {
      // An unknown, stale or locked target fails before any preview is staged.
      const current = (await port.getMemory({ id }, ctx.call)).data;
      const version = stagedVersion(ctx, current, "Gedaechtniseintrag");
      assertMemoryWritable(current, body);
      const label = memoryLabel(current);
      write = { action: { kind: "memory.update", id, version, body },
        actionText: `Gedaechtniseintrag aktualisieren: ${label}`,
        previewTitle: "Gedaechtniseintrag aktualisieren", previewText: `Gedächtniseintrag „${label}“ aktualisieren?` };
    }
    const previewId = enforceKnowledgeWrite(ctx, ownerId, "Gedaechtniseintrag",
      "Gedaechtniseintrag wartet auf Freigabe.", write);
    const memoryId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
      async (savedAction, idempotencyKey) =>
        (await dispatchKnowledgeAction(ctx.runtime, savedAction, stagedCall(ctx, idempotencyKey))).receipt);
    const memory = await port.getMemory({ id: memoryId }, ctx.call);
    ctx.audit.action = "memory.updated";
    ctx.audit.after = { id: memoryId, version: memory.data.version };
    return { status: 200, body: single(memory.data) };
  },

  async deleteMemory(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const port = ctx.runtime.registry.getPort("memory");
    if (!port.deleteMemory || !ctx.runtime.capabilities().modules.memory.delete) {
      throw new ApiError({ code: "CAPABILITY_MISSING", message: "Gedaechtniseintraege koennen derzeit nicht vergessen werden." });
    }
    const id = ctx.pathParams.id as string;
    let write: KnowledgeWrite;
    if (ctx.headers["x-action-preview-id"]) {
      write = confirmWrite(ctx, ownerId, ctx.headers["x-action-preview-id"], { kind: "memory.delete", id });
    } else {
      // An unknown, stale or locked entry fails before any preview is staged.
      const current = (await port.getMemory({ id }, ctx.call)).data;
      const version = stagedVersion(ctx, current, "Gedaechtniseintrag");
      if (current.locked) throw conflict("Gesperrte Einträge können nicht gelöscht werden.", { locked: true });
      const label = memoryLabel(current);
      write = { action: { kind: "memory.delete", id, version, title: current.title ?? null },
        actionText: `Gedaechtniseintrag vergessen: ${label}`,
        previewTitle: "Gedaechtniseintrag vergessen",
        previewText: `Gedächtniseintrag „${label}“ vergessen? Die Löschung bleibt im Audit nachvollziehbar.` };
    }
    const previewId = enforceKnowledgeWrite(ctx, ownerId, "Gedaechtniseintrag",
      "Gedaechtniseintrag wartet auf Freigabe.", write);
    const forgotten: { outcome: ActionResult | null } = { outcome: null };
    const receipt = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
      async (savedAction, idempotencyKey) => {
        const dispatched = await dispatchKnowledgeAction(ctx.runtime, savedAction, stagedCall(ctx, idempotencyKey));
        if (dispatched.result.kind === "memory.deleted") forgotten.outcome = dispatched.result.outcome;
        return dispatched.receipt;
      });
    ctx.audit.action = "memory.deleted";
    ctx.audit.severity = "warning";
    if (forgotten.outcome) return { status: 200, body: forgotten.outcome };
    // A replayed confirmation after completion finds the entry gone; the stored draft still proves the exact action.
    const stored = ctx.runtime.nativeApprovals.readAction(ownerId, previewId);
    if (stored?.kind !== "memory.delete") throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
    ctx.audit.after = { id: stored.id, replayed: true };
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, accepted: true, status: "completed",
      correlationId: ctx.correlationId, resourceId: stored.id, auditEventId: receipt,
      message: "Eintrag wurde vergessen. Die Löschung bleibt im Audit nachvollziehbar." } };
  },

  async resolveMemoryConflict(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const port = ctx.runtime.registry.getPort("memory");
    if (!port.resolveMemoryConflict || !ctx.runtime.capabilities().modules.memory.resolveConflict) {
      throw new ApiError({ code: "CAPABILITY_MISSING", message: "Gedaechtniskonflikte koennen derzeit nicht geloest werden." });
    }
    const id = ctx.pathParams.id as string;
    const conflictId = ctx.pathParams.conflictId as string;
    const body = ctx.body as MemoryConflictResolveRequest;
    let write: KnowledgeWrite;
    if (ctx.headers["x-action-preview-id"]) {
      write = confirmWrite(ctx, ownerId, ctx.headers["x-action-preview-id"], { kind: "memory.resolveConflict", id }, body);
    } else {
      // Unknown memory or conflict, a stale version, an already resolved conflict and a locked replacement
      // all fail before any preview is staged, exactly like the port would at dispatch.
      const current = (await port.getMemory({ id }, ctx.call)).data;
      const version = stagedVersion(ctx, current, "Gedaechtniseintrag");
      const entry = current.conflicts.find((candidate) => candidate.memoryId === conflictId);
      if (!entry) throw notFound("Konflikt", `${id}/${conflictId}`);
      if (entry.resolution !== "pending") {
        throw conflict(`Der Konflikt ist bereits gelöst (${entry.resolution}).`, { resolution: entry.resolution });
      }
      if (body.resolution === "replace") {
        const other = (await port.getMemory({ id: conflictId }, ctx.call)).data;
        if (other.locked) {
          throw conflict("Der widersprechende Eintrag ist gesperrt und kann nicht ersetzt werden.", { locked: true, memoryId: conflictId });
        }
      }
      const label = memoryLabel(current);
      write = { action: { kind: "memory.resolveConflict", id, conflictId, version, body },
        actionText: `Gedaechtniskonflikt loesen: ${label}`,
        previewTitle: "Gedaechtniskonflikt loesen",
        previewText: `Konflikt von „${label}“ ${body.resolution === "replace" ? "durch Ersetzen des widersprechenden Eintrags"
          : body.resolution === "keep_both" ? "durch Beibehalten beider Einträge" : "als gegenstandslos"} lösen?` };
    }
    const previewId = enforceKnowledgeWrite(ctx, ownerId, "Gedaechtniseintrag",
      "Gedaechtniskonflikt wartet auf Freigabe.", write);
    const memoryId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
      async (savedAction, idempotencyKey) =>
        (await dispatchKnowledgeAction(ctx.runtime, savedAction, stagedCall(ctx, idempotencyKey))).receipt);
    const memory = await port.getMemory({ id: memoryId }, ctx.call);
    ctx.audit.action = "memory.conflict_resolved";
    ctx.audit.severity = body.resolution === "replace" ? "warning" : "info";
    ctx.audit.context = { conflictingMemoryId: conflictId, resolution: body.resolution };
    return { status: 200, body: single(memory.data) };
  },

  async renameFile(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const port = ctx.runtime.registry.getPort("files");
    if (!port.renameFile || !ctx.runtime.capabilities().modules.files.rename) {
      throw new ApiError({ code: "CAPABILITY_MISSING", message: "Dateien koennen derzeit nicht umbenannt werden." });
    }
    const id = ctx.pathParams.id as string;
    const body = ctx.body as FileRenameRequest;
    let write: KnowledgeWrite;
    if (ctx.headers["x-action-preview-id"]) {
      write = confirmWrite(ctx, ownerId, ctx.headers["x-action-preview-id"], { kind: "file.rename", id }, body);
      if (write.action.kind === "file.rename") ctx.audit.before = { name: write.action.previousName };
    } else {
      // An unknown or stale file fails before any preview is staged; a name taken in the same folder fails 409 here.
      assertValidFileName(body.name.trim());
      const current = (await port.getFile({ id }, ctx.call)).data;
      const version = stagedVersion(ctx, current, "Datei");
      await assertRenameTargetFree(ctx, current, body.name.trim());
      write = { action: { kind: "file.rename", id, version, body, previousName: current.name },
        actionText: `Datei umbenennen: ${current.name} -> ${body.name.trim()}`,
        previewTitle: "Datei umbenennen",
        previewText: `Datei „${current.name}“ in „${body.name.trim()}“ umbenennen?` };
      ctx.audit.before = { name: current.name };
    }
    const previewId = enforceKnowledgeWrite(ctx, ownerId, "Datei", "Datei-Umbenennung wartet auf Freigabe.", write);
    const fileId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
      async (savedAction, idempotencyKey) =>
        (await dispatchKnowledgeAction(ctx.runtime, savedAction, stagedCall(ctx, idempotencyKey))).receipt);
    const file = await port.getFile({ id: fileId }, ctx.call);
    ctx.audit.action = "file.renamed";
    ctx.audit.after = { name: file.data.name };
    return { status: 200, body: single(file.data) };
  },

  async deleteFile(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const port = ctx.runtime.registry.getPort("files");
    if (!port.deleteFile || !ctx.runtime.capabilities().modules.files.delete) {
      throw new ApiError({ code: "CAPABILITY_MISSING", message: "Dateien koennen derzeit nicht geloescht werden." });
    }
    const id = ctx.pathParams.id as string;
    let write: KnowledgeWrite;
    if (ctx.headers["x-action-preview-id"]) {
      const stored = ctx.runtime.nativeApprovals.readAction(ownerId, ctx.headers["x-action-preview-id"]);
      if (!stored || (stored.kind !== "file.delete" && stored.kind !== "file.delete.gated") || stored.id !== id) {
        throw conflict("Der Entwurf passt nicht zur Aktion.");
      }
      write = { action: stored, actionText: "", previewTitle: "", previewText: "" };
      ctx.audit.before = { name: stored.name };
    } else {
      // An unknown or stale file fails before any preview is staged.
      const current = (await port.getFile({ id }, ctx.call)).data;
      stagedVersion(ctx, current, "Datei");
      write = { action: fileDeleteAction(current),
        actionText: `Datei loeschen: ${current.name}`,
        previewTitle: "Datei loeschen",
        previewText: `Datei „${current.name}“ endgültig löschen? ${IMMEDIATE_DELETE(current)
          ? "Die Datei wird sofort entfernt." : "Das Löschen wird danach vom Datei-Adapter freigegeben."}` };
      ctx.audit.before = { name: current.name, category: current.category, sizeBytes: current.sizeBytes };
    }
    const previewId = enforceKnowledgeWrite(ctx, ownerId, "Datei", "Datei-Loeschung wartet auf Freigabe.", write);
    const gated: { current: Extract<KnowledgeResult, { kind: "file.approval" }> | null } = { current: null };
    const receipt = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
      async (savedAction, idempotencyKey) => {
        const dispatched = await dispatchKnowledgeAction(ctx.runtime, savedAction, stagedCall(ctx, idempotencyKey));
        if (dispatched.result.kind === "file.approval") gated.current = dispatched.result;
        return dispatched.receipt;
      });
    ctx.audit.action = "file.deleted";
    ctx.audit.severity = "warning";
    if (gated.current) {
      // The adapter gates the deletion: nothing is deleted yet, its own approval decides (202 like the plain port call).
      ctx.audit.after = { approvalId: gated.current.approval.id, deleted: false };
      return { status: 202, body: { contractVersion: CONTRACT_VERSION, data: gated.current.approval,
        freshness: gated.current.approvalFreshness } };
    }
    const stored = ctx.runtime.nativeApprovals.readAction(ownerId, previewId);
    if (stored?.kind === "file.delete.gated") {
      // Replay of a completed gated deletion: the adapter approval is the durable outcome.
      const reopened = await ctx.runtime.registry.getPort("approvals").getApproval({ id: receipt }, ctx.call);
      ctx.audit.after = { approvalId: receipt, deleted: false, replayed: true };
      return { status: 202, body: { contractVersion: CONTRACT_VERSION, data: reopened.data, freshness: reopened.freshness } };
    }
    if (stored?.kind !== "file.delete") throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
    ctx.audit.after = { id: stored.id, deleted: true, replayed: true };
    return { status: 200, body: { contractVersion: CONTRACT_VERSION, accepted: true, status: "completed",
      correlationId: ctx.correlationId, resourceId: stored.id, auditEventId: receipt,
      message: `Datei „${stored.name}“ wurde gelöscht.` } };
  },
};
