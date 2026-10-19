import { createHash } from "node:crypto";
import { createId } from "@friday/observability";
import type { Approval, SchemaValidator } from "@friday/sdk";
import type { Db } from "../db/database";
import type { SettingsService } from "./settings";
import { conflict, validationFailed } from "../util/errors";

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
      sourceRef: input.sourceRef ?? null, editable: input.riskTier < 3,
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
      this.db.prepare("INSERT INTO native_approval_requests (owner_id, request_key, proposal_hash, result_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(input.ownerId, input.requestKey, hash, JSON.stringify(result), this.now());
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
}
