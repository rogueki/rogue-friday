import { expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";

const body = {
  protocol: "imap" as const,
  host: "imap.beispiel.example",
  port: 993,
  security: "tls" as const,
  username: "test@beispiel.example",
  password: "synthetisches-testpasswort",
};

it("tests an unsaved candidate once, reports the reason and stores nothing", async () => {
  const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password", responseValidation: "throw" });
  try {
    const candidate = vi.spyOn(api.runtime.mailAccounts, "checkCandidate")
      .mockResolvedValue({ ok: false, reason: "auth" });
    const upsert = vi.spyOn(api.runtime.mailAccounts, "upsert");
    const owner = api.client();
    await owner.loginOwner("synthetic-test-password");

    const response = await owner.post("/api/v1/settings/mail-connection-test", body);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().data).toEqual({ ok: false, reason: "auth" });
    expect(candidate).toHaveBeenCalledTimes(1);
    const [account, protocol, password] = candidate.mock.calls[0] ?? [];
    expect(protocol).toBe("imap");
    expect(password).toBe(body.password);
    expect(account).toMatchObject({ imapHost: body.host, imapPort: body.port, imapLogin: body.username,
      smtpHost: body.host, smtpPort: body.port, smtpLogin: body.username, authMode: "password" });
    expect(upsert).not.toHaveBeenCalled();
  } finally { await api.close(); }
});

it("answers every reason the wizard can explain, including a TLS and a network failure", async () => {
  const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password", responseValidation: "throw" });
  try {
    const candidate = vi.spyOn(api.runtime.mailAccounts, "checkCandidate");
    const owner = api.client();
    await owner.loginOwner("synthetic-test-password");
    for (const reason of ["ok", "auth", "tls", "network", "protocol"] as const) {
      candidate.mockResolvedValueOnce({ ok: reason === "ok", reason });
      const response = await owner.post("/api/v1/settings/mail-connection-test", { ...body, protocol: "smtp", port: 587, security: "start-tls" });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data).toEqual({ ok: reason === "ok", reason });
    }
    expect(candidate).toHaveBeenCalledTimes(5);
  } finally { await api.close(); }
});

it("rejects invalid connection data and non-owner roles before any connection is attempted", async () => {
  const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password", responseValidation: "throw" });
  try {
    const candidate = vi.spyOn(api.runtime.mailAccounts, "checkCandidate");
    const owner = api.client();
    await owner.loginOwner("synthetic-test-password");

    for (const invalid of [
      { ...body, host: "bad host" },
      { ...body, port: 0 },
      { ...body, port: 70000 },
      { ...body, protocol: "pop3" },
      { ...body, security: "plain" },
      { ...body, username: "" },
      { ...body, password: "" },
      { ...body, extra: true },
    ]) {
      const response = await owner.post("/api/v1/settings/mail-connection-test", invalid);
      expect([400, 422], response.body).toContain(response.statusCode);
    }
    expect(candidate).not.toHaveBeenCalled();
  } finally { await api.close(); }
});

it("denies the connection test to every non-owner role", async () => {
  const api = await startTestApi({ authMode: "dev", responseValidation: "throw" });
  try {
    const candidate = vi.spyOn(api.runtime.mailAccounts, "checkCandidate");
    for (const role of ["viewer", "operator"] as const) {
      const client = api.client();
      await client.loginDev(role);
      const denied = await client.post("/api/v1/settings/mail-connection-test", body);
      expect(denied.statusCode, `${role}: ${denied.body}`).toBe(403);
    }
    expect(candidate).not.toHaveBeenCalled();
  } finally { await api.close(); }
});

it("maps unavailable bridge and rejected input to explainable errors, never to a fake success", async () => {
  const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password", responseValidation: "throw" });
  try {
    const owner = api.client();
    await owner.loginOwner("synthetic-test-password");
    const candidate = vi.spyOn(api.runtime.mailAccounts, "checkCandidate");
    const { ApiError } = await import("../src/util/errors");
    candidate.mockRejectedValueOnce(new ApiError({ code: "ADAPTER_UNAVAILABLE", message: "Mail Postfach in Friday-Ubuntu ist nicht erreichbar." }));
    const unavailable = await owner.post("/api/v1/settings/mail-connection-test", body);
    expect(unavailable.statusCode, unavailable.body).toBe(503);
    expect(unavailable.json().error.code).toBe("ADAPTER_UNAVAILABLE");
  } finally { await api.close(); }
});