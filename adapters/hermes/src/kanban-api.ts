import type { CallContext, HttpRequest } from "@jarvis/adapter-core";
import type { AuthedClient } from "./clients";
import type { TaskRef } from "./ids";
import {
  parseBoard,
  parseBoards,
  parseDashboardHealth,
  parseProfiles,
  parseStatus,
  parseTask,
  parseTaskDetail,
  parseWorkers,
  asObject,
  type Json,
  type WireBoard,
  type WireBoardInfo,
  type WireDashboardHealth,
  type WireGatewayStatus,
  type WireProfile,
  type WireTask,
  type WireTaskDetail,
  type WireWorker,
} from "./wire";

const PLUGIN = "/api/plugins/kanban";

type CallInfo = Pick<CallContext, "correlationId" | "signal"> | undefined;

const extras = (call: CallInfo): Pick<HttpRequest, "correlationId" | "signal"> => ({
  ...(call?.correlationId ? { correlationId: call.correlationId } : {}),
  ...(call?.signal ? { signal: call.signal } : {}),
});

/** Typed access to the dashboard's Kanban plugin REST API (docs/MAPPING/hermes.md §4.3). */
export class KanbanApi {
  constructor(private readonly dashboard: AuthedClient) {}

  async boards(call?: CallInfo, options: { probe?: boolean } = {}): Promise<WireBoardInfo[]> {
    const response = await this.dashboard.request({
      method: "GET",
      path: `${PLUGIN}/boards`,
      operation: options.probe ? "healthCheck" : "listBoards",
      ...(options.probe ? { retry: false as const } : {}),
      ...extras(call),
    });
    return parseBoards(response.body);
  }

  async board(
    board: string,
    options: { includeArchived?: boolean; operation: string },
    call?: CallInfo,
  ): Promise<WireBoard> {
    const response = await this.dashboard.request({
      method: "GET",
      path: `${PLUGIN}/board`,
      query: { board, ...(options.includeArchived ? { include_archived: true } : {}) },
      operation: options.operation,
      ...extras(call),
    });
    return parseBoard(response.body);
  }

  async taskDetail(ref: TaskRef, operation: string, call?: CallInfo): Promise<WireTaskDetail> {
    const response = await this.dashboard.request({
      method: "GET",
      path: `${PLUGIN}/tasks/${encodeURIComponent(ref.taskId)}`,
      query: { board: ref.board },
      operation,
      ...extras(call),
    });
    return parseTaskDetail(response.body);
  }

  async createTask(
    board: string,
    body: Json,
    options: { idempotencyKey?: string | undefined },
    call: CallInfo,
  ): Promise<WireTask> {
    const response = await this.dashboard.request({
      method: "POST",
      path: `${PLUGIN}/tasks`,
      query: { board },
      body,
      operation: "createTask",
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...extras(call),
    });
    return parseTask(asObject(response.body, "createTask").task, "createTask.task");
  }

  async patchTask(
    ref: TaskRef,
    body: Json,
    options: { idempotencyKey?: string | undefined },
    call: CallInfo,
  ): Promise<WireTask> {
    const response = await this.dashboard.request({
      method: "PATCH",
      path: `${PLUGIN}/tasks/${encodeURIComponent(ref.taskId)}`,
      query: { board: ref.board },
      body,
      operation: "updateTask",
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...extras(call),
    });
    return parseTask(asObject(response.body, "updateTask").task, "updateTask.task");
  }

  /** Kanban-scoped profile list (`name, model, provider, description`). */
  async profiles(call?: CallInfo): Promise<WireProfile[]> {
    const response = await this.dashboard.request({
      method: "GET",
      path: `${PLUGIN}/profiles`,
      operation: "listProfiles",
      ...extras(call),
    });
    return parseProfiles(response.body);
  }

  /** Dashboard-wide profile list (`display_name, gateway_running, ...`). */
  async dashboardProfiles(call?: CallInfo): Promise<WireProfile[]> {
    const response = await this.dashboard.request({
      method: "GET",
      path: "/api/profiles",
      operation: "listAgents",
      ...extras(call),
    });
    return parseProfiles(response.body);
  }

  async workers(board: string, call?: CallInfo): Promise<WireWorker[]> {
    const response = await this.dashboard.request({
      method: "GET",
      path: `${PLUGIN}/workers/active`,
      query: { board },
      operation: "listWorkers",
      ...extras(call),
    });
    return parseWorkers(response.body);
  }

  async health(call?: CallInfo): Promise<WireDashboardHealth> {
    const response = await this.dashboard.requestPublic({
      method: "GET",
      path: "/api/health",
      operation: "healthCheck",
      retry: false,
      ...extras(call),
    });
    return parseDashboardHealth(response.body);
  }

  async status(call?: CallInfo): Promise<WireGatewayStatus> {
    const response = await this.dashboard.requestPublic({
      method: "GET",
      path: "/api/status",
      operation: "getStatus",
      ...extras(call),
    });
    return parseStatus(response.body);
  }
}
