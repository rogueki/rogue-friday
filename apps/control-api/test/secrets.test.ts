/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies and frames that the contract validators check */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FridayEvent } from "@friday/sdk";
import { ROUTE_TABLE } from "../src/http/route-table.generated";
import { ApiClient, startTestApi, type TestApi } from "./helpers";
import { pathOf } from "./support/contract";
import { stableUserId } from "../src/security/auth-service";

const IMAP = "canary-imap-pw-7f3a9c1e5b2d4086";
const SMTP = "canary-smtp-pw-0b8d6e4a2c9f1357";
const WORKER = "canary-worker-token-5e1b7d3f9a2c4680";
const OWNER_PASSWORD = "canary-owner-password-2026-xyz";
const CANARIES = [IMAP, SMTP, WORKER, OWNER_PASSWORD];

describe("secret hygiene", () => {
  let api: TestApi;
  let owner: ApiClient;
  const logs: string[] = [];
  const wire: string[] = [];
  const streamed: string[] = [];

  const record = (label: string, response: { statusCode: number; body: string; headers: Record<string, unknown> }) => {
    wire.push(`${label} ${response.statusCode}\n${JSON.stringify(response.headers)}\n${response.body}`);
    return response;
  };

  beforeAll(async () => {
    api = await startTestApi({ authMode: "local", ownerPassword: OWNER_PASSWORD, logs });
    api.runtime.hub.subscribe((event: FridayEvent) => streamed.push(JSON.stringify(event)));
    owner = api.client();
    record("login", await owner.loginOwner(OWNER_PASSWORD));

    // plant secrets through the only way in: the write-only adapter settings
    const planted = record(
      "patch communication",
      await owner.patch("/api/v1/settings/adapters/mock-communication", { config: { imapHost: "imap.gmx.example" }, secrets: { imapPassword: IMAP, smtpPassword: SMTP } }),
    );
    expect(planted.statusCode, planted.body).toBe(200);
    const system = record("patch system", await owner.patch("/api/v1/settings/adapters/mock-system", { secrets: { workerToken: WORKER } }));
    expect(system.statusCode, system.body).toBe(200);
    // also fail a login and a re-auth with the password, to see whether failures echo credentials
    record("wrong login", await api.client().post("/api/v1/auth/login", { username: "owner", password: `${OWNER_PASSWORD}-wrong` }, { csrf: false }));
    record("reauth", await owner.post("/api/v1/auth/reauth", { password: OWNER_PASSWORD }));
    await owner.post("/api/v1/tasks", { title: "Aufgabe nach dem Setzen der Secrets" });
    await api.runtime.refreshAdapters();
  });
  afterAll(async () => {
    await api.close();
  });

  const hasCanary = (text: string): string | undefined => CANARIES.find((canary) => text.includes(canary) || text.includes(encodeURIComponent(canary)));

  it("masks adapter secrets in the settings API: configured flag and hint, never the value", async () => {
    const list = record("list adapter settings", await owner.get("/api/v1/settings/adapters"));
    expect(list.statusCode).toBe(200);
    const communication = JSON.parse(list.body).items.find((item: any) => item.adapterId === "mock-communication");
    expect(communication.secretFields.imapPassword).toEqual({ configured: true, maskedHint: expect.any(String) });
    expect(communication.secretFields.smtpPassword.configured).toBe(true);
    expect(communication.config.imapPassword).toBeUndefined();
    expect(JSON.stringify(communication.secretFields)).not.toContain(IMAP);
    const system = JSON.parse(list.body).items.find((item: any) => item.adapterId === "mock-system");
    expect(system.secretFields.workerToken.configured).toBe(true);
    const unset = JSON.parse(list.body).items.find((item: any) => item.adapterId === "mock-tasks");
    expect(unset.secretFields).toEqual({});
  });

  it("never returns the secret in the PATCH response, the single-adapter view or the test result", async () => {
    const patched = record("patch again", await owner.patch("/api/v1/settings/adapters/mock-communication", { secrets: { imapPassword: `${IMAP}-rotated` } }));
    expect(patched.statusCode).toBe(200);
    expect(patched.body).not.toContain("rotated");
    const tested = record("test adapter", await owner.post("/api/v1/settings/adapters/mock-communication/test"));
    expect(tested.statusCode, tested.body).toBe(200);
  });

  it("rejects secret-looking values in plain config fields' responses and keeps settings export free of secrets", async () => {
    const exported = record("export settings", await owner.get("/api/v1/settings/export"));
    expect(exported.statusCode).toBe(200);
    expect(hasCanary(exported.body)).toBeUndefined();
    expect(exported.body).not.toMatch(/imapPassword|smtpPassword|workerToken/);
    const settings = record("settings", await owner.get("/api/v1/settings"));
    expect(hasCanary(settings.body)).toBeUndefined();
  });

  it("does not leak any secret, password, password hash or server key through any read endpoint", async () => {
    const hash = api.env.FRIDAY_OWNER_PASSWORD_HASH as string;
    expect(hash).toBeTruthy();
    const settings = (await owner.get("/api/v1/settings")).json().data;
    expect((await owner.patch("/api/v1/settings", { dashboard: { ...settings.dashboard, contentStudioEnabled: true } },
      { headers: { "if-match": String(settings.version) } })).statusCode).toBe(200);
    const originalFetch = globalThis.fetch;
    const providerFetch = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      if (String(input).startsWith("https://geocoding-api.open-meteo.com/v1/search?")) {
        return Promise.resolve(Response.json({ results: [{ name: "Berlin", country: "Deutschland", country_code: "DE",
          latitude: 52.52437, longitude: 13.41053 }] }));
      }
      return originalFetch(input, init);
    });
    // Native WSL providers are absent in this isolated API runtime. Keep their new read routes in the leak sweep.
    const calendarList = vi.spyOn(api.runtime.calendarAccounts, "list").mockResolvedValue({ revision: 1, defaultAccountId: null, accounts: [] });
    const calendarPending = vi.spyOn(api.runtime.calendarAccounts, "pendingMemory").mockResolvedValue({ events: [] });
    const mailList = vi.spyOn(api.runtime.mailAccounts, "list").mockResolvedValue({ revision: 1, defaultAccountId: null, accounts: [] });
    const hermesConfig = vi.spyOn(api.runtime.hermesConfig, "status").mockResolvedValue({ installed: true,
      sourceRevision: "d923a5eb487a17c0a68801bba9ef0f56c81040a8", revision: 1, checkedAt: new Date().toISOString(),
      fields: [], secretStates: [{ key: "model.api_key", configFileSet: true, effectiveConfigured: null }],
      families: [], skills: [], plugins: [], inventory: { scope: "profile", skillsComplete: true, pluginsComplete: true, modelProvidersComplete: true, reasons: [] }, modelProviders: [], write: null } as never);
    const memorySearch = vi.spyOn(api.runtime.durableMemory, "search").mockReturnValue([]);
    const whatsappPairing = vi.spyOn(api.runtime.whatsappGateway, "pairing").mockResolvedValue({ id: null, state: "idle",
      qr: null, expiresAt: null, linkedIdentity: null, connectionState: "disconnected" });
    try {
      for (const spec of ROUTE_TABLE.filter((candidate) => candidate.method === "GET" && candidate.pathParams.length === 0 && candidate.requiresSession)) {
        // Hermes-backed reads require an installed WSL distro, absent in this isolated test runtime.
        // Gateway token redaction is covered by the dedicated Telegram/Discord/WhatsApp API tests.
        if (spec.operationId === "downloadFile" || spec.operationId === "getObsidianVault" || spec.operationId === "getWikiPath" || spec.operationId === "getHimalayaAccount" || spec.operationId === "listHimalayaMailboxes" || spec.operationId === "listHimalayaEnvelopes" || spec.operationId === "getHimalayaMessage" || spec.operationId === "getCodingCliStatus" || spec.operationId === "getHermesSkillKeys" || spec.operationId === "getTelegramGateway" || spec.operationId === "getDiscordGateway" || spec.operationId === "getWhatsappGateway" || spec.operationId === "getTelephony") continue;
        const response = record(spec.operationId, await owner.get(pathOf(spec), spec.operationId === "exportAudit" ? { query: { format: "json" } } :
          spec.operationId === "searchLocations" ? { query: { q: "Berlin" } } :
          spec.operationId === "searchDurableMemory" ? { query: { query: "synthetic", identityId: stableUserId("owner") } } : {}));
        expect(response.statusCode, spec.operationId).toBe(200);
        expect(hasCanary(response.body), `${spec.operationId} body`).toBeUndefined();
        expect(response.body, `${spec.operationId} body`).not.toContain(hash);
        expect(response.body, `${spec.operationId} body`).not.toMatch(/scrypt\$|-----BEGIN [A-Z ]*PRIVATE KEY-----/);
      }
      expect(providerFetch).toHaveBeenCalledWith(expect.objectContaining({ hostname: "geocoding-api.open-meteo.com" }), expect.any(Object));
    } finally {
      providerFetch.mockRestore();
      calendarList.mockRestore();
      calendarPending.mockRestore();
      mailList.mockRestore();
      hermesConfig.mockRestore();
      memorySearch.mockRestore();
      whatsappPairing.mockRestore();
    }
  });

  it("keeps secrets and credentials out of responses and headers of every call made in this suite", () => {
    expect(wire.length).toBeGreaterThan(30);
    const hash = api.env.FRIDAY_OWNER_PASSWORD_HASH as string;
    for (const entry of wire) {
      expect(hasCanary(entry.replace(OWNER_PASSWORD + "-wrong", ""))).toBeUndefined();
      expect(entry).not.toContain(hash);
    }
  });

  it("keeps secrets out of the audit trail (rows, including request context)", () => {
    const rows = JSON.stringify(api.runtime.db.prepare("SELECT json FROM audit_log").all());
    expect(rows.length).toBeGreaterThan(100);
    expect(hasCanary(rows)).toBeUndefined();
    expect(rows).not.toContain(OWNER_PASSWORD + "-wrong");
    const adapterAudit = api.runtime.stores.audit.recent(50).find((event) => event.action.includes("updateAdapterSettings") || event.action.includes("adapter"));
    expect(adapterAudit, "the secret change is audited (without the value)").toBeDefined();
  });

  it("keeps secrets out of the event stream", () => {
    expect(streamed.length).toBeGreaterThan(5);
    expect(hasCanary(streamed.join("\n"))).toBeUndefined();
  });

  it("keeps secrets out of the logs, including rejected login attempts", () => {
    expect(logs.length).toBeGreaterThan(10);
    const text = logs.join("\n");
    expect(hasCanary(text)).toBeUndefined();
    expect(text).not.toContain(OWNER_PASSWORD + "-wrong");
    expect(text).not.toContain(api.env.FRIDAY_OWNER_PASSWORD_HASH as string);
    expect(text).not.toMatch(/friday_session=[A-Za-z0-9_-]{20,}/);
  });

  it("does not persist secret values in the settings database", () => {
    const dump = JSON.stringify(
      ["settings_areas", "adapter_overrides"].flatMap((table) => {
        try {
          return api.runtime.db.prepare(`SELECT * FROM ${table}`).all();
        } catch {
          return [];
        }
      }),
    );
    expect(dump.length).toBeGreaterThan(10);
    expect(hasCanary(dump)).toBeUndefined();
  });

  it("serves cookies as HttpOnly and never puts the session id into a response body", async () => {
    const client = api.client();
    const login = await client.loginOwner(OWNER_PASSWORD);
    const cookies = ([] as string[]).concat(login.headers["set-cookie"] ?? []);
    const session = cookies.find((cookie) => cookie.startsWith("friday_session=")) as string;
    const sessionId = session.split(";")[0]?.split("=")[1] as string;
    expect(sessionId.length).toBeGreaterThan(20);
    expect(login.body).not.toContain(sessionId);
    const meta = await client.get("/api/v1/auth/session");
    expect(meta.body).not.toContain(sessionId);
  });

  it("does not leak stack traces or internal paths in error responses", async () => {
    for (const response of [
      await owner.get("/api/v1/tasks/does-not-exist"),
      await owner.post("/api/v1/tasks", undefined, { rawBody: "{broken" }),
      await owner.get("/api/v1/nope"),
    ]) {
      expect(response.body).not.toMatch(/\bat \S+ \(|node_modules|\/home\/|\.ts:\d+/);
    }
  });
});
