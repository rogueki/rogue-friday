import { expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";

const path = "/api/v1/settings/hermes-config";
const cronPath = "/api/v1/settings/hermes-cron/jobs";

it("lists redacted native Hermes cron metadata for the owner", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const read = vi.spyOn(api.runtime.hermesConfig, "cronJobs").mockResolvedValue({
      sourceRevision: "d923a5eb487a17c0a68801bba9ef0f56c81040a8",
      profile: "default", profileTimezone: "UTC",
      storeRevision: "a".repeat(64), count: 1, truncated: false, schedulerRunning: null,
      jobs: [{ id: "job-1", name: "Morning", schedule: "09:00 UTC", timezone: "UTC",
        enabled: true, state: "scheduled", nextRunAt: null, lastRunAt: null }],
    });
    const owner = api.client();
    const viewer = api.client();
    await owner.loginDev("owner");
    await viewer.loginDev("viewer");
    expect((await api.client().get(cronPath)).statusCode).toBe(401);
    expect((await viewer.get(cronPath)).statusCode).toBe(403);
    const result = await owner.get(cronPath);
    expect(result.statusCode).toBe(200);
    expect(result.json().data.jobs[0].name).toBe("Morning");
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    await api.close();
  }
});
const status = {
  installed: true as const,
  sourceRevision: "d923a5eb487a17c0a68801bba9ef0f56c81040a8",
  revision: 123,
  checkedAt: new Date().toISOString(),
  fields: [
    {
      key: "agent.max_turns",
      type: "integer" as const,
      family: "agent" as const,
      consumer: "new Hermes agent run" as const,
      value: 500,
      explicit: true,
      writable: true,
      verification: "unverified" as const,
      reasonCode: "runtime_receipt_unavailable" as const,
    },
  ],
  secretStates: [{ key: "model.api_key" as const, configFileSet: false, effectiveConfigured: null }],
  families: [
    {
      id: "agent",
      roots: ["agent"],
      followup: "P7-C",
      installed: null,
      enabled: null,
      configFileSet: true,
      configured: null,
      available: null,
      authenticated: null,
      needsSetup: null,
      unsupported: null,
      coverage: "followup" as const,
    },
  ],
  skills: [
    {
      id: "hermes-agent",
      installed: true as const,
      enabled: true,
      configured: null,
      authenticated: null,
      available: null,
      needsSetup: null,
      unsupported: null,
    },
  ],
  plugins: [],
  mcpComplete: true,
  mcpServers: [],
  inventory: { scope: "profile" as const, skillsComplete: true, pluginsComplete: true, modelProvidersComplete: true, reasons: [] },
  modelProviders: [],
  write: null,
};

it("enforces owner, CSRF, If-Match and typed allowlist while returning unverified readback", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const read = vi.spyOn(api.runtime.hermesConfig, "status").mockResolvedValue(status);
    const update = vi
      .spyOn(api.runtime.hermesConfig, "update")
      .mockResolvedValue({
        ...status,
        fields: [{ ...status.fields[0]!, value: 600 }],
        revision: 124,
        write: {
          key: "agent.max_turns",
          persisted: true,
          applied: null,
          verification: "unverified",
          reasonCode: "runtime_receipt_unavailable",
        },
      } as never);
    const anonymous = api.client();
    const viewer = api.client();
    await viewer.loginDev("viewer");
    const owner = api.client();
    await owner.loginDev("owner");
    expect((await anonymous.get(path)).statusCode).toBe(401);
    expect((await viewer.get(path)).statusCode).toBe(403);
    expect((await owner.get(path)).statusCode).toBe(200);
    expect(read).toHaveBeenCalledTimes(1);
    const body = { key: "agent.max_turns", value: 600 };
    expect((await owner.patch(path, body, { headers: { "If-Match": "123" }, csrf: false })).statusCode).toBe(
      403,
    );
    expect((await owner.patch(path, body)).statusCode).toBe(422);
    expect(
      (
        await owner.patch(
          path,
          { key: "terminal.backend", value: "host" },
          { headers: { "If-Match": "123" } },
        )
      ).statusCode,
    ).toBe(422);
    expect((await viewer.patch(path, body, { headers: { "If-Match": "123" } })).statusCode).toBe(403);
    const saved = await owner.patch(path, body, { headers: { "If-Match": "123" } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().data.write).toEqual({
      key: "agent.max_turns",
      persisted: true,
      applied: null,
      verification: "unverified",
      reasonCode: "runtime_receipt_unavailable",
    });
    expect(update).toHaveBeenCalledWith(body, 123);
  } finally {
    await api.close();
  }
});

it("accepts only the owner credential allowlist and never echoes a model secret", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const update = vi.spyOn(api.runtime.hermesConfig, "updateCredential").mockResolvedValue({
      ...status,
      revision: 124,
      secretStates: [{ key: "OPENROUTER_API_KEY", configFileSet: true, effectiveConfigured: null }],
      write: { key: "OPENROUTER_API_KEY", persisted: true, applied: null,
        verification: "unverified", reasonCode: "runtime_receipt_unavailable" },
    } as never);
    const owner = api.client();
    await owner.loginDev("owner");
    const viewer = api.client();
    await viewer.loginDev("viewer");
    const body = { key: "OPENROUTER_API_KEY", value: "CANARY-PRIVATE-MODEL-KEY" };
    expect((await viewer.patch(path, body, { headers: { "If-Match": "123" } })).statusCode).toBe(403);
    expect((await owner.patch(path, body, { headers: { "If-Match": "123" }, csrf: false })).statusCode).toBe(403);
    expect((await owner.patch(path, { key: "EXA_API_KEY", value: "CANARY" },
      { headers: { "If-Match": "123" } })).statusCode).toBe(422);
    const saved = await owner.patch(path, body, { headers: { "If-Match": "123" } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.body).not.toContain(body.value);
    expect(update).toHaveBeenCalledWith(body, 123);
  } finally {
    await api.close();
  }
});

it("restricts MCP setup to owner, CSRF, revision and typed HTTPS endpoint", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const update = vi.spyOn(api.runtime.hermesConfig, "updateMcp").mockResolvedValue({ ...status,
      revision: 124, mcpServers: [{ id: "example", transport: "http", enabled: true,
        endpoint: "https://example.org", editable: true, authMode: "none", credentialConfigured: null }],
      write: { key: "mcp:example", persisted: true, applied: null,
        verification: "unverified", reasonCode: "runtime_receipt_unavailable" },
    } as never);
    const owner = api.client();
    await owner.loginDev("owner");
    const viewer = api.client();
    await viewer.loginDev("viewer");
    const body = { key: "mcp.httpServer", name: "example", url: "https://example.org/mcp", enabled: true };
    expect((await viewer.patch(path, body, { headers: { "If-Match": "123" } })).statusCode).toBe(403);
    expect((await owner.patch(path, body, { headers: { "If-Match": "123" }, csrf: false })).statusCode).toBe(403);
    expect((await owner.patch(path, body)).statusCode).toBe(422);
    expect((await owner.patch(path, { ...body, url: "http://127.0.0.1/mcp" },
      { headers: { "If-Match": "123" } })).statusCode).toBe(422);
    const saved = await owner.patch(path, body, { headers: { "If-Match": "123" } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().data.write).toMatchObject({ key: "mcp:example", persisted: true, applied: null });
    expect(update).toHaveBeenCalledWith(body, 123);
  } finally {
    await api.close();
  }
});

it("restricts MCP lifecycle to the owner, CSRF and matching revision", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const update = vi.spyOn(api.runtime.hermesConfig, "activateMcp").mockResolvedValue({ ...status,
      revision: 124, mcpServers: [{ id: "example", transport: "http", enabled: false,
        endpoint: "https://example.org", editable: true, authMode: "none", credentialConfigured: null }],
      write: { key: "mcp:example", persisted: true, applied: null,
        verification: "unverified", reasonCode: "runtime_receipt_unavailable" },
    } as never);
    const owner = api.client();
    await owner.loginDev("owner");
    const viewer = api.client();
    await viewer.loginDev("viewer");
    const body = { key: "mcp.activation", name: "example", enabled: false };
    expect((await viewer.patch(path, body, { headers: { "If-Match": "123" } })).statusCode).toBe(403);
    expect((await owner.patch(path, body, { headers: { "If-Match": "123" }, csrf: false })).statusCode).toBe(403);
    expect((await owner.patch(path, body)).statusCode).toBe(422);
    const saved = await owner.patch(path, body, { headers: { "If-Match": "123" } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().data.write).toMatchObject({ key: "mcp:example", persisted: true, applied: null });
    expect(update).toHaveBeenCalledWith(body, 123);
  } finally {
    await api.close();
  }
});

it("keeps MCP Bearer writes owner-only, versioned and absent from responses", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const update = vi.spyOn(api.runtime.hermesConfig, "updateMcpBearer").mockResolvedValue({ ...status,
      revision: 124, mcpServers: [{ id: "example", transport: "http", enabled: true,
        endpoint: "https://example.org", editable: false, authMode: "bearer", credentialConfigured: true }],
      write: { key: "mcp:example", persisted: true, applied: null,
        verification: "unverified", reasonCode: "runtime_receipt_unavailable" },
    } as never);
    const owner = api.client();
    await owner.loginDev("owner");
    const viewer = api.client();
    await viewer.loginDev("viewer");
    const body = { key: "mcp.bearerCredential", name: "example", token: "CANARY-MCP-PRIVATE" };
    expect((await viewer.patch(path, body, { headers: { "If-Match": "123" } })).statusCode).toBe(403);
    expect((await owner.patch(path, body, { headers: { "If-Match": "123" }, csrf: false })).statusCode).toBe(403);
    expect((await owner.patch(path, body)).statusCode).toBe(422);
    const saved = await owner.patch(path, body, { headers: { "If-Match": "123" } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.body).not.toContain(body.token);
    expect(update).toHaveBeenCalledWith(body, 123);
  } finally {
    await api.close();
  }
});

it("restricts MCP network probe to owner, CSRF and a versioned configured name", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const probe = vi.spyOn(api.runtime.hermesConfig, "probeMcp").mockResolvedValue({
      name: "example", revision: 123, checkedAt: new Date().toISOString(), connected: true,
      toolCount: 2, toolCountComplete: true, failureClass: null, runtimeApplied: null,
    });
    const owner = api.client();
    await owner.loginDev("owner");
    const viewer = api.client();
    await viewer.loginDev("viewer");
    const path = "/api/v1/settings/hermes-config/mcp-probe";
    expect((await viewer.post(path, { name: "example" }, { headers: { "If-Match": "123" } })).statusCode).toBe(403);
    expect((await owner.post(path, { name: "example" }, { headers: { "If-Match": "123" }, csrf: false })).statusCode).toBe(403);
    expect((await owner.post(path, { name: "example" })).statusCode).toBe(422);
    expect((await owner.post(path, { name: "bad/path" }, { headers: { "If-Match": "123" } })).statusCode).toBe(422);
    const checked = await owner.post(path, { name: "example" }, { headers: { "If-Match": "123" } });
    expect(checked.statusCode, checked.body).toBe(200);
    expect(checked.json().data).toMatchObject({ connected: true, toolCount: 2, runtimeApplied: null });
    expect(probe).toHaveBeenCalledWith("example", 123);
  } finally {
    await api.close();
  }
});

it("restricts MCP OAuth start, poll and cancel to owner intent and keeps token material out of responses", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const manage = vi.spyOn(api.runtime.hermesConfig, "manageMcpOAuth").mockResolvedValue({
      flowId: "a".repeat(32), status: "awaiting_approval",
      authorizationUrl: "https://auth.example.org/authorize?state=sample", revision: null,
      failureClass: null, runtimeApplied: null,
    });
    const owner = api.client();
    await owner.loginDev("owner");
    const viewer = api.client();
    await viewer.loginDev("viewer");
    const path = "/api/v1/settings/hermes-config/mcp-oauth";
    const body = { action: "start", name: "example" };
    expect((await viewer.post(path, body, { headers: { "If-Match": "123" } })).statusCode).toBe(403);
    expect((await owner.post(path, body, { headers: { "If-Match": "123" }, csrf: false })).statusCode).toBe(403);
    expect((await owner.post(path, body)).statusCode).toBe(422);
    expect((await owner.post(path, { action: "start", name: "../bad" },
      { headers: { "If-Match": "123" } })).statusCode).toBe(422);
    const started = await owner.post(path, body, { headers: { "If-Match": "123" } });
    expect(started.statusCode, started.body).toBe(200);
    expect(started.json().data).toMatchObject({ status: "awaiting_approval", runtimeApplied: null });
    expect(started.body).not.toContain("access_token");
    expect(manage).toHaveBeenCalledWith(body, 123, expect.any(String));
    expect((await owner.post(path, { action: "status", flowId: "a".repeat(32) },
      { headers: { "If-Match": "123" } })).statusCode).toBe(200);
    expect((await owner.post(path, { action: "cancel", flowId: "a".repeat(32) },
      { headers: { "If-Match": "123" } })).statusCode).toBe(200);
  } finally {
    await api.close();
  }
});

it("serves the model picker only to the owner and keeps catalog proof distinct from model access", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const read = vi.spyOn(api.runtime.hermesConfig, "modelCatalog").mockImplementation(async (providerId) => ({
      sourceRevision: status.sourceRevision,
      checkedAt: new Date().toISOString(),
      providerListComplete: null,
      providers: [{ id: "openai-api", label: "OpenAI API" }],
      selected: providerId ? { id: providerId, models: ["gpt-test"],
        origin: "endpoint_confirmed_picker" as const, probeStatus: "succeeded" as const, modelAccess: null } : null,
    }));
    const anonymous = api.client();
    const viewer = api.client();
    await viewer.loginDev("viewer");
    const owner = api.client();
    await owner.loginDev("owner");
    const route = "/api/v1/settings/hermes-model-catalog";
    expect((await anonymous.get(route)).statusCode).toBe(401);
    expect((await viewer.get(route)).statusCode).toBe(403);
    expect((await owner.get(`${route}?providerId=unsafe%3Bvalue`)).statusCode).toBe(400);
    const offered = await owner.get(route);
    expect(offered.statusCode, offered.body).toBe(200);
    expect(offered.json().data.selected).toBeNull();
    const probed = await owner.get(`${route}?providerId=openai-api`);
    expect(probed.statusCode, probed.body).toBe(200);
    expect(probed.json().data.selected).toMatchObject({ probeStatus: "succeeded", modelAccess: null });
    expect(read).toHaveBeenCalledWith("openai-api");
  } finally {
    await api.close();
  }
});

it("requires owner intent, CSRF and revision for installed-plugin activation", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const update = vi.spyOn(api.runtime.hermesConfig, "updatePlugin").mockResolvedValue({ ...status,
      revision: 124, write: { key: "plugin:kanban", persisted: true, applied: null,
        verification: "unverified", reasonCode: "runtime_receipt_unavailable" },
    } as never);
    const viewer = api.client();
    await viewer.loginDev("viewer");
    const owner = api.client();
    await owner.loginDev("owner");
    const body = { key: "plugin.activation", pluginId: "kanban", enabled: true };
    expect((await viewer.patch(path, body, { headers: { "If-Match": "123" } })).statusCode).toBe(403);
    expect((await owner.patch(path, body, { headers: { "If-Match": "123" }, csrf: false })).statusCode).toBe(403);
    expect((await owner.patch(path, body)).statusCode).toBe(422);
    expect((await owner.patch(path, { ...body, pluginId: "../bad" }, { headers: { "If-Match": "123" } })).statusCode).toBe(422);
    const saved = await owner.patch(path, body, { headers: { "If-Match": "123" } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().data.write).toMatchObject({ key: "plugin:kanban", persisted: true, applied: null });
    expect(update).toHaveBeenCalledWith(body, 123);
  } finally {
    await api.close();
  }
});
