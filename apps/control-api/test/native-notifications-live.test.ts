/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies that the contract validators check */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

const PASSWORD = "native-notifications-password";

// No notifications or approvals adapter and one task adapter whose upstream does not exist: the live situation of a
// fresh installation before Hermes answers.
const ADAPTERS = `allowlist:
  hermes-tasks: "@friday/adapter-hermes"
adapters:
  tasks:
    provider: hermes-tasks
    enabled: true
    timeoutMs: 800
    retry: { maxAttempts: 1, baseDelayMs: 50, maxDelayMs: 100 }
    circuitBreaker: { failureThreshold: 2, resetAfterMs: 500 }
    config:
      dashboardBaseUrl: http://127.0.0.1:9
      dashboardAuth: scrape
      boards: [default]
`;

async function waitFor<T>(load: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await load();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("Zeitüberschreitung beim Warten");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("native notifications in the live runtime", () => {
  const dir = mkdtempSync(join(tmpdir(), "friday-live-notifications-"));
  let api: TestApi;
  let owner: ApiClient;

  beforeAll(async () => {
    api = await startTestApi({ dir, dataMode: "live", authMode: "local", ownerPassword: PASSWORD, adaptersYaml: ADAPTERS,
      env: { FRIDAY_STORAGE_PATH: "/" }, healthIntervalMs: 200 });
    owner = api.client();
    expect((await owner.loginOwner(PASSWORD)).statusCode).toBe(200);
  });

  afterAll(async () => {
    await api?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const alerts = async (query: Record<string, string | string[]> = {}) => {
    const response = await owner.get("/api/v1/notifications", { query });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().items as any[];
  };

  it("lists Friday's own alerts instead of a missing capability and raises one for an unreachable service", async () => {
    const alert = await waitFor(async () => (await alerts()).find((item) => item.sourceRef?.id === "hermes-tasks"));
    expect(alert).toMatchObject({ priority: "P1", category: "adapter", status: "open", targetRoute: "/system",
      title: "Dienst nicht erreichbar: hermes-tasks" });
    expect(alert.escalation).toEqual([expect.objectContaining({ channel: "dashboard", state: "sent" })]);

    const overview = (await owner.get("/api/v1/overview")).json().data;
    const sections = overview.degradedSections.map((entry: { section: string }) => entry.section);
    expect(sections).not.toContain("Benachrichtigungen");
    expect(sections).not.toContain("Freigaben");
    // The unreachable service is already a degraded section; its alert must not show up a second time.
    expect(overview.attention.filter((item: any) => item.ref?.id === "hermes-tasks" || item.ref?.id === alert.id)).toHaveLength(1);
  });

  it("acknowledges, snoozes and resolves a native alert with version checks", async () => {
    const [alert] = await alerts({ category: "adapter" });
    const stale = await owner.post(`/api/v1/notifications/${alert.id}/acknowledge`, {}, { headers: { "if-match": String(alert.version + 3) } });
    expect(stale.statusCode, stale.body).toBe(409);

    const acknowledged = await owner.post(`/api/v1/notifications/${alert.id}/acknowledge`, {}, { headers: { "if-match": String(alert.version) } });
    expect(acknowledged.statusCode, acknowledged.body).toBe(200);
    expect(acknowledged.json().data).toMatchObject({ status: "acknowledged", acknowledged: true });
    expect((await owner.post(`/api/v1/notifications/${alert.id}/acknowledge`, {})).statusCode).toBe(409);

    const snoozed = await owner.post(`/api/v1/notifications/${alert.id}/snooze`, { durationMinutes: 15 });
    expect(snoozed.statusCode, snoozed.body).toBe(200);
    expect(snoozed.json().data.status).toBe("snoozed");

    const resolved = await owner.post(`/api/v1/notifications/${alert.id}/resolve`, {});
    expect(resolved.statusCode, resolved.body).toBe(200);
    expect(resolved.json().data).toMatchObject({ status: "resolved", resolved: true });
    expect((await alerts({ status: ["open"] })).some((item) => item.id === alert.id)).toBe(false);
  });

  it("raises an alert for a native approval and closes it with the decision", async () => {
    const text = "Trage Benachrichtigungsprobe morgen 14 Uhr ein";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.json().status, preview.body).toBe("requires_confirmation");
    const confirmed = await owner.post("/api/v1/commands", { text, source: "text", confirm: true, previewId: preview.json().previewId });
    expect(confirmed.json().status, confirmed.body).toBe("requires_approval");
    const approvalId = confirmed.json().approvalId as string;

    const alert = (await alerts({ category: "approval" })).find((item) => item.sourceRef?.id === approvalId);
    expect(alert).toMatchObject({ status: "open", targetRoute: `/approvals?approval=${approvalId}` });
    expect(alert.title).toMatch(/^Freigabe nötig: /);
    // Tier 3 raises the alert as P1, which the attention zone lists; the approval item must still appear only once.
    api.runtime.nativeNotifications.raise({ priority: "P1", category: "approval", title: alert.title, body: alert.body,
      sourceRef: alert.sourceRef, targetRoute: alert.targetRoute });
    const overview = (await owner.get("/api/v1/overview")).json().data;
    expect(overview.attention.filter((item: any) => item.ref?.id === approvalId || item.ref?.id === alert.id)).toHaveLength(1);

    const rejected = await owner.post(`/api/v1/approvals/${approvalId}/reject`, { comment: "Nur ein Test." });
    expect(rejected.statusCode, rejected.body).toBe(200);
    const closed = (await alerts({ category: "approval" })).find((item) => item.id === alert.id);
    expect(closed).toMatchObject({ status: "resolved", resolved: true });
  });
});
