import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FridayConfig } from "@friday/config";
import { InstallationInfoService } from "../src/services/installation-info";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("installation info", () => {
  const dirs: string[] = [];
  const tempDir = (): string => {
    const dir = mkdtempSync(join(tmpdir(), "friday-installation-"));
    dirs.push(dir);
    return dir;
  };
  const service = (dataDir: string): InstallationInfoService => new InstallationInfoService({
    paths: { dataDir },
    server: { host: "127.0.0.1", port: 8787 },
  } as unknown as FridayConfig);

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("keeps one installation id across service instances", () => {
    const dataDir = tempDir();
    const first = service(dataDir).installationId();
    expect(first).toMatch(UUID);
    expect(service(dataDir).installationId()).toBe(first);
    expect(JSON.parse(readFileSync(join(dataDir, "installation.json"), "utf8"))).toEqual({ installationId: first });
  });

  it("replaces an invalid stored id", () => {
    const dataDir = tempDir();
    writeFileSync(join(dataDir, "installation.json"), JSON.stringify({ installationId: "x" }));
    const id = service(dataDir).installationId();
    expect(id).not.toBe("x");
    expect(id).toMatch(UUID);
    expect(JSON.parse(readFileSync(join(dataDir, "installation.json"), "utf8"))).toEqual({ installationId: id });
  });

  it("reports the installed dashboard commit only when it is a full sha", () => {
    const dataDir = tempDir();
    const info = service(dataDir);
    expect(info.dashboard()).toEqual({ commit: null, installedAt: null });
    const commit = "a".repeat(40);
    const installedAt = "2026-10-29T10:00:00.000Z";
    writeFileSync(join(dataDir, "dashboard-revision.json"), JSON.stringify({ commit, installedAt }));
    expect(info.dashboard()).toEqual({ commit, installedAt });
    writeFileSync(join(dataDir, "dashboard-revision.json"), JSON.stringify({ commit: "abc", installedAt }));
    expect(info.dashboard()).toEqual({ commit: null, installedAt });
  });

  it("names the process that owns the configured port", () => {
    const info = service(tempDir()).info();
    expect(info.installationId).toMatch(UUID);
    expect(info.controlApi).toMatchObject({ host: "127.0.0.1", port: 8787, pid: process.pid });
    expect(Number.isNaN(Date.parse(info.controlApi.startedAt))).toBe(false);
  });
});
