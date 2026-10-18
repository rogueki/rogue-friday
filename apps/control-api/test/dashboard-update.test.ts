import { expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";
import { DashboardUpdateService, parseDashboardProgress, type DashboardUpdateProgress } from "../src/services/dashboard-update";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type ServiceHooks = {
  effectiveProgress(): Promise<DashboardUpdateProgress | null>;
  progress(): Promise<DashboardUpdateProgress | null>;
  installed(): Promise<string | null>;
  latest(): Promise<string>;
  legacyLockActive(): Promise<boolean>;
  processMatches(progress: DashboardUpdateProgress): Promise<"alive" | "dead" | "unknown">;
};

it("requires owner and CSRF before starting a dashboard update", async () => {
  const api = await startTestApi();
  try {
    const anonymous = api.client();
    const viewer = api.client(); await viewer.loginDev("viewer");
    const owner = api.client(); await owner.loginDev("owner");
    const path = "/api/v1/dashboard-update/install";
    const body = { commit: "invalid" };
    expect((await anonymous.get("/api/v1/dashboard-update")).statusCode).toBe(403);
    expect((await viewer.get("/api/v1/dashboard-update")).statusCode).toBe(403);
    expect((await anonymous.request("POST", path, { body })).statusCode).toBe(403);
    expect((await viewer.request("POST", path, { body })).statusCode).toBe(403);
    expect((await owner.request("POST", path, { body, csrf: false })).statusCode).toBe(403);
    expect((await owner.request("POST", path, { body })).statusCode).toBe(409);
  } finally { await api.close(); }
});

it("passes a valid JSON commit through the owner and CSRF gate to the update service", async () => {
  const install = vi.spyOn(DashboardUpdateService.prototype, "install").mockResolvedValue();
  const api = await startTestApi();
  try {
    const owner = api.client(); await owner.loginDev("owner");
    const commit = "a".repeat(40);
    const response = await owner.request("POST", "/api/v1/dashboard-update/install", { body: { commit } });
    expect(response.statusCode).toBe(202);
    expect(install).toHaveBeenCalledWith(commit);
  } finally { install.mockRestore(); await api.close(); }
});

it("uses cached status for polling and forces GitHub only for an owner's explicit refresh", async () => {
  const status = vi.spyOn(DashboardUpdateService.prototype, "status").mockResolvedValue({
    installed: "a".repeat(40), latest: "a".repeat(40), available: false,
    checking: false, installing: false, error: null, progress: null, lastResult: null,
  });
  const api = await startTestApi();
  try {
    const owner = api.client(); await owner.loginDev("owner");
    const viewer = api.client(); await viewer.loginDev("viewer");
    expect((await viewer.get("/api/v1/dashboard-update?refresh=1")).statusCode).toBe(403);
    expect((await owner.get("/api/v1/dashboard-update")).statusCode).toBe(200);
    expect((await owner.get("/api/v1/dashboard-update?refresh=1")).statusCode).toBe(200);
    expect(status).toHaveBeenNthCalledWith(1, false);
    expect(status).toHaveBeenNthCalledWith(2, true);
  } finally { status.mockRestore(); await api.close(); }
});

it("rejects malformed progress and preserves run identity and terminal failure", () => {
  const valid = { schema: 1, runId: "a".repeat(32), targetCommit: "b".repeat(40),
    state: "failed", phase: "failed", step: 6, totalSteps: 8, message: "Rollback nicht bestätigt",
    startedAt: "2026-10-18T10:00:00.000Z", updatedAt: "2026-10-18T10:01:00.000Z" };
  expect(parseDashboardProgress(valid)).toMatchObject({ state: "failed", runId: valid.runId, step: 6 });
  expect(parseDashboardProgress({ ...valid, runId: "../wrong" })).toBeNull();
  expect(parseDashboardProgress({ ...valid, targetCommit: "wrong" })).toBeNull();
  expect(parseDashboardProgress({ ...valid, step: 900 })).toBeNull();
});

it("returns an active run immediately even when its last phase began long ago", async () => {
  const service = new DashboardUpdateService({ paths: { dataDir: "C:\\Friday\\dashboard\\data" } } as never);
  const hooks = service as unknown as ServiceHooks;
  const progress = { schema: 1, runId: "a".repeat(32), targetCommit: "b".repeat(40),
    state: "running", phase: "build", step: 4, totalSteps: 8, message: "Dashboard wird gebaut.",
    startedAt: "2026-10-18T10:00:00.000Z", updatedAt: "2026-10-18T10:01:00.000Z" };
  vi.spyOn(hooks, "effectiveProgress").mockResolvedValue(progress as DashboardUpdateProgress);
  vi.spyOn(hooks, "installed").mockResolvedValue("a".repeat(40));
  const network = vi.spyOn(hooks, "latest");
  const status = await service.status(true);
  expect(status.installing).toBe(true);
  expect(status.progress?.phase).toBe("build");
  expect(network).not.toHaveBeenCalled();
});

it("passes a manual refresh through to the GitHub lookup while idle polling stays cached", async () => {
  const service = new DashboardUpdateService({ paths: { dataDir: "C:\\Friday\\dashboard\\data" } } as never);
  const hooks = service as unknown as ServiceHooks;
  vi.spyOn(hooks, "effectiveProgress").mockResolvedValue(null);
  vi.spyOn(hooks, "legacyLockActive").mockResolvedValue(false);
  vi.spyOn(hooks, "installed").mockResolvedValue("a".repeat(40));
  const network = vi.spyOn(hooks, "latest").mockResolvedValue("b".repeat(40));
  await service.status();
  await service.status(true);
  expect(network).toHaveBeenNthCalledWith(1, false);
  expect(network).toHaveBeenNthCalledWith(2, true);
});

it("reports an older updater's held lock as running without inventing phases", async () => {
  const service = new DashboardUpdateService({ paths: { dataDir: "C:\\Friday\\dashboard\\data" } } as never);
  const hooks = service as unknown as ServiceHooks;
  vi.spyOn(hooks, "effectiveProgress").mockResolvedValue(null);
  vi.spyOn(hooks, "legacyLockActive").mockResolvedValue(true);
  vi.spyOn(hooks, "installed").mockResolvedValue("a".repeat(40));
  const network = vi.spyOn(hooks, "latest");
  const status = await service.status();
  expect(status.installing).toBe(true);
  expect(status.progress).toBeNull();
  expect(network).not.toHaveBeenCalled();
});

it("keeps an active run when process inspection is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "friday-update-status-"));
  try {
    await mkdir(join(root, "updates"));
    await writeFile(join(root, "updates", "dashboard-update.lock"), "held");
    const service = new DashboardUpdateService({ paths: { dataDir: join(root, "dashboard", "data") } } as never);
    const hooks = service as unknown as ServiceHooks;
    const progress = { schema: 1, runId: "a".repeat(32), targetCommit: "b".repeat(40),
      state: "running", phase: "build", step: 4, totalSteps: 8, message: "Building",
      startedAt: "2026-10-18T10:00:00.000Z", updatedAt: "2026-10-18T10:01:00.000Z",
      pid: 123, processStartedAt: "2026-10-18T10:00:00.000Z" };
    vi.spyOn(hooks, "progress").mockResolvedValue(progress as DashboardUpdateProgress);
    vi.spyOn(hooks, "processMatches").mockResolvedValue("unknown");
    expect((await hooks.effectiveProgress())?.state).toBe("running");
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()))) await rm(root, { recursive: true, force: true });
  }
});
