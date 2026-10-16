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

  it("expires a private download after seven days", async () => {
    const folder = join(api.dir, "private", "powerpoint");
    const expired = join(folder, "22222222-2222-4222-8222-222222222222.pptx");
    writeFileSync(expired, "old");
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(expired, oldTime, oldTime);
    const owner = api.client(); await owner.loginDev("owner");
    expect((await owner.get("/api/v1/skills/powerpoint/decks/22222222-2222-4222-8222-222222222222/download")).statusCode).toBe(404);
    expect(existsSync(expired)).toBe(false);
  });

  it("lists recent decks only for the owner and survives a fresh service instance", async () => {
    const guest = api.client();
    const viewer = api.client(); await viewer.loginDev("viewer");
    const owner = api.client(); await owner.loginDev("owner");
    expect((await guest.get("/api/v1/skills/powerpoint/decks")).statusCode).toBe(401);
    expect((await viewer.get("/api/v1/skills/powerpoint/decks")).statusCode).toBe(403);
    const listed = await owner.get("/api/v1/skills/powerpoint/decks");
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.some((deck: { title: string }) => deck.title === request.title)).toBe(true);
    expect(new PowerPointService(api.dir).recent().length).toBeGreaterThan(0);
  });

  it("allows only the loopback voice key and replays one voice deck without rerunning Hermes", async () => {
    const path = "/api/v1/skills/powerpoint/voice";
    const guest = api.client();
    const owner = api.client(); await owner.loginDev("owner");
    const auth = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}`, "Idempotency-Key": "voice-powerpoint-key-12345678" };
    expect((await guest.request("POST", path, { body: request })).statusCode).toBe(401);
    expect((await owner.request("POST", path, { body: request })).statusCode).toBe(403);
    expect((await guest.request("POST", path, { body: { ...request, slides: [...request.slides, ...request.slides] },
      headers: { ...auth, "Idempotency-Key": "voice-powerpoint-invalid-12345678" } })).statusCode).toBe(422);
    const before = invoke.mock.calls.length;
    const first = await guest.request("POST", path, { body: request, headers: auth });
    expect(first.statusCode).toBe(201);
    const second = await guest.request("POST", path, { body: request, headers: auth });
    expect(second.statusCode).toBe(201);
    expect(second.json().data.id).toBe(first.json().data.id);
    expect(first.headers["idempotent-replayed"]).toBe("false");
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(invoke.mock.calls).toHaveLength(before + 1);
    expect((await guest.request("POST", path, { body: { ...request, title: "Other" }, headers: auth })).statusCode).toBe(409);
    expect(invoke.mock.calls).toHaveLength(before + 1);
  });

  it("does not rerun a voice deck when the prior outcome is uncertain", async () => {
    const client = api.client();
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}`,
      "Idempotency-Key": "voice-powerpoint-uncertain-12345678" };
    const before = invoke.mock.calls.length;
    invoke.mockRejectedValueOnce(new Error("lost runner response"));
    expect((await client.request("POST", "/api/v1/skills/powerpoint/voice", { body: request, headers })).statusCode).toBe(503);
    expect((await client.request("POST", "/api/v1/skills/powerpoint/voice", { body: request, headers })).statusCode).toBe(409);
    expect(invoke.mock.calls).toHaveLength(before + 1);
  });

  it("expires only old voice journals and fails closed when current journals reach the cap", async () => {
    const folder = join(api.dir, "private", "powerpoint");
    const old = join(folder, `voice-${"a".repeat(64)}.json`);
    const unrelated = join(folder, "keep-journal.json");
    writeFileSync(old, "old"); writeFileSync(unrelated, "keep");
    const expired = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    utimesSync(old, expired, expired);
    await api.runtime.powerpoint.createVoice(request, "voice-journal-cleanup-12345678");
    expect(existsSync(old)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
    for (let index = 0; index < 256; index += 1) {
      writeFileSync(join(folder, `voice-${index.toString(16).padStart(64, "0")}.json`), "reserved");
    }
    const before = invoke.mock.calls.length;
    await expect(api.runtime.powerpoint.createVoice(request, "voice-journal-cap-12345678"))
      .rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
    expect(invoke.mock.calls).toHaveLength(before);
    expect(existsSync(unrelated)).toBe(true);
  });
});
