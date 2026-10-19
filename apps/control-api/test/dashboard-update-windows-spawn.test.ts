import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { TASK_LAUNCHER } from "../src/services/dashboard-update.js";

it.runIf(process.platform === "win32")("starts a harmless PowerShell script with updater launch options", async () => {
  const root = await mkdtemp(join(tmpdir(), "friday updater spawn "));
  try {
    const updates = join(root, "updates");
    await mkdir(updates);
    const script = join(updates, "dummy update.ps1");
    await writeFile(script, "param([string]$InstallRoot,[string]$ExpectedCommit,[string]$RunId)\nWrite-Output ('HELLO:'+ $PSCommandPath + ':' + $InstallRoot + ':' + $RunId)\n[IO.File]::WriteAllText((Join-Path $InstallRoot 'started.txt'),$RunId)\n");
    const runId = "a".repeat(32);
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script,
      "-InstallRoot", root, "-ExpectedCommit", "b".repeat(40), "-RunId", runId], {
      cwd: root, detached: false, stdio: "ignore", windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const exit = await new Promise<number | null>((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", resolveExit);
    });
    expect(exit).toBe(0);
    expect(existsSync(join(root, "started.txt"))).toBe(true);
    expect(await readFile(join(root, "started.txt"), "utf8")).toBe(runId);
  } finally {
    if (resolve(root).startsWith(resolve(tmpdir()))) await rm(root, { recursive: true, force: true });
  }
}, 12_000);

it.runIf(process.platform === "win32")("starts the exact scheduled update launcher after its parent exits", async () => {
  const root = await mkdtemp(join(tmpdir(), "friday updater scheduled "));
  const runId = "c".repeat(32);
  const taskName = `FRIDAY_Update_${runId}`;
  try {
    const launcher = join(root, "launcher.ps1");
    const script = join(root, "harmless update.ps1");
    await writeFile(launcher, TASK_LAUNCHER);
    await writeFile(script, "param([string]$InstallRoot,[string]$ExpectedCommit,[string]$RunId,[string]$TaskName)\nStart-Sleep -Seconds 2\n[IO.File]::WriteAllText((Join-Path $InstallRoot 'scheduled.txt'),$RunId)\nUnregister-ScheduledTask -TaskName $TaskName -Confirm:$false\n");
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcher,
      "-Updater", script, "-InstallRoot", root, "-ExpectedCommit", "b".repeat(40), "-RunId", runId], {
      cwd: root, detached: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    let stderr = "";
    child.stderr?.on("data", (part) => { stderr += String(part); });
    const exit = await new Promise<number | null>((resolveExit, rejectExit) => {
      child.once("error", rejectExit);
      child.once("exit", resolveExit);
    });
    expect(exit, stderr).toBe(0);
    expect(existsSync(join(root, "scheduled.txt"))).toBe(false);
    const deadline = Date.now() + 10_000;
    let completed = "";
    while (Date.now() < deadline) {
      // WriteAllText creates the file before its contents are necessarily visible to another process.
      try { completed = await readFile(join(root, "scheduled.txt"), "utf8"); } catch { completed = ""; }
      if (completed === runId) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    expect(completed).toBe(runId);
  } finally {
    const cleanup = spawn("powershell.exe", ["-NoProfile", "-Command",
      `Unregister-ScheduledTask -TaskName '${taskName}' -Confirm:$false -ErrorAction SilentlyContinue`], { stdio: "ignore" });
    await new Promise((resolveExit) => cleanup.once("exit", resolveExit));
    if (resolve(root).startsWith(resolve(tmpdir()))) await rm(root, { recursive: true, force: true });
  }
}, 15_000);
