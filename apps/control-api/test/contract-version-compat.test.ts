import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

// DASH-02.05: Ein Client, der seine Vertragsversion nennt, wird bei einer fremden Hauptversion klar abgewiesen statt
// still falsch bedient. Ohne Header bleibt alles wie bisher, und ein abgewiesener Schreibversuch aendert nichts.
describe("contract version compatibility", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeAll(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });

  afterAll(async () => { await api.close(); });

  const header = (value: string) => ({ headers: { "x-friday-contract-version": value } });

  it("accepts requests without a declared version and within the own major", async () => {
    expect((await owner.get("/api/v1/health")).statusCode).toBe(200);
    expect((await owner.get("/api/v1/health", header("2.0.0"))).statusCode).toBe(200);
    expect((await owner.get("/api/v1/health", header("2.7.3"))).statusCode).toBe(200);
  });

  it("rejects a foreign major version with a clear message and changes nothing", async () => {
    const before = (await owner.get("/api/v1/settings")).json().data;

    const stale = await owner.patch("/api/v1/settings", { dashboard: { ...before.dashboard, compact: !before.dashboard.compact } },
      { ...header("1.4.0"), headers: { "x-friday-contract-version": "1.4.0", "if-match": String(before.version) } });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json().error).toMatchObject({ code: "CONFLICT", details: { reason: "contract_version_unsupported", received: "1.4.0" } });
    expect(stale.json().error.message).toContain("2.x");

    const after = (await owner.get("/api/v1/settings")).json().data;
    expect(after.version).toBe(before.version);
    expect(after.dashboard.compact).toBe(before.dashboard.compact);

    const future = await owner.get("/api/v1/health", header("3.0.0"));
    expect(future.statusCode).toBe(409);
    expect(future.json().error.details.reason).toBe("contract_version_unsupported");
  });

  it("rejects a malformed version with a validation error", async () => {
    for (const value of ["abc", "2.0", "v2.0.0", "2.0.0-beta"]) {
      const response = await owner.get("/api/v1/health", header(value));
      expect(response.statusCode, value).toBe(400);
      expect(response.json().error).toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "contract_version_malformed" } });
      expect(response.json().error.details.supported).toContain("2.x");
    }
  });

  it("keeps old data readable while the version guard is active", async () => {
    // Bestehende Eintraege bleiben lesbar: Lesen mit eigener Version liefert dieselben Daten wie ohne Header.
    const plain = await owner.get("/api/v1/settings");
    const declared = await owner.get("/api/v1/settings", header("2.0.0"));
    expect(declared.statusCode).toBe(200);
    const left = plain.json().data;
    const right = declared.json().data;
    expect(right.version).toBe(left.version);
    expect(right.dashboard).toEqual(left.dashboard);
    expect(right.voice).toEqual(left.voice);
    expect(right.security).toEqual(left.security);
  });
});