import { createHash, randomUUID } from "node:crypto";
import { createId } from "@friday/observability";
import type { Approval, SchemaValidator, TaskCreateRequest } from "@friday/sdk";
import type { Db } from "../db/database";
import type { SettingsService } from "./settings";
import { conflict, validationFailed } from "../util/errors";
import type { Actor } from "@friday/sdk";

/** Persisted command payload. Add a kind only with a matching, idempotent dispatch branch and regression tests. */
export type NativeExecutableAction = { kind: "task.create"; body: TaskCreateRequest };

/** The action executor supplies a reviewed preview and a stable key before any external side effect. */
export interface NativeApprovalProposal {
  /** Stable authenticated owner identity; never supplied by untrusted request text. */
  ownerId: string;
  requestKey: string;
  correlationId: string;
  riskTier: 1 | 2 | 3;
  type: Approval["type"];
  action: string;
  rationale: string;
  preview: Approval["preview"];
  impacts: Approval["impacts"];
  agentId?: Approval["agentId"];
  taskId?: Approval["taskId"];
  sourceRef?: Approval["sourceRef"];
  execution?: NativeExecutableAction;
}

export interface CapturedApprovalPolicy {
  /** A draft remains pending until an explicit action confirms or edits it. */
  draftOnly: boolean;
  notifyOnRequest: boolean;
  requiresApproval: boolean;
  approval: Approval | null;
}

/** Durable policy capture for trusted action producers. This does not execute or approve an action. */
export class NativeApprovalRequests {
  constructor(private readonly db: Db, private readonly settings: SettingsService,
    private readonly validator: SchemaValidator, private readonly now: () => number = Date.now) {}

  propose(input: NativeApprovalProposal): CapturedApprovalPolicy {
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.ownerId) ||
        !/^[A-Za-z0-9._:-]{8,128}$/.test(input.requestKey) || !/^corr_[0-9A-Za-z]{26}$/.test(input.correlationId) ||
        ![1, 2, 3].includes(input.riskTier) || !input.action.trim() || !input.preview.title.trim()) {
      throw validationFailed("Freigabeanfrage ist unvollstaendig.", [{ path: "approval", message: "ungueltige Erzeugungsdaten" }]);
    }
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const existing = this.db.prepare("SELECT proposal_hash, result_json FROM native_approval_requests WHERE owner_id = ? AND request_key = ?")
      .get(input.ownerId, input.requestKey) as { proposal_hash: string; result_json: string } | undefined;
    if (existing) {
      if (existing.proposal_hash !== hash) throw conflict("Freigabeschluessel wurde fuer eine andere Aktion verwendet.");
      return JSON.parse(existing.result_json) as CapturedApprovalPolicy;
    }

    const defaults = this.settings.area("approvals");
    const requiresApproval = input.riskTier === 3 || (input.riskTier === 2 && defaults.confirmTier2);
    const createdAt = new Date(this.now()).toISOString();
    const approval: Approval | null = requiresApproval ? {
      id: createId("appr"), version: 1, createdAt, updatedAt: createdAt,
      source: { adapterId: "friday-native-approvals", system: "friday", lastSyncedAt: createdAt },
      type: input.type, action: input.action.trim(), riskTier: input.riskTier,
      agentId: input.agentId ?? null, taskId: input.taskId ?? null,
      rationale: input.rationale, impacts: input.impacts, preview: structuredClone(input.preview),
      expiresAt: new Date(this.now() + defaults.defaultExpiryMinutes * 60_000).toISOString(),
      requiredAuth: input.riskTier === 3 ? "reauth" : "confirm", status: "pending",
      decidedAt: null, decidedBy: null, decisionComment: null,
      sourceRef: input.sourceRef ?? null, editable: !input.execution && input.riskTier < 3,
      correlationId: input.correlationId,
    } : null;
    const result: CapturedApprovalPolicy = {
      draftOnly: defaults.draftOnlyByDefault,
      notifyOnRequest: requiresApproval && defaults.notifyOnRequest,
      requiresApproval,
      approval,
    };
    if (approval) {
      const check = this.validator.validate("Approval", approval);
      if (!check.valid) throw validationFailed("Freigabeanfrage entspricht nicht dem Vertrag.", check.errors);
    }
    try {
      // The command protocol always shows a preview before a write, even when the saved default permits direct
      // execution after that explicit confirmation. An unconfirmed proposal is never visible as an approval.
      const state = input.execution ? "draft" : result.draftOnly ? "draft" : "pending";
      this.db.prepare("INSERT INTO native_approval_requests (owner_id, request_key, proposal_hash, result_json, action_json, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(input.ownerId, input.requestKey, hash, JSON.stringify(result), input.execution ? JSON.stringify(input.execution) : null,
          state, this.now(), this.now());
    } catch (error) {
      const raced = this.db.prepare("SELECT proposal_hash, result_json FROM native_approval_requests WHERE owner_id = ? AND request_key = ?")
        .get(input.ownerId, input.requestKey) as { proposal_hash: string; result_json: string } | undefined;
      if (!raced) throw error;
      if (raced.proposal_hash !== hash) throw conflict("Freigabeschluessel wurde fuer eine andere Aktion verwendet.");
      return JSON.parse(raced.result_json) as CapturedApprovalPolicy;
    }
    return result;
  }

  get(ownerId: string, requestKey: string): CapturedApprovalPolicy | null {
    const row = this.db.prepare("SELECT result_json FROM native_approval_requests WHERE owner_id = ? AND request_key = ?")
      .get(ownerId, requestKey) as { result_json: string } | undefined;
    return row ? JSON.parse(row.result_json) as CapturedApprovalPolicy : null;
  }

  confirm(ownerId: string, requestKey: string, expectedAction: NativeExecutableAction): CapturedApprovalPolicy {
    const row = this.db.prepare("SELECT result_json, action_json, state FROM native_approval_requests WHERE owner_id = ? AND request_key = ?")
      .get(ownerId, requestKey) as { result_json: string; action_json: string | null; state: string } | undefined;
    if (!row) throw conflict("Der Entwurf ist nicht mehr vorhanden.");
    if (!row.action_json || JSON.stringify(JSON.parse(row.action_json)) !== JSON.stringify(expectedAction))
      throw conflict("Die Bestaetigung passt nicht zum gespeicherten Entwurf.");
    const result = JSON.parse(row.result_json) as CapturedApprovalPolicy;
    if (row.state === "draft") {
      const expiry = result.approval?.expiresAt;
      if (expiry && Date.parse(expiry) <= this.now()) throw conflict("Der Entwurf ist abgelaufen.");
      this.db.prepare("UPDATE native_approval_requests SET state = 'pending', updated_at = ? WHERE owner_id = ? AND request_key = ? AND state = 'draft'")
        .run(this.now(), ownerId, requestKey);
    } else if (row.state !== "pending" && !(!result.requiresApproval && ["completed", "dispatching"].includes(row.state)))
      throw conflict("Der Entwurf ist nicht mehr offen.");
    return result;
  }

  cancelDraft(ownerId: string, requestKey: string, expectedAction: NativeExecutableAction): void {
    const row = this.db.prepare("SELECT action_json, state FROM native_approval_requests WHERE owner_id = ? AND request_key = ?")
      .get(ownerId, requestKey) as { action_json: string | null; state: string } | undefined;
    if (!row || !row.action_json || JSON.stringify(JSON.parse(row.action_json)) !== JSON.stringify(expectedAction))
      throw conflict("Der Entwurf passt nicht zur Aktion.");
    if (row.state !== "draft") throw conflict("Der Entwurf ist nicht mehr offen.");
    const removed = this.db.prepare("DELETE FROM native_approval_requests WHERE owner_id = ? AND request_key = ? AND state = 'draft'")
      .run(ownerId, requestKey);
    if (removed.changes !== 1) throw conflict("Der Entwurf wurde bereits geaendert.");
  }

  async executeWithoutApproval(ownerId: string, requestKey: string,
    dispatch: (action: NativeExecutableAction, idempotencyKey: string) => Promise<string>): Promise<string> {
    const row = this.db.prepare("SELECT result_json, action_json, state, receipt_json, updated_at FROM native_approval_requests WHERE owner_id = ? AND request_key = ?")
      .get(ownerId, requestKey) as { result_json: string; action_json: string | null; state: string; receipt_json: string | null; updated_at: number } | undefined;
    if (!row || !row.action_json) throw conflict("Aktion ist nicht mehr vorhanden.");
    const result = JSON.parse(row.result_json) as CapturedApprovalPolicy;
    if (result.requiresApproval) throw conflict("Diese Aktion braucht eine Freigabe.");
    if (row.state === "completed" && row.receipt_json) return (JSON.parse(row.receipt_json) as { taskId: string }).taskId;
    if (row.state !== "pending")
      throw conflict("Die Aktion ist nicht bestaetigt oder wird bereits verarbeitet.");
    const dispatchToken = randomUUID();
    const reserved = this.db.prepare("UPDATE native_approval_requests SET state = 'dispatching', dispatch_token = ?, updated_at = ? WHERE owner_id = ? AND request_key = ? AND state = 'pending' AND updated_at = ?")
      .run(dispatchToken, this.now(), ownerId, requestKey, row.updated_at);
    if (reserved.changes !== 1) throw conflict("Die Aktion wird bereits verarbeitet.");
    try {
      const action = JSON.parse(row.action_json) as NativeExecutableAction;
      const taskId = await dispatch(action, `native-action:${ownerId}:${requestKey}`);
      const written = this.db.prepare("UPDATE native_approval_requests SET state = 'completed', receipt_json = ?, updated_at = ? WHERE owner_id = ? AND request_key = ? AND state = 'dispatching' AND dispatch_token = ?")
        .run(JSON.stringify({ taskId }), this.now(), ownerId, requestKey, dispatchToken);
      if (written.changes !== 1) throw conflict("Der Ausfuehrungsbeleg konnte nicht gesichert werden.");
      return taskId;
    } catch (error) {
      // A timeout may happen after Hermes created the task. Never issue a second write without a verified receipt.
      this.db.prepare("UPDATE native_approval_requests SET state = 'uncertain', updated_at = ? WHERE owner_id = ? AND request_key = ? AND state = 'dispatching' AND dispatch_token = ?")
        .run(this.now(), ownerId, requestKey, dispatchToken);
      throw error;
    }
  }

  getApproval(ownerId: string, approvalId: string): Approval | null {
    const row = this.db.prepare("SELECT request_key, result_json, state FROM native_approval_requests WHERE owner_id = ? AND json_extract(result_json, '$.approval.id') = ?")
      .get(ownerId, approvalId) as { request_key: string; result_json: string; state: string } | undefined;
    if (!row || row.state === "draft") return null;
    return this.expireIfDue(ownerId, row).approval;
  }

  listApprovals(ownerId: string): Approval[] {
    const rows = this.db.prepare("SELECT request_key, result_json, state FROM native_approval_requests WHERE owner_id = ? AND action_json IS NOT NULL AND state <> 'draft' ORDER BY created_at DESC LIMIT 200")
      .all(ownerId) as Array<{ request_key: string; result_json: string; state: string }>;
    return rows.map((row) => this.expireIfDue(ownerId, row).approval).filter((approval): approval is Approval => approval !== null);
  }

  private expireIfDue(ownerId: string, row: { request_key: string; result_json: string; state: string }): CapturedApprovalPolicy {
    const result = JSON.parse(row.result_json) as CapturedApprovalPolicy;
    const approval = result.approval;
    if (!approval || row.state !== "pending" || !approval.expiresAt || Date.parse(approval.expiresAt) > this.now()) return result;
    const expired: Approval = { ...approval, status: "expired", version: approval.version + 1,
      updatedAt: new Date(this.now()).toISOString() };
    const updated = this.db.prepare("UPDATE native_approval_requests SET state = 'expired', result_json = ?, updated_at = ? WHERE owner_id = ? AND request_key = ? AND state = 'pending'")
      .run(JSON.stringify({ ...result, approval: expired }), this.now(), ownerId, row.request_key);
    return updated.changes === 1 ? { ...result, approval: expired } :
      JSON.parse((this.db.prepare("SELECT result_json FROM native_approval_requests WHERE owner_id = ? AND request_key = ?")
        .get(ownerId, row.request_key) as { result_json: string }).result_json) as CapturedApprovalPolicy;
  }

  async approve(ownerId: string, approvalId: string, actor: Actor,
    dispatch: (action: NativeExecutableAction, idempotencyKey: string) => Promise<string>): Promise<Approval> {
    const row = this.db.prepare("SELECT request_key, result_json, action_json, state, updated_at FROM native_approval_requests WHERE owner_id = ? AND json_extract(result_json, '$.approval.id') = ?")
      .get(ownerId, approvalId) as { request_key: string; result_json: string; action_json: string | null; state: string; updated_at: number } | undefined;
    if (!row || !row.action_json) throw conflict("Freigabe ist nicht mehr vorhanden.");
    const result = JSON.parse(row.result_json) as CapturedApprovalPolicy;
    const approval = result.approval;
    if (!approval || approval.status !== "pending" ||
      row.state !== "pending")
      throw conflict("Freigabe ist nicht mehr offen oder wird noch verarbeitet.");
    if (approval.expiresAt && Date.parse(approval.expiresAt) <= this.now()) throw conflict("Freigabe ist abgelaufen.");
    const dispatchToken = randomUUID();
    const decidedAt = new Date(this.now()).toISOString();
    const approved: Approval = { ...approval, status: "approved", version: approval.version + 1,
      updatedAt: decidedAt, decidedAt, decidedBy: actor,
      executionResult: "Ausfuehrung gestartet; das Ergebnis ist noch nicht bestaetigt." };
    const reserved = this.db.prepare("UPDATE native_approval_requests SET state = 'dispatching', dispatch_token = ?, result_json = ?, updated_at = ? WHERE owner_id = ? AND request_key = ? AND state = 'pending' AND updated_at = ?")
      .run(dispatchToken, JSON.stringify({ ...result, approval: approved }), this.now(), ownerId, row.request_key, row.updated_at);
    if (reserved.changes !== 1) throw conflict("Freigabe wird bereits verarbeitet.");
    try {
      const action = JSON.parse(row.action_json) as NativeExecutableAction;
      if (action.kind !== "task.create") throw conflict("Aktion ist nicht ausfuehrbar.");
      const taskId = await dispatch(action, `native-approval:${approvalId}`);
      const completed: Approval = { ...approved, status: "executed", version: approved.version + 1,
        updatedAt: new Date(this.now()).toISOString(), executionResult: `Aufgabe ${taskId} angelegt.` };
      const written = this.db.prepare("UPDATE native_approval_requests SET state = 'completed', result_json = ?, receipt_json = ?, updated_at = ? WHERE owner_id = ? AND request_key = ? AND state = 'dispatching' AND dispatch_token = ?")
        .run(JSON.stringify({ ...result, approval: completed }), JSON.stringify({ taskId }), this.now(), ownerId, row.request_key, dispatchToken);
      if (written.changes !== 1) throw conflict("Der Ausfuehrungsbeleg konnte nicht gesichert werden.");
      return completed;
    } catch (error) {
      const uncertain: Approval = { ...approved, updatedAt: new Date(this.now()).toISOString(),
        executionResult: "Ausfuehrung unklar. Bitte Aufgabe und Adapter pruefen; nicht erneut freigeben." };
      this.db.prepare("UPDATE native_approval_requests SET state = 'uncertain', result_json = ?, updated_at = ? WHERE owner_id = ? AND request_key = ? AND state = 'dispatching' AND dispatch_token = ?")
        .run(JSON.stringify({ ...result, approval: uncertain }), this.now(), ownerId, row.request_key, dispatchToken);
      throw error;
    }
  }

  reject(ownerId: string, approvalId: string, actor: Actor, comment: string | null): Approval {
    const row = this.db.prepare("SELECT request_key, result_json, state FROM native_approval_requests WHERE owner_id = ? AND json_extract(result_json, '$.approval.id') = ?")
      .get(ownerId, approvalId) as { request_key: string; result_json: string; state: string } | undefined;
    if (!row) throw conflict("Freigabe ist nicht mehr vorhanden.");
    const result = JSON.parse(row.result_json) as CapturedApprovalPolicy;
    const approval = result.approval;
    if (!approval || approval.status !== "pending" || row.state !== "pending") throw conflict("Freigabe ist nicht mehr offen.");
    if (approval.expiresAt && Date.parse(approval.expiresAt) <= this.now()) throw conflict("Freigabe ist abgelaufen.");
    const decidedAt = new Date(this.now()).toISOString();
    const rejected: Approval = { ...approval, status: "rejected", version: approval.version + 1, updatedAt: decidedAt,
      decidedAt, decidedBy: actor, decisionComment: comment };
    const updated = this.db.prepare("UPDATE native_approval_requests SET state = 'rejected', result_json = ?, updated_at = ? WHERE owner_id = ? AND request_key = ? AND state = 'pending'")
      .run(JSON.stringify({ ...result, approval: rejected }), this.now(), ownerId, row.request_key);
    if (updated.changes !== 1) throw conflict("Freigabe wurde bereits entschieden.");
    return rejected;
  }
}
