import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { FridayConfig } from "@friday/config";
import type { SkillsService } from "../src/services/skills";
import { CodingRunsService } from "../src/services/coding-runs";
import { validationFailed } from "../src/util/errors";
import { startTestApi } from "./helpers";

const runId = `run_${"a".repeat(32)}`;
const config = {
  paths: { dataDir: "C:\\Friday\\dashboard\\data" },
} as unknown as FridayConfig;
const idem = `idem_${"A".repeat(26)}`;

describe("CodingRunsService", () => {
  it("selects one enabled native CLI, passes fixed runner arguments, polls and stops", async () => {
    const skills = { list: vi.fn(async () => ({ skills: [{ id: "hermes:codex", discovered: true, enabled: true }] })) } as unknown as SkillsService;
    const invoke = vi.fn(async (_script: string, _distro: string, _user: string, args: string[], _input?: string) => {
      if (args[0] === "probe") return { workdir: "/mnt/c/Users/Test/repo", binary: "/home/test/bin/codex", version: "codex-cli 0.163.0" };
      return { runId, status: args[0] === "status" ? "completed" : args[0] === "stop" ? "cancelled" : "queued",
        requestedCli: "codex", requestedWorkdir: "/mnt/c/Users/Test/repo", preflightVersion: "codex-cli 0.163.0",
        executionVerified: args[0] !== "start", output: args[0] === "status" ? "Done" : null, error: null, updatedAt: 123 };
    });
    const service = new CodingRunsService(config, skills, {}, invoke);
    vi.spyOn(service as unknown as { install: () => object }, "install").mockReturnValue({ root: "C:\\Friday", script: "/mnt/c/Friday/installer/wsl/coding_runner.py", distro: "Friday-Ubuntu", user: "test" });
    vi.spyOn(service as unknown as { repository: (path: string, root: string) => string }, "repository").mockReturnValue("C:\\Users\\Test\\repo");
    const started = await service.start({ cli: "auto", repository: "C:\\Users\\Test\\repo", task: "Update the README safely" }, idem);
    expect(started).toMatchObject({ runId, requestedCli: "codex", preflightVersion: "codex-cli 0.163.0", executionVerified: false, status: "queued" });
    expect(invoke.mock.calls[1]?.[3]).toEqual(["start", "codex", "C:\\Users\\Test\\repo", idem]);
    expect(invoke.mock.calls[1]?.[4]).toBe("Update the README safely");
    expect((await service.status(runId)).output).toBe("Done");
    expect((await service.stop(runId)).status).toBe("cancelled");
    expect(invoke.mock.calls.map((call) => call[3]?.[0])).toEqual(["probe", "start", "status", "stop"]);
  });

  it("does not submit when the selected Hermes skill is disabled", async () => {
    const skills = { list: vi.fn(async () => ({ skills: [{ id: "hermes:codex", discovered: true, enabled: false }] })) } as unknown as SkillsService;
    const invoke = vi.fn();
    const service = new CodingRunsService(config, skills, {}, invoke);
    vi.spyOn(service as unknown as { install: () => object }, "install").mockReturnValue({ root: "C:\\Friday", script: "script", distro: "test", user: "test" });
    vi.spyOn(service as unknown as { repository: (path: string, root: string) => string }, "repository").mockReturnValue("C:\\Users\\Test\\repo");
    await expect(service.start({ cli: "codex", repository: "C:\\Users\\Test\\repo", task: "Update the README safely" }, idem)).rejects.toThrow("Kein aktivierter");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("recovers an admitted native run if the start response is lost", async () => {
    const skills = { list: vi.fn(async () => ({ skills: [{ id: "hermes:codex", discovered: true, enabled: true }] })) } as unknown as SkillsService;
    const expectedId = `run_${createHash("sha256").update(idem).digest("hex").slice(0, 32)}`;
    const invoke = vi.fn(async (_script: string, _distro: string, _user: string, args: string[]) => {
      if (args[0] === "probe") return { workdir: "/mnt/c/repo", binary: "/home/test/bin/codex", version: "fake" };
      if (args[0] === "start") throw new Error("connection lost");
      return { runId: expectedId, status: "running", requestedCli: "codex", requestedWorkdir: "/mnt/c/repo",
        preflightVersion: "fake", executionVerified: true, output: null, error: null, updatedAt: 123 };
    });
    const service = new CodingRunsService(config, skills, {}, invoke);
    vi.spyOn(service as unknown as { install: () => object }, "install").mockReturnValue({ root: "C:\\Friday", script: "script", distro: "test", user: "test" });
    vi.spyOn(service as unknown as { repository: (path: string, root: string) => string }, "repository").mockReturnValue("C:\\Users\\Test\\repo");
    const result = await service.start({ cli: "codex", repository: "C:\\Users\\Test\\repo", task: "Update the README safely" }, idem);
    expect(result).toMatchObject({ runId: expectedId, status: "running", executionVerified: true });
    expect(invoke.mock.calls.map((call) => call[3]?.[0])).toEqual(["probe", "start", "status"]);
  });

  it("keeps coding mutations behind owner session, CSRF and idempotency", async () => {
    const api = await startTestApi();
    try {
      const anonymous = api.client();
      const body = { cli: "codex", repository: "C:\\Users\\Test\\repo", task: "Update the README safely" };
      expect((await anonymous.post("/api/v1/coding-runs", body)).statusCode).toBe(401);
      const owner = api.client();
      await owner.loginDev("owner");
      expect((await owner.request("POST", "/api/v1/coding-runs", { body, csrf: false, headers: { "idempotency-key": "idem_test1234" } })).statusCode).toBe(403);
      expect((await owner.post("/api/v1/coding-runs", body)).statusCode).toBe(422);
      const admitted = { runId, status: "started", requestedCli: "codex" as const, requestedWorkdir: "/mnt/c/Users/Test/repo", preflightVersion: "codex-cli 0.163.0", executionVerified: false as const, output: null, error: null, updatedAt: null };
      const start = vi.spyOn(api.runtime.codingRuns, "start").mockResolvedValue(admitted);
      vi.spyOn(api.runtime.codingRuns, "status").mockResolvedValue({ ...admitted, status: "completed", output: "Done" });
      vi.spyOn(api.runtime.codingRuns, "stop").mockResolvedValue({ ...admitted, status: "stopping" });
      const headers = { "idempotency-key": "idem_test1234" };
      expect((await owner.request("POST", "/api/v1/coding-runs", { body, headers })).statusCode).toBe(202);
      expect((await owner.request("POST", "/api/v1/coding-runs", { body, headers })).statusCode).toBe(202);
      expect(start).toHaveBeenCalledTimes(1);
      expect((await owner.get(`/api/v1/coding-runs/${runId}`)).json().data.output).toBe("Done");
      expect((await owner.post(`/api/v1/coding-runs/${runId}/stop`)).json().data.status).toBe("stopping");
    } finally { await api.close(); }
  });
  it("binds voice runs to the owner-approved alias and revision", async () => {
    const api = await startTestApi();
    try {
      const owner = api.client(); await owner.loginDev("owner");
      const voice = api.client();
      const bridge = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
      const path = "/api/v1/coding-runs/voice-repository";
      const body = { alias: "Mein Projekt", repository: "C:\\Users\\Test\\repo" };
      const canonical = vi.spyOn(api.runtime.codingRuns, "canonicalRepository").mockReturnValue(body.repository);
      const prepare = vi.spyOn(api.runtime.codingRuns, "prepareVoiceRepository").mockResolvedValue(body.repository);
      expect((await owner.request("PUT", path, { body, headers: { "if-match": "0" }, csrf: false })).statusCode).toBe(403);
      expect((await owner.request("PUT", path, { body })).statusCode).toBe(422);
      expect((await voice.request("PUT", path, { body, headers: { ...bridge, "if-match": "0" } })).statusCode).toBe(401);
      prepare.mockRejectedValueOnce(validationFailed("Das Repository ist für Linux-Git in Friday-Ubuntu nicht lesbar."));
      expect((await owner.request("PUT", path, { body, headers: { "if-match": "0" } })).statusCode).toBe(422);
      expect((await owner.get(path)).json().data.revision).toBe(0);
      expect((await owner.request("PUT", path, { body, headers: { "if-match": "0" } })).statusCode).toBe(200);
      expect((await owner.request("PUT", path, { body, headers: { "if-match": "0" } })).statusCode).toBe(409);
      expect((await voice.request("GET", path, { headers: bridge })).json().data).toMatchObject({ alias: body.alias, revision: 1 });
      const request = { alias: body.alias, revision: 1, cli: "codex", task: "Update the README safely" };
      const route = "/api/v1/coding-runs/voice";
      const headers = { ...bridge, "idempotency-key": "voice-coding-test-1" };
      const start = vi.spyOn(api.runtime.codingRuns, "start").mockResolvedValue({ runId, status: "queued", requestedCli: "codex", requestedWorkdir: "/mnt/c/repo", preflightVersion: "fake", executionVerified: false, output: null, error: null, updatedAt: null });
      expect((await voice.request("POST", route, { body: request, headers: { "idempotency-key": "voice-coding-test-1" } })).statusCode).toBe(401);
      expect((await voice.request("POST", route, { body: { ...request, alias: "Wrong" }, headers })).statusCode).toBe(409);
      expect((await voice.request("POST", route, { body: { ...request, revision: 0 }, headers })).statusCode).toBe(422);
      expect((await voice.request("POST", route, { body: request, headers })).statusCode).toBe(202);
      expect((await voice.request("POST", route, { body: request, headers })).statusCode).toBe(202);
      expect(start).toHaveBeenCalledTimes(1);
      expect(start).toHaveBeenCalledWith({ cli: "codex", repository: body.repository, task: request.task }, expect.stringMatching(/^idem_[A-F0-9]{26}$/));
      expect(canonical).toHaveBeenCalled();
    } finally { await api.close(); }
  });
});
