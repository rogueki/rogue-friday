import { CONTRACT_VERSION, type TaskCreateRequest, type TaskResponse } from "@friday/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { ApiError, validationFailed } from "../util/errors";

const PREVIEW_ID = /^corr_[0-9A-Za-z]{26}$/;

/** Direct API task writes share the same saved draft, approval decision, and task-port receipt as command writes. */
export const taskActionHandlers: Partial<Record<OperationId, Handler>> = {
  async createTask(ctx) {
    const ownerId = ctx.principal?.userId;
    if (!ownerId) throw new ApiError({ code: "UNAUTHENTICATED", message: "Anmeldung erforderlich." });
    const tasks = ctx.runtime.registry.getPort("tasks");
    if (!tasks.createTask) throw new ApiError({ code: "CAPABILITY_MISSING", message: "Aufgaben koennen derzeit nicht angelegt werden." });
    if (!ctx.runtime.capabilities().modules.tasks.create) {
      throw new ApiError({ code: "CAPABILITY_MISSING", message: "Aufgaben koennen derzeit nicht angelegt werden.",
        details: { capability: "tasks.create" } });
    }
    const body = ctx.body as TaskCreateRequest;
    const action = { kind: "task.create" as const, body };
    const confirmedPreviewId = ctx.headers["x-action-preview-id"];
    if (confirmedPreviewId !== undefined && !PREVIEW_ID.test(confirmedPreviewId)) {
      throw validationFailed("Die Vorschaukennung ist ungueltig.", [{ path: "X-Action-Preview-Id", message: "ungueltig" }]);
    }

    if (!confirmedPreviewId) {
      const previewId = ctx.correlationId;
      ctx.runtime.nativeApprovals.propose({ ownerId, requestKey: previewId, correlationId: ctx.correlationId,
        riskTier: 2, type: "system_change", action: `Aufgabe anlegen: ${body.title}`,
        rationale: "Aufgabe aus bestaetigter API-Anfrage", preview: { kind: "text", title: "Neue Aufgabe",
          body: JSON.stringify(body) }, impacts: [], execution: action });
      throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Aufgabe zuerst mit unveraenderter Vorschau bestaetigen.",
        details: { stage: "preview", previewId, previewText: `Aufgabe ${body.title} anlegen?` } });
    }

    const policy = ctx.runtime.nativeApprovals.confirm(ownerId, confirmedPreviewId, action);
    if (policy.approval) {
      throw new ApiError({ code: "APPROVAL_REQUIRED", message: "Aufgabe wartet auf Freigabe.",
        details: { stage: "approval", approvalId: policy.approval.id,
          targetRoute: `/approvals?approval=${policy.approval.id}` } });
    }
    const taskId = await ctx.runtime.nativeApprovals.executeWithoutApproval(ownerId, confirmedPreviewId,
      async (savedAction, idempotencyKey) => (await tasks.createTask!({ body: savedAction.body },
        { ...ctx.mutation, idempotencyKey })).data.id);
    const task = await tasks.getTask({ id: taskId }, ctx.call);
    const response: TaskResponse = { contractVersion: CONTRACT_VERSION, data: task.data, freshness: task.freshness };
    ctx.audit.taskId = taskId;
    return { status: 201, body: response, headers: { Location: `/api/v1/tasks/${taskId}` } };
  },
};
