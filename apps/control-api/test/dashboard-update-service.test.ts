import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { DashboardUpdateService } from "../src/services/dashboard-update";

const installed = "a".repeat(40);
const target = "b".repeat(40);

async function fixture(launch: typeof spawn, startAckTimeoutMs = 10_000) {
  const root = await mkdtemp(join(tmpdir(), "friday-update-launch-"));
  const dataDir = join(root, "dashboard", "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "dashboard-revision.json"), JSON.stringify({ commit: installed }));
  const service = new DashboardUpdateService({ paths: { dataDir } } as never, launch, startAckTimeoutMs);
  const hooks = service as unknown as {
    latest(force?: boolean): Promise<string>;
    stageUpdater(commit: string): Promise<string>;
  };
  vi.spyOn(hooks, "latest").mockResolvedValue(target);
  vi.spyOn(hooks, "stageUpdater").mockResolvedValue(join(root, "updates", "verified.ps1"));
  return { root, dataDir, service, hooks };
}

async function cleanup(root: string) {
  if (resolve(root).startsWith(resolve(tmpdir()))) await rm(root, { recursive: true, force: true });
}

function child(): EventEmitter & { unref: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> } {
  return Object.assign(new EventEmitter(), { unref: vi.fn(), kill: vi.fn() });
}

it("rejects a PowerShell spawn failure and releases the start guard", async () => {
  const launch = vi.fn(() => {
    const proc = child();
    queueMicrotask(() => proc.emit("error", new Error("PowerShell fehlt")));
    return proc as unknown as ReturnType<typeof spawn>;
  }) as unknown as typeof spawn;
  const fx = await fixture(launch);
  try {
    await expect(fx.service.install(target)).rejects.toThrow("PowerShell fehlt");
    expect(existsSync(join(fx.root, "updates", "dashboard-update-start.guard"))).toBe(false);
    const progress = JSON.parse(await readFile(join(fx.dataDir, "dashboard-update-progress.json"), "utf8"));
    expect(progress.state).toBe("failed");
  } finally { await cleanup(fx.root); }
});

it("rejects an early child exit and never accepts another run's status as acknowledgement", async () => {
  const launch = vi.fn((_file: string, args: readonly string[]) => {
    const proc = child();
    queueMicrotask(() => proc.emit("spawn"));
    setTimeout(async () => {
      const now = new Date().toISOString();
      await writeFile(join(fx.dataDir, "dashboard-update-progress.json"), JSON.stringify({
        schema: 1, runId: "f".repeat(32), targetCommit: target, state: "running",
        phase: "download", step: 1, totalSteps: 8, message: "Fremder Lauf",
        startedAt: now, updatedAt: now, pid: 1234, processStartedAt: now,
      }));
      proc.emit("exit", 1);
    }, 30);
    expect(args).toContain("-RunId");
    return proc as unknown as ReturnType<typeof spawn>;
  }) as unknown as typeof spawn;
  const fx = await fixture(launch);
  try {
    await expect(fx.service.install(target)).rejects.toThrow("vor dem ersten Arbeitsschritt");
    expect(existsSync(join(fx.root, "updates", "dashboard-update-start.guard"))).toBe(false);
    const progress = JSON.parse(await readFile(join(fx.dataDir, "dashboard-update-progress.json"), "utf8"));
    expect(progress.state).toBe("failed");
    expect(progress.runId).not.toBe("f".repeat(32));
  } finally { await cleanup(fx.root); }
});

it("accepts only its own first step and prevents a concurrent second start", async () => {
  const launch = vi.fn((_file: string, args: readonly string[]) => {
    const proc = child();
    queueMicrotask(() => proc.emit("spawn"));
    setTimeout(async () => {
      const runId = args[args.indexOf("-RunId") + 1];
      const now = new Date().toISOString();
      await writeFile(join(fx.dataDir, "dashboard-update-progress.json"), JSON.stringify({
        schema: 1, runId, targetCommit: target, state: "running",
        phase: "download", step: 1, totalSteps: 8, message: "GitHub wird geladen",
        startedAt: now, updatedAt: now, pid: 1234, processStartedAt: now,
      }));
    }, 30);
    return proc as unknown as ReturnType<typeof spawn>;
  }) as unknown as typeof spawn;
  const fx = await fixture(launch);
  try {
    let release!: () => void;
    vi.spyOn(fx.hooks, "stageUpdater").mockImplementation(() => new Promise((resolveStage) => {
      release = () => resolveStage(join(fx.root, "updates", "verified.ps1"));
    }));
    const first = fx.service.install(target);
    while (!release) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    await expect(fx.service.install(target)).rejects.toThrow("läuft bereits");
    release();
    await first;
    expect(launch).toHaveBeenCalledTimes(1);
    expect(existsSync(join(fx.root, "updates", "dashboard-update-start.guard"))).toBe(false);
    expect((await fx.service.status()).progress?.phase).toBe("download");
  } finally { await cleanup(fx.root); }
});

it("does not accept its own starting record plus a lock without a script acknowledgement", async () => {
  const proc = child();
  const launch = vi.fn(() => {
    queueMicrotask(() => {
      proc.emit("spawn");
      void writeFile(join(fx.root, "updates", "dashboard-update.lock"), "unconfirmed");
    });
    return proc as unknown as ReturnType<typeof spawn>;
  }) as unknown as typeof spawn;
  const fx = await fixture(launch, 50);
  try {
    // The service writes 'starting'; a lock alone must never imply that the script ran.
    await expect(fx.service.install(target)).rejects.toThrow("Start nicht bestätigt");
    expect(proc.kill).toHaveBeenCalled();
    expect(existsSync(join(fx.root, "updates", "dashboard-update-start.guard"))).toBe(false);
  } finally { await cleanup(fx.root); }
});
