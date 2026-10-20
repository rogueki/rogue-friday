import { CONTRACT_VERSION, type TaskActionRequest, type TaskCreateRequest, type TaskResponse, type TaskUpdateRequest } from "@friday/sdk";
import type { Handler, RequestContext } from "../http/context";
import type { OperationId } from "../http/route-types";
import { ApiError, conflict, validationFailed } from "../util/errors";
import type { NativeExecutableAction } from "../services/native-approval-requests";

const PREVIEW_ID = /^corr_[0-9A-Za-z]{26}$/;
const CANCEL_FINAL = ["done", "failed", "cancelled"];

interface TaskWrite {
  capability: "create" | "update" | "cancel";
  unavailable: string;
  action: NativeExecutableAction;
  actionText: string;
  previewTitle: string;
  previewText: string;
}

/** The port method must exist and the capability module must offer the flag before anything is staged. */
function checkCapability(ctx: RequestContext, write: TaskWrite): void {
  const tasks = ctx.runtime.registry.getPort("tasks");
  const method = write.capability === "create" ? tasks.createTask : write.capability === "update" ? tasks.updateTask : tasks.cancelTask;
  if (!method || !ctx.runtime.capabilities().modules.tasks[write.capability]) {
    throw new ApiError({ code: "CAPABILITY_MISSING", message: write.unavailable,
      details: { capability: `tasks.${write.capability}` } });
  }
}

/**
 * Stages the exact write as a draft, binds confirmation to the unchanged action and either hands it to the tier-2
 * approval flow or lets the caller execute it once with a saved receipt. Throws for every non-executable stage.
 */
function enforceTaskWrite(ctx: RequestContext, ownerId: string, write: TaskWrite): string {
  const confirmedPreviewId = ctx.headers["x-action-preview-id"];
  if (confirmedPreviewId !== undefined && !PREVIEW_ID.test(confirmedPreviewId)) {
    throw validationFailed("Die Vorschaukennung ist ungueltig.", [{ path: "X-Action-Preview-Id", message: "ungueltig" }]);
  }
  if (!confirmedPreviewId) {
    const previewId = ctx.correlationId;
    ctx.runtime.nativeApprovals.propose({ ownerId, requestKey: previewId, correlationId: ctx.correlationId,
      riskTier: 2, type: "system_change", action: write.actionText,
      rationale: "Aufgabe aus bestaetigter API-Anfrage", preview: { kind: "text", title: write.previewTitle,
        body: JSON.stringify(write.action) }, impacts: [], execution: write.action });
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Aufgabe zuerst mit unveraenderter Vorschau bestaetigen.",
      details: { stage: "preview", previewId, previewText: write.previewText } });
  }
  const policy = ctx.runtime.nativeApprovals.confirm(ownerId, confirmedPreviewId, write.action);
  if (policy.approval) {
    throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Aufgabe wartet auf Freigabe.",
      details: { stage: "approval", approvalId: policy.approval.id,
        targetRoute: `/approvals?approval=${policy.approval.id}` } });
  }
  return confirmedPreviewId;
}

async function executeTaskWrite(ctx: RequestContext, ownerId: string, previewId: string): Promise<string> {
  const tasks = ctx.runtime.registry.getPort("tasks");
  return ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, previewId,
    async (savedAction, idempotencyKey) => {
      const call = { ...ctx.mutation, idempotencyKey };
      if (savedAction.kind === "task.create") return (await tasks.createTask!({ body: savedAction.body }, call)).data.id;
      if (savedAction.kind === "task.update") {
        return (await tasks.updateTask!({ id: savedAction.id, body: savedAction.body }, call)).data.id;
      }
      if (savedAction.kind === "task.cancel") {
        return (await tasks.cancelTask!({ id: savedAction.id, body: savedAction.body }, call)).data.id;
      }
      throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
    });
}

async function taskResponse(ctx: RequestContext, taskId: string, status: number) {
  const task = await ctx.runtime.registry.getPort("tasks").getTask({ id: taskId }, ctx.call);
  const response: TaskResponse = { contractVersion: CONTRACT_VERSION, data: task.data, freshness: task.freshness };
  ctx.audit.taskId = taskId;
  return { status, body: response, ...(status === 201 ? { headers: { Location: `/api/v1/tasks/${taskId}` } } : {}) };
}

/** Direct API task writes share the same saved draft, approval decision, and task-port receipt as command writes. */
export const taskActionHandlers: Partial<Record<OperationId, Handler>> = {
  async createTask(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const body = ctx.body as TaskCreateRequest;
    const write: TaskWrite = { capability: "create",
      unavailable: "Aufgaben koennen derzeit nicht angelegt werden.",
      action: { kind: "task.create", body }, actionText: `Aufgabe anlegen: ${body.title}`,
      previewTitle: "Neue Aufgabe", previewText: `Aufgabe ${body.title} anlegen?` };
    const confirmedPreviewId = ctx.headers["x-action-preview-id"];
    const cancelPreview = ctx.headers["x-action-preview-cancel"];
    if (confirmedPreviewId !== undefined && !PREVIEW_ID.test(confirmedPreviewId)) {
      throw validationFailed("Die Vorschaukennung ist ungueltig.", [{ path: "X-Action-Preview-Id", message: "ungueltig" }]);
    }
    if (cancelPreview !== undefined && (cancelPreview !== "true" || !confirmedPreviewId)) {
      throw validationFailed("Eine Vorschaukennung ist zum Verwerfen erforderlich.",
        [{ path: "X-Action-Preview-Cancel", message: "erfordert X-Action-Preview-Id und den Wert true" }]);
    }
    if (cancelPreview === "true") {
      ctx.runtime.nativeApprovals.cancelDraft(ownerId, confirmedPreviewId!, write.action);
      return { status: 204 };
    }
    checkCapability(ctx, write);
    const previewId = enforceTaskWrite(ctx, ownerId, write);
    return taskResponse(ctx, await executeTaskWrite(ctx, ownerId, previewId), 201);
  },

  async updateTask(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const tasks = ctx.runtime.registry.getPort("tasks");
    const id = ctx.pathParams.id as string;
    const body = ctx.body as TaskUpdateRequest;
    const write: TaskWrite = { capability: "update",
      unavailable: "Aufgaben koennen derzeit nicht geaendert werden.",
      action: { kind: "task.update", id, body }, actionText: "", previewTitle: "Aufgabe aktualisieren", previewText: "" };
    checkCapability(ctx, write);
    // An unknown task fails before any preview is staged; confirmation and replay only match the stored draft.
    if (!ctx.headers["x-action-preview-id"]) {
      const current = await tasks.getTask({ id }, ctx.call);
      write.actionText = `Aufgabe aktualisieren: ${current.data.title}`;
      write.previewText = body.status
        ? `Aufgabe „${current.data.title}“ auf ${body.status} setzen?`
        : `Aufgabe „${current.data.title}“ aktualisieren?`;
    }
    const previewId = enforceTaskWrite(ctx, ownerId, write);
    return taskResponse(ctx, await executeTaskWrite(ctx, ownerId, previewId), 200);
  },

  async cancelTask(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const tasks = ctx.runtime.registry.getPort("tasks");
    const id = ctx.pathParams.id as string;
    const body = ctx.body as TaskActionRequest | undefined;
    const write: TaskWrite = { capability: "cancel",
      unavailable: "Aufgaben koennen derzeit nicht abgebrochen werden.",
      action: body === undefined ? { kind: "task.cancel", id } : { kind: "task.cancel", id, body },
      actionText: "", previewTitle: "Aufgabe abbrechen", previewText: "" };
    checkCapability(ctx, write);
    if (!ctx.headers["x-action-preview-id"]) {
      const current = await tasks.getTask({ id }, ctx.call);
      if (CANCEL_FINAL.includes(current.data.status)) {
        throw conflict(`Aufgabe ${current.data.id} ist bereits beendet (${current.data.status}) und kann nicht abgebrochen werden.`,
          { status: current.data.status });
      }
      write.actionText = `Aufgabe abbrechen: ${current.data.title}`;
      write.previewText = `Aufgabe „${current.data.title}“ abbrechen?`;
    }
    const previewId = enforceTaskWrite(ctx, ownerId, write);
    return taskResponse(ctx, await executeTaskWrite(ctx, ownerId, previewId), 200);
  },
};
