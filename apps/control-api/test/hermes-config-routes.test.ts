import { expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";

const path = "/api/v1/settings/hermes-config";
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
  inventory: { scope: "profile" as const, skillsComplete: true, pluginsComplete: true, reasons: [] },
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
