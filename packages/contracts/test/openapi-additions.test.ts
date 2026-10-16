import { describe, expect, it } from "vitest";
import path from "node:path";
import { paths, readJson, readYaml } from "../scripts/lib/contract.mjs";

type Header = { $ref?: string };
type Operation = {
  operationId: string;
  "x-capability"?: string;
  parameters?: Array<{ $ref?: string }>;
  responses: Record<string, { headers?: Record<string, Header>; content?: Record<string, unknown> } | { $ref: string }>;
  "x-required-role"?: string;
  "x-max-body-bytes"?: number;
};
const doc = readYaml(paths.openapi) as { paths: Record<string, Record<string, Operation>>; components: { headers: Record<string, unknown> } };
const operations = Object.entries(doc.paths).flatMap(([path, item]) =>
  Object.entries(item)
    .filter(([method]) => ["get", "post", "put", "patch", "delete"].includes(method))
    .map(([method, op]) => ({ path, method, op })),
);

describe("Idempotent-Replayed response header", () => {
  const idempotent = operations.filter(({ op }) => (op.parameters ?? []).some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"));

  it("is declared in components.headers", () => {
    expect(doc.components.headers.IdempotentReplayed).toBeDefined();
  });

  it("is declared on every success response of every operation that accepts an Idempotency-Key", () => {
    expect(idempotent.length).toBeGreaterThanOrEqual(24);
    const missing: string[] = [];
    for (const { op } of idempotent) {
      const successes = Object.entries(op.responses).filter(([status]) => /^2\d\d$/.test(status));
      expect(successes.length, op.operationId).toBeGreaterThan(0);
      for (const [status, response] of successes) {
        const header = (response as { headers?: Record<string, Header> }).headers?.["Idempotent-Replayed"];
        if (header?.$ref !== "#/components/headers/IdempotentReplayed") missing.push(`${op.operationId} ${status}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("is declared nowhere else (operations without an Idempotency-Key never replay)", () => {
    const idempotentIds = new Set(idempotent.map(({ op }) => op.operationId));
    const stray = operations
      .filter(({ op }) => !idempotentIds.has(op.operationId))
      .filter(({ op }) => Object.values(op.responses).some((response) => "headers" in response && response.headers && "Idempotent-Replayed" in response.headers))
      .map(({ op }) => op.operationId);
    expect(stray).toEqual([]);
  });
});

describe("observability operations (PLAN §50.3)", () => {
  const find = (operationId: string) => operations.find(({ op }) => op.operationId === operationId);

  it("getMetrics: GET /api/v1/metrics, owner only, Prometheus text", () => {
    const metrics = find("getMetrics");
    expect(metrics).toMatchObject({ path: "/api/v1/metrics", method: "get" });
    expect(metrics?.op["x-required-role"]).toBe("owner");
    const ok = metrics?.op.responses["200"] as { content?: Record<string, unknown> };
    expect(Object.keys(ok.content ?? {})).toEqual(["text/plain"]);
  });

  it("submitFrontendTelemetry: POST /api/v1/telemetry/frontend, operator+, CSRF, size-limited, 202/413/429", () => {
    const telemetry = find("submitFrontendTelemetry");
    expect(telemetry).toMatchObject({ path: "/api/v1/telemetry/frontend", method: "post" });
    expect(telemetry?.op["x-required-role"]).toBe("operator");
    expect(telemetry?.op["x-max-body-bytes"]).toBe(32768);
    expect((telemetry?.op.parameters ?? []).map((parameter) => parameter.$ref)).toContain("#/components/parameters/CsrfToken");
    expect(Object.keys(telemetry?.op.responses ?? {})).toEqual(expect.arrayContaining(["202", "401", "403", "413", "422", "429"]));
  });

  it("the contract includes the 177 released operations", () => {
    expect(operations).toHaveLength(177);
  });

  it("marks owner telephony actions with a call capability", () => {
    for (const operationId of ["previewTelephonyCall", "originateTelephonyCall", "hangupTelephonyCall"]) {
      const operation = operations.find(({ op }) => op.operationId === operationId);
      expect(operation?.op["x-required-role"], operationId).toBe("owner");
      expect(operation?.op["x-capability"], operationId).toBe("telephony.call");
    }
  });
});

describe("operations that close the contract gaps", () => {
  const find = (operationId: string) => operations.find(({ op }) => op.operationId === operationId);
  const table: Array<[string, string, string, string, string]> = [
    // operationId, method, path, capability, minimum role
    ["renameFile", "patch", "/api/v1/files/{id}", "files.rename", "operator"],
    ["restartAdapter", "post", "/api/v1/adapters/{id}/restart", "system.restartAdapter", "owner"],
    ["getAdapterLogs", "get", "/api/v1/adapters/{id}/logs", "system.openLogs", "owner"],
    ["exportMemory", "get", "/api/v1/memory/export", "memory.export", "owner"],
    ["resolveMemoryConflict", "post", "/api/v1/memory/{id}/conflicts/{conflictId}/resolve", "memory.resolveConflict", "operator"],
    ["listAutomationVersions", "get", "/api/v1/automations/{id}/versions", "automations.versions", "viewer"],
    ["pauseAllAutomations", "post", "/api/v1/automations/pause-all", "automations.pauseAll", "operator"],
    ["listDrafts", "get", "/api/v1/communication/drafts", "communication.draft", "viewer"],
    ["enrollVoiceProfile", "post", "/api/v1/voice/profiles/{id}/enroll", "voice.enroll", "operator"],
    ["getVoiceEnrollment", "get", "/api/v1/voice/enrollments/{id}", "voice.enroll", "viewer"],
    ["deleteVoiceHistory", "delete", "/api/v1/voice/history", "voice.deleteHistory", "owner"],
    ["assignTask", "post", "/api/v1/tasks/{id}/assign", "agents.assignTask", "operator"],
    ["provideTaskInput", "post", "/api/v1/tasks/{id}/input", "tasks.input", "operator"],
  ];

  it.each(table)("%s: %s %s needs %s and at least the role %s", (operationId, method, path, capability, role) => {
    const found = find(operationId);
    expect(found, operationId).toMatchObject({ path, method });
    expect(found?.op["x-capability"]).toBe(capability);
    expect(found?.op["x-required-role"]).toBe(role);
  });

  it("only mutating operations that can be repeated by mistake accept an Idempotency-Key", () => {
    for (const id of ["restartAdapter", "resolveMemoryConflict", "pauseAllAutomations", "enrollVoiceProfile", "deleteVoiceHistory", "assignTask", "provideTaskInput"]) {
      expect(find(id)?.op.parameters?.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"), id).toBe(true);
    }
    for (const id of ["renameFile", "exportMemory", "getAdapterLogs", "listDrafts", "listAutomationVersions", "getVoiceEnrollment"]) {
      expect(find(id)?.op.parameters?.some((parameter) => parameter.$ref === "#/components/parameters/IdempotencyKey"), id).toBe(false);
    }
  });

  it("renameFile and resolveMemoryConflict use optimistic concurrency", () => {
    for (const id of ["renameFile", "resolveMemoryConflict", "assignTask", "provideTaskInput"]) {
      expect(find(id)?.op.parameters?.some((parameter) => parameter.$ref === "#/components/parameters/IfMatch"), id).toBe(true);
    }
  });

  it("enrollVoiceProfile answers 202 with the job, exportMemory serves JSON with a download header", () => {
    expect(Object.keys(find("enrollVoiceProfile")?.op.responses ?? {})).toContain("202");
    const exported = find("exportMemory")?.op.responses["200"] as { headers?: Record<string, unknown>; content?: Record<string, unknown> };
    expect(Object.keys(exported.content ?? {})).toEqual(["application/json"]);
    expect(exported.headers).toHaveProperty("Content-Disposition");
  });

  it("deleteVoiceHistory demands the confirmation as a required query parameter", () => {
    const params = find("deleteVoiceHistory")?.op.parameters as Array<{ name?: string; in?: string; required?: boolean }>;
    expect(params.find((parameter) => parameter.name === "confirm")).toMatchObject({ in: "query", required: true });
  });

  it("the capability document announces every new capability flag", () => {
    const capabilities = readJson(path.join(paths.schemas, "meta", "capabilities.schema.json")) as { $defs: Record<string, { properties: Record<string, unknown> }> };
    const expected: Record<string, string[]> = {
      TasksCapability: ["input"],
      MemoryCapability: ["export", "resolveConflict"],
      AutomationsCapability: ["versions"],
      FilesCapability: ["rename"],
      VoiceCapability: ["deleteHistory", "enroll"],
      SystemCapability: ["restartAdapter", "openLogs"],
      AgentsCapability: ["assignTask"],
    };
    for (const [def, flags] of Object.entries(expected)) for (const flag of flags) expect(capabilities.$defs[def]?.properties, `${def}.${flag}`).toHaveProperty(flag);
  });
});
