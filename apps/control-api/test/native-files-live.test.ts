/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies that the contract validators check */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

const PASSWORD = "friday-live-owner-2026";

describe("the built-in files adapter in the live runtime", () => {
  const root = mkdtempSync(join(tmpdir(), "friday-native-files-"));
  const dir = join(root, "install");
  const deck = join(dir, "data", "private", "powerpoint", "2b3c4d5e-0000-4000-8000-000000000003.pptx");
  let api: TestApi;
  let owner: ApiClient;

  beforeAll(async () => {
    mkdirSync(join(dir, "data", "private", "powerpoint"), { recursive: true });
    writeFileSync(deck, "PPTX-Inhalt");
    writeFileSync(join(dir, "data", "private", "powerpoint", "2b3c4d5e-0000-4000-8000-000000000003.json"),
      JSON.stringify({ title: "Projekt Orion Kickoff" }));
    const job = join(dir, "data", "content-studio", "jobs", "3c4d5e6f-0000-4000-8000-000000000004");
    mkdirSync(job, { recursive: true });
    writeFileSync(join(job, "artifact.mp4"), "MP4");

    api = await startTestApi({ dir, dataMode: "live", authMode: "local", ownerPassword: PASSWORD });
    owner = api.client();
    expect((await owner.loginOwner(PASSWORD)).statusCode).toBe(200);
  });

  afterAll(async () => {
    await api?.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("lists the generated files through GET /api/v1/files without adapter configuration", async () => {
    const response = await owner.get("/api/v1/files");
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json();
    expect(body.items.map((item: any) => item.name).sort()).toEqual(["Projekt Orion Kickoff.pptx", "artifact.mp4"]);
    expect(body.sources[0].adapterId).toBe("friday-files");

    const pptx = body.items.find((item: any) => item.name === "Projekt Orion Kickoff.pptx");
    expect(pptx).toBeDefined();
    const detail = await owner.get(`/api/v1/files/${pptx.id}`);
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().data.id).toBe(pptx.id);

    const download = await owner.get(`/api/v1/files/${pptx.id}/download`);
    expect(download.statusCode, download.body).toBe(200);
    expect(download.body).toBe("PPTX-Inhalt");

    const preview = await owner.get(`/api/v1/files/${pptx.id}/preview`);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().data.kind).toBe("none");
  });

  it("reports the built-in adapter online and read-only", async () => {
    const response = await owner.get("/api/v1/adapters");
    expect(response.statusCode, response.body).toBe(200);
    const files = response.json().items.find((item: any) => item.manifest.id === "friday-files");
    expect(files).toBeDefined();
    expect(files.manifest.name).toBe("Friday-Dateien (lokal)");
    expect(files.health.status).toBe("online");

    const capabilities = await owner.get("/api/v1/capabilities");
    expect(capabilities.statusCode, capabilities.body).toBe(200);
    const modules = capabilities.json().modules;
    expect(modules.files.read).toBe(true);
    expect(modules.files.preview).toBe(true);
    expect(modules.files.download).toBe(true);
    expect(modules.files.delete).toBe(false);
    expect(modules.files.rename).toBe(false);
    expect(modules.files.upload).toBe(false);
  });

  it("refuses write operations", async () => {
    const list = await owner.get("/api/v1/files");
    expect(list.statusCode, list.body).toBe(200);
    const pptx = list.json().items.find((item: any) => item.name === "Projekt Orion Kickoff.pptx");
    expect(pptx).toBeDefined();

    const removed = await owner.delete(`/api/v1/files/${pptx.id}`);
    expect(removed.statusCode).toBeGreaterThanOrEqual(400);
    expect([200, 202]).not.toContain(removed.statusCode);

    const renamed = await owner.patch(`/api/v1/files/${pptx.id}`, { name: "x.pptx" });
    expect(renamed.statusCode).toBeGreaterThanOrEqual(400);

    expect(existsSync(deck)).toBe(true);
  });
});

describe("a configured files adapter wins over the built-in one", () => {
  it("does not expose the built-in adapter once a provider is configured", async () => {
    const api = await startTestApi({ dataMode: "hybrid", authMode: "local", ownerPassword: PASSWORD });
    try {
      const client = api.client();
      expect((await client.loginOwner(PASSWORD)).statusCode).toBe(200);
      const response = await client.get("/api/v1/adapters");
      expect(response.statusCode, response.body).toBe(200);
      const items = response.json().items as any[];
      expect(items.some((item) => item.manifest.id === "friday-files")).toBe(false);
      expect(items.some((item) => item.manifest.category === "files")).toBe(true);
    } finally {
      await api.close();
    }
  });
});
