import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

describe("read-only command intents use local read services", () => {
  let api: TestApi;
  let owner: ApiClient;
  let operator: ApiClient;
  let viewer: ApiClient;
  let privateActivityId: string;

  beforeAll(async () => {
    api = await startTestApi();
    owner = api.client();
    operator = api.client();
    viewer = api.client();
    await owner.loginDev("owner");
    await operator.loginDev("operator");
    await viewer.loginDev("viewer");
    privateActivityId = api.runtime.world!.logActivity({
      kind: "system",
      title: "PRIVATE_ACTIVITY_TITLE_MUST_NOT_LEAK",
      summary: "PRIVATE_ACTIVITY_SUMMARY_MUST_NOT_LEAK",
      correlationId: `corr_${"c".repeat(26)}`,
    }).id;
  });

  afterAll(async () => { await api.close(); });

  const run = async (client: ApiClient, text: string) => client.post("/api/v1/commands", { text, source: "text" });

  it("reads real activity results through a typed query, emits only metadata and redacts command storage", async () => {
    const direct = await operator.get("/api/v1/activity", { query: { limit: "5" } });
    expect(direct.statusCode).toBe(200);
    const response = await run(operator, "Zeige aktuelle Activity-Ereignisse");
    expect(response.statusCode, response.body).toBe(200);
    const message = response.json().result.message as string;
    expect(message).toContain(privateActivityId);
    expect(message).not.toContain("PRIVATE_ACTIVITY_TITLE_MUST_NOT_LEAK");
    expect(message).not.toContain("PRIVATE_ACTIVITY_SUMMARY_MUST_NOT_LEAK");
    expect(api.runtime.stores.commands.recent(1)[0]).toMatchObject({ text: "[REDACTED]", redacted: true });
    const audit = api.runtime.stores.audit.recent(1)[0]!;
    expect(audit.action).toBe("command.executed");
    expect(JSON.stringify(audit.context)).not.toContain("aktuelle Activity-Ereignisse");
    expect(JSON.stringify(audit.context)).not.toContain("PRIVATE_ACTIVITY");
    expect(direct.json().items.some((event: { id: string }) => event.id === privateActivityId)).toBe(true);
  });

  it("returns notification and approval IDs from their authoritative list operations", async () => {
    const notifications = await operator.get("/api/v1/notifications", { query: { limit: "5", status: ["open"] } });
    expect(notifications.statusCode).toBe(200);
    const notificationResponse = await run(operator, "Zeige offene Meldungen");
    expect(notificationResponse.statusCode, notificationResponse.body).toBe(200);
    const notificationMessage = notificationResponse.json().result.message as string;
    for (const item of notifications.json().items.slice(0, 5)) expect(notificationMessage).toContain(item.id);
    for (const item of notifications.json().items.slice(0, 5)) {
      expect(notificationMessage).not.toContain(item.title);
      expect(notificationMessage).not.toContain(item.body);
    }

    const approvals = await operator.get("/api/v1/approvals", { query: { limit: "5", status: ["pending"] } });
    expect(approvals.statusCode).toBe(200);
    const approvalResponse = await run(operator, "Liste ausstehende Freigaben");
    expect(approvalResponse.statusCode, approvalResponse.body).toBe(200);
    const approvalMessage = approvalResponse.json().result.message as string;
    for (const item of approvals.json().items.slice(0, 5)) {
      expect(approvalMessage).toContain(item.id);
      expect(approvalMessage).not.toContain(item.action);
      expect(approvalMessage).not.toContain(item.rationale);
    }
  });

  it("matches approval-list ordering and keeps native approval details owner-scoped", async () => {
    const ownerId = api.runtime.auth.issueDevSession("owner").principal.userId;
    const proposed = api.runtime.nativeApprovals.propose({
      ownerId,
      requestKey: "nlp-owner-scope-test",
      correlationId: `corr_${"o".repeat(26)}`,
      riskTier: 3,
      type: "system_change",
      action: "PRIVATE_NATIVE_APPROVAL_ACTION",
      rationale: "PRIVATE_NATIVE_APPROVAL_RATIONALE",
      preview: { kind: "text", title: "private test", body: "private approval preview" },
      impacts: [],
      execution: { kind: "task.cancel", id: `task_${"t".repeat(26)}` },
    });
    const id = proposed.approval?.id;
    expect(id).toBeTruthy();
    api.runtime.nativeApprovals.confirm(ownerId, "nlp-owner-scope-test", { kind: "task.cancel", id: `task_${"t".repeat(26)}` });
    const ownerList = await owner.get("/api/v1/approvals", { query: { status: ["pending"], limit: "5" } });
    expect(ownerList.statusCode).toBe(200);
    expect(ownerList.json().items.some((item: { id: string }) => item.id === id)).toBe(true);
    const commandList = await run(owner, "Liste ausstehende Freigaben");
    expect(commandList.statusCode).toBe(200);
    expect(commandList.json().result.message).toContain(id);
    expect(commandList.json().result.message).not.toContain("PRIVATE_NATIVE_APPROVAL_ACTION");
    expect(commandList.json().result.message).not.toContain("PRIVATE_NATIVE_APPROVAL_RATIONALE");

    const directForeign = await operator.get(`/api/v1/approvals/${id}`);
    const commandForeign = await run(operator, `Zeige Freigabe ${id}`);
    expect(commandForeign.statusCode).toBe(directForeign.statusCode);
    expect(commandForeign.statusCode).not.toBe(200);
    expect(commandForeign.body).not.toContain("PRIVATE_NATIVE_APPROVAL_ACTION");
    expect(commandForeign.body).not.toContain("PRIVATE_NATIVE_APPROVAL_RATIONALE");
  });

  it("respects the audit GET role and keeps private event fields out of command results", async () => {
    const denied = await run(operator, "Show recent audit events");
    expect(denied.statusCode).toBe(200);
    expect((await operator.get("/api/v1/audit/events")).statusCode).toBe(200);

    const direct = await owner.get("/api/v1/audit/events", { query: { limit: "5" } });
    expect(direct.statusCode).toBe(200);
    const response = await run(operator, "Show recent audit events");
    expect(response.statusCode, response.body).toBe(200);
    const message = response.json().result.message as string;
    for (const item of direct.json().items.slice(0, 5)) expect(message).toContain(item.id);
    expect(message).not.toContain('"before"');
    expect(message).not.toContain('"after"');
    expect(message).not.toContain('"context"');
    expect((await viewer.get("/api/v1/audit/events")).statusCode).toBe(200);
    expect((await run(viewer, "Show recent audit events")).statusCode).toBe(403);
    expect((await operator.get("/api/v1/audit/export")).statusCode).toBe(403);
    expect((await run(operator, "Export audit events")).statusCode).toBe(403);
    expect((await run(owner, "Export audit events")).json()).toMatchObject({ status: "rejected" });
  });

  it("does not invent notification detail reads and rejects viewer command access", async () => {
    const notificationId = `ntf_${"x".repeat(26)}`;
    const unsupported = await run(operator, `Show notification ${notificationId}`);
    expect(unsupported.statusCode).toBe(200);
    expect(unsupported.json()).toMatchObject({ status: "rejected", result: { message: expect.stringContaining("keine Detail-Leseoperation") } });
    expect((await viewer.get("/api/v1/activity")).statusCode).toBe(200);
    expect((await run(viewer, "Zeige Activity")).statusCode).toBe(403);
  });
});
