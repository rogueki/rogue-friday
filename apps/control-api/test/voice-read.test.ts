import { expect, it } from "vitest";
import { startTestApi } from "./helpers";

const path = "/api/v1/voice/read";

it("answers allowlisted reads for the voice bridge, keeps the rest in the dashboard and never echoes the bridge key", async () => {
  const api = await startTestApi({ dataMode: "mock", authMode: "local", ownerPassword: "synthetic-test-password",
    responseValidation: "throw" });
  try {
    const voice = api.client();
    const owner = api.client();
    expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
    const key = api.runtime.voiceBridgeKey.toString("base64");
    const headers = { authorization: `Bearer ${key}` };

    // A dashboard session with a CSRF token is still not the local voice bridge.
    const dashboard = await owner.post(path, { text: "Zeige die Voice-Einstellungen" });
    expect(dashboard.statusCode, dashboard.body).toBe(403);

    const settings = await voice.post(path, { text: "Zeige die Voice-Einstellungen" }, { headers });
    expect(settings.statusCode, settings.body).toBe(200);
    const settingsData = settings.json().data;
    expect(settingsData.status).toBe("answered");
    expect(settingsData.kind).toBe("settings.get");
    expect(settingsData.answer.length).toBeGreaterThan(0);
    expect(settingsData.answer).not.toContain(key);

    const audit = await voice.post(path, { text: "Zeige das Audit-Log" }, { headers });
    expect(audit.statusCode, audit.body).toBe(200);
    expect(audit.json().data.status).toBe("unsupported");
    expect(audit.json().data.kind).toBe("audit.list");

    const joke = await voice.post(path, { text: "Erzähl einen Witz" }, { headers });
    expect(joke.statusCode, joke.body).toBe(200);
    expect(joke.json().data.status).toBe("unsupported");
    expect(joke.json().data.kind).toBe(null);

    // Without a dashboard session the owner fallback of the reader id must still answer.
    const approvals = await voice.post(path, { text: "Zeige offene Freigaben" }, { headers });
    expect(approvals.statusCode, approvals.body).toBe(200);
    const approvalsData = approvals.json().data;
    expect(approvalsData.status).toBe("answered");
    expect(approvalsData.kind).toBe("approvals.list");
    expect(approvalsData.answer.length).toBeGreaterThan(0);
    expect(approvalsData.answer).not.toContain(key);
  } finally { await api.close(); }
});

it("refuses non-allowlisted reads for a sessionless voice bridge on any route", async () => {
  const { executeReadQuery } = await import("../src/services/read-query-intent");
  const ctx = { principal: null, voiceBridgeAuthorized: true } as unknown as Parameters<typeof executeReadQuery>[0];
  await expect(executeReadQuery(ctx, { kind: "audit.list" })).rejects.toMatchObject({ code: "FORBIDDEN" });
});
