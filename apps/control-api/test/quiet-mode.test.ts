import { expect, it } from "vitest";
import { startTestApi } from "./helpers";

const path = "/api/v1/quiet-mode";

it("reads and writes quiet mode through the control API", async () => {
  const api = await startTestApi({ dataMode: "mock", authMode: "local", ownerPassword: "synthetic-test-password",
    responseValidation: "throw" });
  try {
    const owner = api.client();
    expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
    const read = await owner.get(path);
    expect(read.statusCode, read.body).toBe(200);
    expect(typeof read.json().data.active).toBe("boolean");

    const bridge = api.client();
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    const until = new Date(api.runtime.nowMs() + 30 * 60_000).toISOString();
    const set = await bridge.request("PUT", path, { body: { until }, headers });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().data.source).toBe("temporary");
    const afterSet = await bridge.get(path, { headers });
    expect(afterSet.statusCode, afterSet.body).toBe(200);
    expect(afterSet.json().data.active).toBe(true);

    const notice = await bridge.request("POST", `${path}/notices`, { body: { class: "agent_questions", title: "Rückfrage" }, headers });
    expect(notice.statusCode, notice.body).toBe(200);
    expect(notice.json().data.recorded).toBe(true);
    expect(notice.json().data.delivery).toBe("skipped");

    const summary = await bridge.get(`${path}/summary`, { headers });
    expect(summary.statusCode, summary.body).toBe(200);
    expect(summary.json().data.items).toHaveLength(1);
    expect(summary.json().data.items[0]?.title).toBe("Rückfrage");

    const invalid = await bridge.request("PUT", path, { body: { until: new Date(api.runtime.nowMs() - 60_000).toISOString() }, headers });
    expect(invalid.statusCode, invalid.body).toBe(422);

    const cleared = await owner.delete(path);
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().data.temporaryUntil).toBeNull();

    const schedule = await owner.request("PUT", `${path}/schedule`, { body: { enabled: true, from: "23:00", to: "06:30" } });
    expect(schedule.statusCode, schedule.body).toBe(200);

    const anonymous = api.client();
    const unauthorized = await anonymous.get(path);
    expect(unauthorized.statusCode).toBe(401);
  } finally { await api.close(); }
});

it("fills the quiet-mode defaults into notification settings saved before they existed", async () => {
  const api = await startTestApi({ dataMode: "mock", authMode: "local", ownerPassword: "synthetic-test-password" });
  try {
    const settings = api.runtime.settings;
    const { quietMode: _quietMode, importantClasses: _classes, quietTextTargetId: _target, ...legacy } = settings.area("notifications");
    settings.patch({ notifications: { ...legacy, quietHours: { enabled: true, from: "22:00", to: "07:00" } } });
    const area = settings.area("notifications");
    expect(area.quietHours).toEqual({ enabled: true, from: "22:00", to: "07:00", level: "silent", summaryAt: "first_interaction" });
    expect(area.quietMode).toEqual({ level: "silent" });
    expect(area.importantClasses).toEqual(["agent_questions", "approvals"]);
    expect(settings.get().notifications.quietTextTargetId).toBeNull();
  } finally { await api.close(); }
});

it("records a new pending approval for the summary while quiet, but not a draft", async () => {
  const api = await startTestApi({ dataMode: "mock", authMode: "local", ownerPassword: "synthetic-test-password" });
  try {
    const { runtime } = api;
    runtime.quietMode.set(new Date(runtime.nowMs() + 30 * 60_000).toISOString());
    const propose = (requestKey: string) => runtime.nativeApprovals.propose({ ownerId: "owner-one", requestKey,
      correlationId: `corr_${"A".repeat(26)}`, riskTier: 3, type: "send_message", action: "Nachricht versenden",
      rationale: "Synthetisch", preview: { kind: "message", title: "Nachricht", body: "Synthetischer Inhalt" }, impacts: [] });
    propose("quiet-draft-0001");
    await new Promise((resolve) => setImmediate(resolve));
    expect(runtime.quietMode.summary().items).toEqual([]);
    runtime.settings.patch({ approvals: { ...runtime.settings.area("approvals"), draftOnlyByDefault: false } });
    propose("quiet-pending-01");
    await new Promise((resolve) => setImmediate(resolve));
    expect(runtime.quietMode.summary().items).toMatchObject([{ class: "approvals", title: "Nachricht versenden", delivery: "skipped" }]);
  } finally { await api.close(); }
});
