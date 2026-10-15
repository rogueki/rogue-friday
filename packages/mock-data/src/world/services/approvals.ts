import type {
  Actor,
  AdapterCategory,
  Approval,
  ApprovalContextRequest,
  ApprovalDecisionRequest,
  ApprovalImpact,
  ApprovalPreview,
  ApprovalType,
  EntityRef,
  RequiredAuth,
  RiskTier,
} from "@friday/sdk";
import type { TimerHandle } from "../../core/clock";
import { conflict, MockApiError, notFound, validationFailed } from "../../core/errors";
import { asList, clone, compareAsc, compareDesc, type Page } from "../../core/util";
import type { MockWorld } from "../world";
import type { OpContext } from "../types";
import { APPROVAL_STATUSES, APPROVAL_TYPES, checkEnum, pageOf, type Query } from "./shared";

export type ApprovalListQuery = Query<"listApprovals">;

export interface RaiseApprovalInput {
  type: ApprovalType;
  action: string;
  riskTier: RiskTier;
  agentId?: string | null;
  taskId?: string | null;
  rationale: string;
  impacts?: ApprovalImpact[];
  preview: ApprovalPreview;
  expiresInMs?: number | null;
  sourceRef?: EntityRef | null;
  editable?: boolean;
  correlationId?: string;
  /** Creates a dashboard notification (default: settings.approvals.notifyOnRequest). */
  notify?: boolean;
  requestedBy?: Actor;
}

const EXECUTION_CATEGORY: Partial<Record<ApprovalType, AdapterCategory>> = {
  send_email: "communication",
  send_message: "communication",
  change_event: "calendar",
  delete_file: "files",
};

const EXECUTION_TEXT: Record<ApprovalType, string> = {
  send_email: "E-Mail wurde versendet.",
  send_message: "Nachricht wurde versendet.",
  change_event: "Terminänderung wurde im Kalender übernommen.",
  delete_file: "Datei wurde gelöscht.",
  order: "Bestellung wurde beim Anbieter ausgelöst (Mock, keine echte Transaktion).",
  payment: "Zahlung wurde angewiesen (Mock, keine echte Transaktion).",
  contract: "Vertrag wurde zur Unterzeichnung bereitgestellt (Mock).",
  system_change: "Systemänderung wurde ausgeführt.",
};

export class ApprovalService {
  private timers = new Map<string, TimerHandle>();

  constructor(private readonly w: MockWorld) {}

  find(id: string): Approval {
    const approval = this.w.state.approvals.find((candidate) => candidate.id === id);
    if (!approval) throw notFound("Freigabe", id);
    return approval;
  }

  list(query: ApprovalListQuery = {}): Page<Approval> {
    return this.w.read("listApprovals", () => {
      const statuses = asList(query.status);
      const types = asList(query.type);
      const tiers = asList(query.riskTier);
      checkEnum("status", statuses, APPROVAL_STATUSES);
      checkEnum("type", types, APPROVAL_TYPES);
      checkEnum("riskTier", tiers, ["1", "2", "3"]);
      const items = this.w.state.approvals
        .filter((approval) => {
          if (statuses.length && !statuses.includes(approval.status)) return false;
          if (types.length && !types.includes(approval.type)) return false;
          if (tiers.length && !tiers.includes(String(approval.riskTier))) return false;
          if (query.agentId && approval.agentId !== query.agentId) return false;
          if (query.taskId && approval.taskId !== query.taskId) return false;
          return true;
        })
        .sort((a, b) => {
          const pending = Number(b.status === "pending") - Number(a.status === "pending");
          if (pending) return pending;
          if (a.status === "pending") return compareAsc(a.expiresAt ?? "9", b.expiresAt ?? "9") || compareAsc(a.id, b.id);
          return compareDesc(a.updatedAt, b.updatedAt) || compareDesc(a.id, b.id);
        });
      return pageOf(items, query);
    });
  }

  get(id: string): Approval {
    return this.w.read("getApproval", () => clone(this.find(id)));
  }

  approve(id: string, body: ApprovalDecisionRequest = {}, ctx?: OpContext): Approval {
    return this.w.run("approveApproval", ctx, { id, body }, () => {
      this.w.validate("ApprovalDecisionRequest", body);
      const approval = this.find(id);
      this.assertDecidable(approval, ctx);
      const channel = body.inputChannel ?? ctx?.inputChannel ?? "dashboard";
      if (approval.riskTier === 3 && channel === "voice") {
        throw new MockApiError({ code: "FORBIDDEN", message: "Freigaben der Risikostufe 3 sind per Sprache allein nicht möglich.", details: { riskTier: 3, inputChannel: channel } });
      }
      if (approval.requiredAuth === "reauth" && !this.w.auth.consumeReauth(body.reauthToken)) {
        throw new MockApiError({ code: "REAUTH_REQUIRED", message: "Für diese Freigabe ist eine erneute Authentifizierung nötig.", details: { requiredAuth: "reauth" } });
      }
      if (body.editedPreview) {
        if (!approval.editable) throw validationFailed("Diese Freigabe kann nicht vor der Bestätigung bearbeitet werden.", [{ path: "editedPreview", message: "nicht editierbar" }]);
        approval.preview = body.editedPreview;
        this.w.communication.applyEditedPreview(approval);
      }
      const correlationId = approval.correlationId;
      const actor = this.w.actorOf(ctx);
      approval.status = "approved";
      approval.decidedAt = this.w.nowIso();
      approval.decidedBy = actor;
      approval.decisionComment = body.comment ?? null;
      this.w.bump(approval);
      const decided = this.w.emitFor("approvals", "friday.approval.resolved", approval, `approval/${approval.id}`, correlationId);
      this.w.recordAudit({
        category: "approval",
        action: "approval.approved",
        correlationId,
        approvalId: approval.id,
        agentId: approval.agentId,
        taskId: approval.taskId,
        adapterId: "mock-approvals",
        actor,
        before: { status: "pending" },
        after: { status: "approved" },
        context: { riskTier: approval.riskTier, inputChannel: channel, ...(body.comment ? { comment: body.comment } : {}) },
      });
      this.cancelTimer(approval.id);
      this.execute(approval, correlationId, decided.id, actor);
      this.afterDecision(approval, "approved");
      return clone(approval);
    });
  }

  reject(id: string, body: ApprovalDecisionRequest = {}, ctx?: OpContext): Approval {
    return this.w.run("rejectApproval", ctx, { id, body }, () => {
      this.w.validate("ApprovalDecisionRequest", body);
      const approval = this.find(id);
      this.assertDecidable(approval, ctx);
      const actor = this.w.actorOf(ctx);
      approval.status = "rejected";
      approval.decidedAt = this.w.nowIso();
      approval.decidedBy = actor;
      approval.decisionComment = body.comment ?? null;
      this.w.bump(approval);
      this.w.emitFor("approvals", "friday.approval.resolved", approval, `approval/${approval.id}`, approval.correlationId);
      this.w.recordAudit({
        category: "approval",
        action: "approval.rejected",
        correlationId: approval.correlationId,
        approvalId: approval.id,
        agentId: approval.agentId,
        taskId: approval.taskId,
        adapterId: "mock-approvals",
        actor,
        before: { status: "pending" },
        after: { status: "rejected" },
        context: body.comment ? { comment: body.comment } : {},
      });
      this.cancelTimer(approval.id);
      this.w.communication.onApprovalClosed(approval, "rejected");
      this.w.calendar.onApprovalClosed(approval, "rejected");
      this.afterDecision(approval, "rejected");
      return clone(approval);
    });
  }

  requestContext(id: string, body: ApprovalContextRequest, ctx?: OpContext): Approval {
    return this.w.run("requestApprovalContext", ctx, { id, body }, () => {
      this.w.validate("ApprovalContextRequest", body);
      const approval = this.find(id);
      if (approval.status !== "pending") throw conflict(`Die Freigabe ist nicht mehr offen (${approval.status}).`, { status: approval.status });
      const agent = approval.agentId ? this.w.state.agents.find((candidate) => candidate.id === approval.agentId) : undefined;
      const question = body.question.trim();
      const lower = question.toLowerCase();
      const answer = /kosten|preis|betrag|teuer/.test(lower)
        ? `Die finanziellen Auswirkungen: ${approval.impacts.filter((impact) => impact.kind === "money").map((impact) => impact.description).join(" ") || "Es entstehen keine direkten Kosten."}`
        : /warum|grund|wieso/.test(lower)
          ? `Begründung: ${approval.rationale.split("\n\n")[0]}`
          : "Ich habe Entwurf, Quellen und Kalender nochmals geprüft; es gibt keine Abweichungen zur ursprünglichen Einschätzung.";
      approval.rationale = `${approval.rationale}\n\nRückfrage: ${question}\nAntwort von ${agent?.name ?? this.w.assistantName()}: ${answer}`;
      this.w.bump(approval);
      // The contract has no approval.updated event; re-announcing keeps cached approvals current.
      this.w.emitFor("approvals", "friday.approval.requested", approval, `approval/${approval.id}`, approval.correlationId);
      this.w.logActivity({ kind: "agent", title: `Rückfrage zur Freigabe beantwortet: ${approval.action}`, correlationId: approval.correlationId, agentId: approval.agentId, taskId: approval.taskId, adapterId: "mock-approvals", actor: this.w.actorOf(ctx) });
      this.w.recordAudit({
        category: "approval",
        action: "approval.context_requested",
        correlationId: approval.correlationId,
        approvalId: approval.id,
        agentId: approval.agentId,
        taskId: approval.taskId,
        adapterId: "mock-approvals",
        actor: this.w.actorOf(ctx),
        context: { question },
      });
      return clone(approval);
    });
  }

  // ---- internal hooks ----

  raise(input: RaiseApprovalInput): Approval {
    const now = this.w.nowIso();
    const settings = this.w.state.settings.approvals;
    const correlationId = input.correlationId ?? this.w.correlationId();
    const requiredAuth: RequiredAuth = input.riskTier === 3 ? (settings.reauthTier3 ? "reauth" : "confirm") : input.riskTier === 2 ? (settings.confirmTier2 ? "confirm" : "none") : "none";
    const expiresInMs = input.expiresInMs === undefined ? settings.defaultExpiryMinutes * 60_000 : input.expiresInMs;
    const approval: Approval = {
      id: this.w.id("appr"),
      version: 1,
      createdAt: now,
      updatedAt: now,
      source: this.w.source("approvals"),
      type: input.type,
      action: input.action,
      riskTier: input.riskTier,
      agentId: input.agentId ?? null,
      taskId: input.taskId ?? null,
      rationale: input.rationale,
      impacts: input.impacts ?? [],
      preview: input.preview,
      expiresAt: expiresInMs === null ? null : new Date(this.w.nowMs() + expiresInMs).toISOString(),
      requiredAuth,
      status: "pending",
      decidedAt: null,
      decidedBy: null,
      decisionComment: null,
      sourceRef: input.sourceRef ?? null,
      editable: input.editable ?? input.riskTier < 3,
      correlationId,
    };
    this.w.state.approvals.push(approval);
    const task = approval.taskId ? this.w.state.tasks.find((candidate) => candidate.id === approval.taskId) : undefined;
    if (task) {
      task.approvalIds.push(approval.id);
      task.blockers.push({ id: this.w.id("blk"), kind: "approval", description: `Wartet auf Freigabe: ${approval.action}`, since: now, refId: approval.id });
      if (task.status === "running") {
        task.status = "waiting";
        this.w.agents.release(task.id, "waiting");
      }
      this.w.bump(task);
      this.w.emitFor("tasks", "friday.task.updated", task, `task/${task.id}`, correlationId);
    }
    const event = this.w.emitFor("approvals", "friday.approval.requested", approval, `approval/${approval.id}`, correlationId);
    this.w.logActivity({ kind: "agent", title: `Freigabe angefordert: ${approval.action}`, correlationId, agentId: approval.agentId, taskId: approval.taskId, adapterId: "mock-approvals", status: "info", summary: `Risikostufe ${approval.riskTier}` });
    this.w.recordAudit({
      category: "approval",
      action: "approval.requested",
      correlationId,
      approvalId: approval.id,
      agentId: approval.agentId,
      taskId: approval.taskId,
      adapterId: "mock-approvals",
      actor: input.requestedBy ?? (approval.agentId ? { type: "agent", id: approval.agentId } : this.w.defaultActor()),
      result: "pending",
      after: { status: "pending" },
      context: { riskTier: approval.riskTier, type: approval.type, causedBy: event.id },
    });
    if (input.notify ?? settings.notifyOnRequest) {
      this.w.notifications.raise({
        priority: approval.riskTier === 3 ? "P1" : "P2",
        category: "approval",
        title: `Freigabe erforderlich: ${approval.action}`,
        body: approval.rationale,
        sourceRef: { type: "approval", id: approval.id, label: approval.action },
        targetRoute: `/approvals?approval=${approval.id}`,
        chain: approval.riskTier === 3 ? ["dashboard", "telegram", "phone"] : ["dashboard"],
        correlationId,
      });
    }
    this.scheduleTimer(approval);
    this.w.refresh();
    return approval;
  }

  cancelForTask(taskId: string): void {
    for (const approval of this.w.state.approvals) {
      if (approval.taskId !== taskId || approval.status !== "pending") continue;
      approval.status = "cancelled";
      this.w.bump(approval);
      this.cancelTimer(approval.id);
      this.w.emitFor("approvals", "friday.approval.resolved", approval, `approval/${approval.id}`, approval.correlationId);
      this.w.communication.onApprovalClosed(approval, "cancelled");
      this.w.calendar.onApprovalClosed(approval, "cancelled");
      this.w.notifications.resolveForRef(approval.id);
    }
  }

  expire(id: string): void {
    const approval = this.w.state.approvals.find((candidate) => candidate.id === id);
    if (!approval || approval.status !== "pending") return;
    approval.status = "expired";
    this.w.bump(approval);
    this.timers.delete(id);
    this.w.emitFor("approvals", "friday.approval.expired", approval, `approval/${approval.id}`, approval.correlationId);
    this.w.recordAudit({
      category: "approval",
      action: "approval.expired",
      severity: "warning",
      correlationId: approval.correlationId,
      approvalId: approval.id,
      agentId: approval.agentId,
      taskId: approval.taskId,
      adapterId: "mock-approvals",
      actor: { type: "system", id: "control-api", name: "Control API" },
      result: "denied",
      before: { status: "pending" },
      after: { status: "expired" },
    });
    this.w.communication.onApprovalClosed(approval, "expired");
    this.w.calendar.onApprovalClosed(approval, "expired");
    this.afterDecision(approval, "expired");
    this.w.refresh();
  }

  /** (Re)creates expiry timers for all pending approvals; called after load/restore. */
  scheduleTimers(): void {
    for (const handle of this.timers.values()) handle.cancel();
    this.timers.clear();
    for (const approval of this.w.state.approvals) if (approval.status === "pending") this.scheduleTimer(approval);
  }

  private scheduleTimer(approval: Approval): void {
    if (!approval.expiresAt) return;
    const delay = Date.parse(approval.expiresAt) - this.w.nowMs();
    this.timers.get(approval.id)?.cancel();
    this.timers.set(approval.id, this.w.clock.setTimeout(() => this.expire(approval.id), Math.max(0, delay)));
  }

  private cancelTimer(id: string): void {
    this.timers.get(id)?.cancel();
    this.timers.delete(id);
  }

  private assertDecidable(approval: Approval, ctx?: OpContext): void {
    this.w.assertVersion(approval, ctx, "Freigabe");
    if (approval.status !== "pending") throw conflict(`Die Freigabe ist nicht mehr offen (${approval.status}).`, { status: approval.status });
    if (approval.expiresAt && Date.parse(approval.expiresAt) <= this.w.nowMs()) {
      this.expire(approval.id);
      throw conflict("Die Freigabe ist abgelaufen.", { status: "expired" });
    }
  }

  /** Runs the approved action. Never executes anything before an explicit approval; failures are recorded, not thrown. */
  private execute(approval: Approval, correlationId: string, causationId: string, actor: Actor): void {
    const category = EXECUTION_CATEGORY[approval.type];
    let result: string;
    let success = true;
    try {
      if (category && this.w.adapter(category).mode !== "online") {
        throw new Error(`Der Adapter für ${category} ist nicht erreichbar.`);
      }
      if (approval.type === "send_email" || approval.type === "send_message") result = this.w.communication.executeSend(approval);
      else if (approval.type === "change_event") result = this.w.calendar.executeProposal(approval);
      else if (approval.type === "delete_file") result = this.w.files.executeDelete(approval);
      else result = EXECUTION_TEXT[approval.type];
    } catch (error) {
      success = false;
      result = `Ausführung fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannter Fehler"}`;
      this.w.communication.onApprovalClosed(approval, "failed");
      this.w.calendar.onApprovalClosed(approval, "failed");
    }
    approval.status = success ? "executed" : "failed";
    approval.executionResult = result;
    this.w.bump(approval);
    this.w.emitFor("approvals", "friday.approval.resolved", approval, `approval/${approval.id}`, correlationId, causationId);
    this.w.recordAudit({
      category: "system",
      action: success ? "approval.executed" : "approval.execution_failed",
      severity: success ? "info" : "error",
      result: success ? "success" : "failure",
      errorCode: success ? null : "ADAPTER_UNAVAILABLE",
      correlationId,
      approvalId: approval.id,
      agentId: approval.agentId,
      taskId: approval.taskId,
      adapterId: category ? `mock-${category}` : "mock-approvals",
      actor,
      before: { status: "approved" },
      after: { status: approval.status },
      context: { executionResult: result },
    });
    this.w.logActivity({
      kind: "result",
      title: `Freigabe ${success ? "ausgeführt" : "fehlgeschlagen"}: ${approval.action}`,
      correlationId,
      agentId: approval.agentId,
      taskId: approval.taskId,
      adapterId: "mock-approvals",
      status: success ? "succeeded" : "failed",
      result,
    });
  }

  /** Updates blockers/status of the linked task and closes the related notification. */
  private afterDecision(approval: Approval, outcome: "approved" | "rejected" | "expired"): void {
    this.w.notifications.resolveForRef(approval.id);
    const task = approval.taskId ? this.w.state.tasks.find((candidate) => candidate.id === approval.taskId) : undefined;
    if (!task) return;
    task.blockers = task.blockers.filter((blocker) => blocker.refId !== approval.id);
    if (outcome === "approved" && approval.status === "executed") {
      if (task.status === "waiting" && task.blockers.length === 0) {
        if (task.agentId) {
          task.status = "running";
          this.w.agents.attach(task.agentId, task.id);
        } else task.status = "ready";
      }
    } else if (task.status === "waiting" && task.blockers.length === 0) {
      task.blockers.push({
        id: this.w.id("blk"),
        kind: "input_needed",
        description:
          outcome === "rejected"
            ? "Die Freigabe wurde abgelehnt. Bitte neue Anweisung geben."
            : outcome === "approved"
              ? "Die freigegebene Aktion ist fehlgeschlagen. Bitte erneut anstoßen."
              : "Die Freigabe ist abgelaufen. Bitte neu anfordern.",
        since: this.w.nowIso(),
      });
    }
    this.w.bump(task);
    this.w.emitFor("tasks", "friday.task.updated", task, `task/${task.id}`, approval.correlationId);
  }
}
