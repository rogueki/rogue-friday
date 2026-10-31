import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { VoiceModeSwitchService } from "../src/services/voice-mode-switch";

const roots: string[] = [];

async function fixture(options: { installer?: boolean; platform?: NodeJS.Platform; fail?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "friday-voice-mode-"));
  roots.push(root);
  const dataDir = join(root, "dashboard", "data");
  await mkdir(dataDir, { recursive: true });
  if (options.installer !== false) {
    await mkdir(join(root, "installer"), { recursive: true });
    await writeFile(join(root, "installer", "install-friday-gui.ps1"), "");
  }
  const children: Array<EventEmitter & { unref: ReturnType<typeof vi.fn> }> = [];
  const launch = vi.fn(() => {
    const proc = Object.assign(new EventEmitter(), { unref: vi.fn() });
    children.push(proc);
    queueMicrotask(() => options.fail ? proc.emit("error", new Error("ENOENT")) : proc.emit("spawn"));
    return proc;
  });
  let clock = 1_000_000;
  const service = new VoiceModeSwitchService({ paths: { dataDir } } as never, launch as unknown as typeof spawn,
    options.platform ?? "win32", () => clock);
  return { root, service, launch, children, advance: (ms: number) => { clock += ms; } };
}

afterEach(async () => {
  for (const root of roots.splice(0)) if (resolve(root).startsWith(resolve(tmpdir()))) await rm(root, { recursive: true, force: true });
});

it("starts the installer window detached in change-voice mode for the install root", async () => {
  const { root, service, launch, children } = await fixture();
  await service.start("elevenlabs");

  expect(launch).toHaveBeenCalledTimes(1);
  const [command, args, options] = launch.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
  expect(command).toBe("powershell.exe");
  expect(args).toEqual(["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", join(root, "installer", "install-friday-gui.ps1"),
    "-ChangeVoice", "-ResumeRoot", root, "-VoiceTarget", "elevenlabs"]);
  expect(options).toMatchObject({ cwd: root, detached: true, stdio: "ignore" });
  expect(children[0]?.unref).toHaveBeenCalled();
});

it("refuses a second start while the UAC prompt may still be open, and allows it a minute later", async () => {
  const { service, launch, advance } = await fixture();
  await service.start("local");
  await expect(service.start("local")).rejects.toMatchObject({ code: "CONFLICT" });
  advance(61_000);
  await service.start("local");
  expect(launch).toHaveBeenCalledTimes(2);
});

it("reports a missing installer, another platform and a failed start without launching twice", async () => {
  const missing = await fixture({ installer: false });
  await expect(missing.service.start("local")).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE", message: expect.stringContaining("Installer fehlt") });
  expect(missing.launch).not.toHaveBeenCalled();

  const linux = await fixture({ platform: "linux" });
  await expect(linux.service.start("local")).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE", message: expect.stringContaining("Windows") });
  expect(linux.launch).not.toHaveBeenCalled();

  const failing = await fixture({ fail: true });
  await expect(failing.service.start("local")).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  // A failed start does not block the next attempt.
  await expect(failing.service.start("local")).rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  expect(failing.launch).toHaveBeenCalledTimes(2);
});

it("lets only the owner open the installer, validates the target and records the start in the audit log", async () => {
  const { startTestApi } = await import("./helpers");
  const api = await startTestApi();
  try {
    const start = vi.fn(async () => undefined);
    (api.runtime as unknown as { voiceModeSwitch: { start: typeof start } }).voiceModeSwitch = { start };
    const owner = api.client();
    await owner.loginDev("owner");
    const invalid = await owner.post("/api/v1/voice/mode-switch", { target: "cloud" });
    expect([400, 422]).toContain(invalid.statusCode);
    expect(start).not.toHaveBeenCalled();

    const response = await owner.post("/api/v1/voice/mode-switch", { target: "elevenlabs" });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ accepted: true, status: "queued" });
    expect(start).toHaveBeenCalledWith("elevenlabs");
    const audit = await owner.get("/api/v1/audit/events?limit=20");
    expect(audit.body).toContain("voice.mode_switch_started");

    const operator = api.client();
    await operator.loginDev("operator");
    expect((await operator.post("/api/v1/voice/mode-switch", { target: "local" })).statusCode).toBe(403);
    expect(start).toHaveBeenCalledTimes(1);
  } finally { await api.close(); }
});
