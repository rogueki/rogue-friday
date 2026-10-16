import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PowerPointService } from "../src/services/powerpoint";
import { existsSync, mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SkillCatalogEntry } from "@friday/sdk";
import { startTestApi, type TestApi } from "./helpers";

const request = { title: "Friday Test", slides: [{ title: "Agenda", bullets: ["Erster Punkt"] }] };

describe("owner PowerPoint creation", () => {
  let api: TestApi;
  let skillsList: ReturnType<typeof vi.spyOn>;
  const invoke = vi.fn(async () => ({ pptx: Buffer.concat([Buffer.from("PK"), Buffer.alloc(200)]).toString("base64") }));
  beforeAll(async () => {
    api = await startTestApi({ responseValidation: "throw" });
    const service = new PowerPointService(api.dir, invoke);
    vi.spyOn(service as unknown as { target: () => { script: string; distro: string; user: string } }, "target")
      .mockReturnValue({ script: "/fixed/powerpoint_runner.py", distro: "Friday-Ubuntu", user: "friday" });
    api.runtime.powerpoint = service;
    skillsList = vi.spyOn(api.runtime.skills, "list").mockResolvedValue({ skills: [{ id: "hermes:powerpoint", discovered: true, enabled: true } as SkillCatalogEntry],
      fresh: true, catalogError: null, hermesError: null });
  });
  afterAll(async () => { await api.close(); });

  it("requires owner and CSRF, then exposes only an owner download", async () => {
    const guest = api.client();
    expect((await guest.request("POST", "/api/v1/skills/powerpoint/decks", { body: request })).statusCode).toBe(401);
    const viewer = api.client(); await viewer.loginDev("viewer");
    expect((await viewer.request("POST", "/api/v1/skills/powerpoint/decks", { body: request })).statusCode).toBe(403);
    const owner = api.client(); await owner.loginDev("owner");
    expect((await owner.request("POST", "/api/v1/skills/powerpoint/decks", { body: request, csrf: false })).statusCode).toBe(403);
    const created = await owner.request("POST", "/api/v1/skills/powerpoint/decks", { body: request });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ slideCount: 2, downloadUrl: expect.stringContaining("/download") });
    const url = created.json().data.downloadUrl;
    expect((await guest.get(url)).statusCode).toBe(401);
    expect((await viewer.get(url)).statusCode).toBe(403);
    const downloaded = await owner.get(url);
    expect(downloaded.statusCode).toBe(200);
    expect(downloaded.headers["content-type"]).toContain("presentationml.presentation");
    expect(downloaded.headers["cache-control"]).toBe("no-store");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid slides before running Hermes", async () => {
    const owner = api.client(); await owner.loginDev("owner");
    const before = invoke.mock.calls.length;
    expect((await owner.request("POST", "/api/v1/skills/powerpoint/decks", { body: { title: "", slides: [] } })).statusCode).toBe(422);
    expect(invoke.mock.calls).toHaveLength(before);
  });

  it("fails closed when Hermes activation is disabled or observation is stale", async () => {
    const owner = api.client(); await owner.loginDev("owner");
    const before = invoke.mock.calls.length;
    skillsList.mockResolvedValueOnce({ skills: [{ id: "hermes:powerpoint", discovered: true, enabled: false } as SkillCatalogEntry],
      fresh: true, catalogError: null, hermesError: null });
    expect((await owner.request("POST", "/api/v1/skills/powerpoint/decks", { body: request })).statusCode).toBe(503);
    skillsList.mockResolvedValueOnce({ skills: [{ id: "hermes:powerpoint", discovered: true, enabled: true } as SkillCatalogEntry],
      fresh: false, catalogError: null, hermesError: "offline" });
    expect((await owner.request("POST", "/api/v1/skills/powerpoint/decks", { body: request })).statusCode).toBe(503);
    expect(invoke.mock.calls).toHaveLength(before);
  });

  it("prunes expired generated decks without touching unrelated files", async () => {
    const folder = join(api.dir, "private", "powerpoint");
    mkdirSync(folder, { recursive: true });
    const expired = join(folder, "11111111-1111-4111-8111-111111111111.pptx");
    const unrelated = join(folder, "keep.txt");
    writeFileSync(expired, "old"); writeFileSync(unrelated, "keep");
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(expired, oldTime, oldTime);
    const owner = api.client(); await owner.loginDev("owner");
    expect((await owner.request("POST", "/api/v1/skills/powerpoint/decks", { body: request })).statusCode).toBe(201);
    expect(existsSync(expired)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
  });
});
