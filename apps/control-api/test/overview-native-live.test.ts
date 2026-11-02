/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies that the contract validators check */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { LocalCalendarService } from "../src/services/local-calendar";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

const PASSWORD = "overview-native-password";
// A fresh live installation: no calendar, mail or notification adapter at all.
const ADAPTERS = "allowlist: {}\nadapters: {}\n";

const dir = mkdtempSync(join(tmpdir(), "friday-overview-native-"));
let api: TestApi;
let owner: ApiClient;

beforeAll(async () => {
  api = await startTestApi({ dir, dataMode: "live", authMode: "local", ownerPassword: PASSWORD, adaptersYaml: ADAPTERS,
    env: { FRIDAY_STORAGE_PATH: "/" } });
  owner = api.client();
  expect((await owner.loginOwner(PASSWORD)).statusCode).toBe(200);
});

afterAll(async () => {
  await api?.close();
  rmSync(dir, { recursive: true, force: true });
});

// Live report 2026-11-02: mission timeline, alerts and "Termine heute" said "Nicht verbunden" although Friday keeps its own
// calendar and alerts.
it("serves the mission timeline from Friday's own calendar and never asks to attend to unconfigured modules", async () => {
  const start = new Date(Date.now() + 3_600_000);
  const event = new LocalCalendarService(api.runtime.db).create(
    { title: "Planung", start: start.toISOString(), end: new Date(start.getTime() + 1_800_000).toISOString(), timeZone: "Europe/Berlin" },
    "owner");

  const response = await owner.get("/api/v1/overview");
  expect(response.statusCode, response.body).toBe(200);
  const overview = response.json().data;
  expect(overview.nextEvents.map((item: any) => item.id)).toContain(event.id);
  const unconfigured = overview.degradedSections.map((entry: any) => entry.adapterId).filter((id: string) => id.startsWith("unconfigured-"));
  expect(unconfigured).not.toContain("unconfigured-calendar");
  expect(unconfigured).not.toContain("unconfigured-notifications");
  expect(overview.attention.filter((item: any) => item.id.startsWith("unconfigured-"))).toEqual([]);
  const commands = new Map(overview.quickCommands.map((command: any) => [command.id, command.enabled]));
  expect(commands.get("today-events")).toBe(true);
  expect(commands.get("day-briefing")).toBe(true);

  const capabilities = (await owner.get("/api/v1/capabilities")).json().modules;
  expect(capabilities.calendar.read).toBe(true);
  expect(capabilities.notifications.read).toBe(true);
  expect(capabilities.approvals.read).toBe(true);
});
