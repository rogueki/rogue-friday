import { PORT_SPEC } from "@jarvis/adapter-core";
import { redact } from "@jarvis/observability";
import type { MemoryConflictResolveRequest, MemoryExport, TaskAssignRequest, FileRenameRequest, VoiceEnrollRequest, AutomationPauseAllRequest } from "@jarvis/sdk";
import type { Handler } from "../http/context";
import type { OperationId } from "../http/route-types";
import { validationFailed } from "../util/errors";
import { portHandler } from "./ports";

/**
 * Port-backed operations that need a precise audit note or an enforcement step on top of the plain port call
 * (renaming, conflict resolution, assignment, enrollment, Pause All, export, history deletion). The pipeline writes the
 * audit entry; these handlers only say what it should contain. Request bodies (free text) never go into it.
 */
const renameFileBase = portHandler("files", "renameFile", PORT_SPEC.files.renameFile);
const resolveBase = portHandler("memory", "resolveMemoryConflict", PORT_SPEC.memory.resolveMemoryConflict);
const exportBase = portHandler("memory", "exportMemory", PORT_SPEC.memory.exportMemory);
const pauseAllBase = portHandler("automations", "pauseAllAutomations", PORT_SPEC.automations.pauseAllAutomations);
const enrollBase = portHandler("voice", "enrollVoiceProfile", PORT_SPEC.voice.enrollVoiceProfile);
const deleteHistoryBase = portHandler("voice", "deleteVoiceHistory", PORT_SPEC.voice.deleteVoiceHistory);
const assignBase = portHandler("agents", "assignTask", PORT_SPEC.agents.assignTask);
const inputBase = portHandler("tasks", "provideTaskInput", PORT_SPEC.tasks.provideTaskInput);

export const domainOpHandlers: Partial<Record<OperationId, Handler>> = {
  async renameFile(ctx) {
    const id = ctx.pathParams.id as string;
    const { name } = ctx.body as FileRenameRequest;
    const files = ctx.runtime.registry.getPort("files");
    ctx.audit.action = "file.renamed";
    // The previous name makes the entry readable ("a.md -> b.md"); a failing lookup surfaces as the same 404 the rename would give.
    const before = (await files.getFile({ id }, ctx.call)).data;
    ctx.audit.before = { name: before.name };
    ctx.audit.after = { name };
    return renameFileBase(ctx);
  },

  async resolveMemoryConflict(ctx) {
    const { resolution } = ctx.body as MemoryConflictResolveRequest;
    ctx.audit.action = "memory.conflict_resolved";
    ctx.audit.severity = resolution === "replace" ? "warning" : "info";
    ctx.audit.context = { conflictingMemoryId: ctx.pathParams.conflictId as string, resolution };
    return resolveBase(ctx);
  },

  /**
   * The export never contains secrets (PLAN §30.3): restricted memories are removed here again whatever the adapter
   * delivered, and every string passes the redaction policy of the logs (tokens, keys, credentials in URLs).
   */
  async exportMemory(ctx) {
    const base = await exportBase(ctx);
    const document = base.body as MemoryExport;
    const exportable = document.items.filter((memory) => memory.sensitivity !== "restricted");
    const items = redact(exportable) as MemoryExport["items"];
    const omittedRestricted = document.omittedRestricted + (document.items.length - exportable.length);
    ctx.runtime.audit.record({
      category: "user_action",
      action: "memory.exported",
      severity: "warning",
      result: "success",
      correlationId: ctx.correlationId,
      actor: ctx.actor,
      durationMs: 0,
      errorCode: null,
      context: { count: items.length, omittedRestricted },
    });
    return {
      ...base,
      body: { ...document, count: items.length, omittedRestricted, items },
      headers: { ...(base.headers ?? {}), "Content-Disposition": `attachment; filename="memory-export-${document.exportedAt.slice(0, 10)}.json"` },
    };
  },

  async pauseAllAutomations(ctx) {
    const { reason } = (ctx.body ?? {}) as AutomationPauseAllRequest;
    ctx.audit.action = "automation.paused_all";
    ctx.audit.severity = "warning";
    ctx.audit.context = reason ? { reason } : {};
    return pauseAllBase(ctx);
  },

  async enrollVoiceProfile(ctx) {
    const { sampleTarget, recalibrate } = (ctx.body ?? {}) as VoiceEnrollRequest;
    ctx.audit.action = "voice.enrollment_started";
    ctx.audit.context = { profileId: ctx.pathParams.id as string, ...(sampleTarget !== undefined ? { sampleTarget } : {}), ...(recalibrate !== undefined ? { recalibrate } : {}) };
    const base = await enrollBase(ctx);
    const job = (base.body as { data: { id: string } }).data;
    return { ...base, headers: { ...(base.headers ?? {}), Location: `${ctx.spec.path.replace("/profiles/{id}/enroll", "/enrollments")}/${job.id}` } };
  },

  /** Deleting the voice history is irreversible: it only runs with an explicit `confirm=true`. */
  async deleteVoiceHistory(ctx) {
    if (ctx.query.confirm !== true) {
      throw validationFailed("Das Löschen des Sprachverlaufs muss mit confirm=true bestätigt werden.", [{ path: "confirm", message: "muss true sein" }]);
    }
    ctx.audit.action = "voice.history_deleted";
    ctx.audit.severity = "warning";
    ctx.audit.context = typeof ctx.query.before === "string" ? { before: ctx.query.before } : {};
    return deleteHistoryBase(ctx);
  },

  async assignTask(ctx) {
    const { agentId } = ctx.body as TaskAssignRequest;
    ctx.audit.action = "task.assigned";
    ctx.audit.taskId = ctx.pathParams.id as string;
    ctx.audit.agentId = agentId;
    return assignBase(ctx);
  },

  async provideTaskInput(ctx) {
    ctx.audit.action = "task.input_provided";
    ctx.audit.taskId = ctx.pathParams.id as string;
    return inputBase(ctx);
  },
};
