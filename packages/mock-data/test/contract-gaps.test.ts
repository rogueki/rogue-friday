import { describe, expect, it } from "vitest";
import { MockWorld } from "../src";
import { eventProblems, expectApiError, record } from "./support";

const first = <T>(items: readonly T[], predicate: (item: T) => boolean): T => {
  const found = items.find(predicate);
  if (!found) throw new Error("fixture missing");
  return found;
};

describe("files.rename", () => {
  it("renames in place, bumps the version and keeps the audit trail", () => {
    const world = new MockWorld();
    const recorder = record(world);
    const file = first(world.state.files, (candidate) => candidate.category === "reports");
    const { version, name, location } = file;
    const renamed = world.files.rename(file.id, { name: "Quartalsbericht neu.md" }, { ifMatch: version });
    expect(renamed).toMatchObject({ id: file.id, name: "Quartalsbericht neu.md", version: version + 1, location });
    expect(recorder.events.some((event) => event.type === "friday.file.updated")).toBe(true);
    expect(world.state.audit.at(-1)).toMatchObject({ action: "file.renamed", before: { name } });
    expect(world.verifyAudit().valid).toBe(true);
    expect(eventProblems(recorder.events)).toEqual([]);
  });

  it("answers 409 for a stale version or a taken name and 422 for an invalid name", () => {
    const world = new MockWorld();
    const [a, b] = world.state.files.filter((candidate) => candidate.location === world.state.files[0]!.location);
    expect(a && b).toBeTruthy();
    expect(expectApiError(() => world.files.rename(a!.id, { name: "x.md" }, { ifMatch: a!.version + 5 }))).toMatchObject({ code: "CONFLICT" });
    expect(expectApiError(() => world.files.rename(a!.id, { name: b!.name.toUpperCase() }))).toMatchObject({ code: "CONFLICT" });
    expect(expectApiError(() => world.files.rename(a!.id, { name: ".." }))).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(expectApiError(() => world.files.rename(a!.id, { name: "a/b.md" }))).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(expectApiError(() => world.files.rename("file_00000000000000000000000000", { name: "x.md" }))).toMatchObject({ code: "NOT_FOUND" });
  });

  it("is not offered when the capability is switched off", () => {
    const world = new MockWorld();
    world.setCapability("files", "rename", false);
    const file = world.state.files[0]!;
    expect(expectApiError(() => world.files.rename(file.id, { name: "neu.md" }))).toMatchObject({ code: "CAPABILITY_MISSING" });
  });
});

describe("adapter restart and logs", () => {
  it("restarts through recovering to online and logs the steps", () => {
    const world = new MockWorld();
    const result = world.meta.restartAdapter("mock-voice");
    expect(result).toMatchObject({ accepted: true, status: "queued", resourceId: "mock-voice" });
    expect(world.adapterHealth("voice").lifecycle).toBe("RECOVERING");
    world.clock.advance(2_000);
    expect(world.adapterHealth("voice").lifecycle).toBe("ONLINE");
    const lines = world.meta.listAdapterLogs("mock-voice").items.map((entry) => entry.message);
    expect(lines).toEqual(expect.arrayContaining(["Neustart angefordert", "Adapter neu gestartet"]));
    expect(world.state.audit.at(-1)?.action).toBe("adapter.restarted");
    expect(expectApiError(() => world.meta.restartAdapter("unbekannt"))).toMatchObject({ code: "NOT_FOUND" });
  });

  it("filters logs by adapter, level and limit (newest last)", () => {
    const world = new MockWorld();
    world.setAdapterState("tasks", "offline");
    const all = world.meta.listAdapterLogs("mock-tasks").items;
    expect(all.every((entry) => entry.adapterId === "mock-tasks")).toBe(true);
    expect(all.map((entry) => entry.timestamp)).toEqual([...all.map((entry) => entry.timestamp)].sort());
    expect(world.meta.listAdapterLogs("mock-tasks", { level: "error" }).items).toHaveLength(1);
    expect(world.meta.listAdapterLogs("mock-tasks", { limit: 2 }).items).toHaveLength(2);
    expect(expectApiError(() => world.meta.listAdapterLogs("mock-tasks", { level: "laut" }))).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(expectApiError(() => world.meta.listAdapterLogs("mock-tasks", { limit: 0 }))).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("keeps the log buffer bounded", () => {
    const world = new MockWorld();
    for (let index = 0; index < 600; index++) world.logAdapter("mock-tasks", "debug", `Zeile ${index}`);
    expect(world.state.adapterLogs.length).toBeLessThanOrEqual(500);
    expect(world.meta.listAdapterLogs("mock-tasks", { limit: 1 }).items[0]?.message).toBe("Zeile 599");
  });
});

describe("memory export and conflict resolution", () => {
  it("exports everything except restricted memories, which are only counted", () => {
    const world = new MockWorld();
    const restricted = world.state.memory.filter((memory) => memory.sensitivity === "restricted").length;
    expect(restricted).toBeGreaterThan(0);
    const exported = world.memory.exportAll();
    expect(exported.count).toBe(world.state.memory.length - restricted);
    expect(exported.omittedRestricted).toBe(restricted);
    expect(exported.items.some((memory) => memory.sensitivity === "restricted")).toBe(false);
  });

  const pair = (world: MockWorld) => {
    const memory = first(world.state.memory, (candidate) => candidate.conflicts.some((entry) => entry.resolution === "pending"));
    const entry = memory.conflicts.find((candidate) => candidate.resolution === "pending")!;
    return { memory, entry, other: first(world.state.memory, (candidate) => candidate.id === entry.memoryId) };
  };

  it("keep_both and dismiss mark both sides", () => {
    for (const [resolution, expected] of [["keep_both", "keep_both"], ["dismiss", "dismissed"]] as const) {
      const world = new MockWorld();
      const { memory, entry, other } = pair(world);
      const resolved = world.memory.resolveConflict(memory.id, entry.memoryId, { resolution, note: "geprüft" });
      expect(resolved.conflicts.find((candidate) => candidate.memoryId === other.id)?.resolution).toBe(expected);
      expect(other.conflicts.find((candidate) => candidate.memoryId === memory.id)?.resolution).toBe(expected);
      expect(resolved.history.at(-1)?.summary).toContain("geprüft");
      expect(world.state.memory.some((candidate) => candidate.id === other.id)).toBe(true);
    }
  });

  it("replace forgets the conflicting memory and refuses locked ones", () => {
    const world = new MockWorld();
    const recorder = record(world);
    const { memory, entry, other } = pair(world);
    other.locked = true;
    expect(expectApiError(() => world.memory.resolveConflict(memory.id, entry.memoryId, { resolution: "replace" }))).toMatchObject({ code: "CONFLICT" });
    other.locked = false;
    const resolved = world.memory.resolveConflict(memory.id, entry.memoryId, { resolution: "replace" });
    expect(resolved.conflicts.find((candidate) => candidate.memoryId === other.id)?.resolution).toBe("replaced");
    expect(world.state.memory.some((candidate) => candidate.id === other.id)).toBe(false);
    expect(recorder.events.some((event) => event.type === "friday.memory.deleted")).toBe(true);
    expect(world.state.audit.at(-1)).toMatchObject({ action: "memory.conflict_resolved", severity: "warning" });
    expect(eventProblems(recorder.events)).toEqual([]);
  });

  it("rejects unknown and already resolved conflicts", () => {
    const world = new MockWorld();
    const { memory, entry } = pair(world);
    expect(expectApiError(() => world.memory.resolveConflict(memory.id, "mem_00000000000000000000000000", { resolution: "dismiss" }))).toMatchObject({ code: "NOT_FOUND" });
    world.memory.resolveConflict(memory.id, entry.memoryId, { resolution: "dismiss" });
    expect(expectApiError(() => world.memory.resolveConflict(memory.id, entry.memoryId, { resolution: "dismiss" }))).toMatchObject({ code: "CONFLICT" });
    expect(expectApiError(() => world.memory.resolveConflict(memory.id, entry.memoryId, { resolution: "wegwerfen" as never }))).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("automation versions and Pause All", () => {
  it("records one version per definition change, newest first, exactly one current", () => {
    const world = new MockWorld();
    const automation = first(world.state.automations, (candidate) => candidate.enabled && !candidate.paused);
    const start = automation.version;
    expect(world.automations.listVersions(automation.id).items).toHaveLength(start);
    world.automations.update(automation.id, { name: "Neuer Name" });
    world.automations.disable(automation.id);
    const versions = world.automations.listVersions(automation.id).items;
    expect(versions.map((entry) => entry.version)).toEqual([start + 2, start + 1, ...Array.from({ length: start }, (_, index) => start - index)]);
    expect(versions.filter((entry) => entry.current)).toHaveLength(1);
    expect(versions[0]).toMatchObject({ current: true, summary: "Automation deaktiviert.", snapshot: { name: "Neuer Name", enabled: false } });
    expect(versions[1]?.summary).toContain("Name");
    expect(expectApiError(() => world.automations.listVersions("auto_00000000000000000000000000"))).toMatchObject({ code: "NOT_FOUND" });
  });

  it("pauses every enabled automation once and reports per automation", () => {
    const world = new MockWorld();
    const recorder = record(world);
    const enabled = world.state.automations.filter((automation) => automation.enabled && !automation.paused).length;
    expect(enabled).toBeGreaterThan(0);
    const result = world.automations.pauseAll({ reason: "Urlaub" });
    expect(result.pausedCount).toBe(enabled);
    expect(result.results).toHaveLength(world.state.automations.length);
    expect(result.results.filter((entry) => entry.outcome === "paused")).toHaveLength(enabled);
    expect(world.state.automations.filter((automation) => automation.enabled).every((automation) => automation.paused && automation.nextRunAt === null)).toBe(true);
    const paused = first(result.results, (entry) => entry.outcome === "paused");
    expect(world.automations.listVersions(paused.automationId).items[0]?.summary).toContain("Urlaub");
    expect(recorder.events.filter((event) => event.type === "friday.automation.updated")).toHaveLength(enabled);
    expect(world.state.audit.at(-1)).toMatchObject({ action: "automation.paused_all" });
    const again = world.automations.pauseAll();
    expect(again).toMatchObject({ pausedCount: 0, failedCount: 0 });
    expect(again.results.every((entry) => entry.outcome !== "paused")).toBe(true);
  });
});

describe("communication.listDrafts", () => {
  it("filters by thread and status, newest change first", () => {
    const world = new MockWorld();
    const threaded = first(world.state.drafts, (draft) => draft.threadId !== null);
    const page = world.communication.listDrafts({ threadId: threaded.threadId! });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((draft) => draft.threadId === threaded.threadId)).toBe(true);
    const all = world.communication.listDrafts({ status: ["draft"] });
    expect(all.items.every((draft) => draft.status === "draft")).toBe(true);
    const times = world.communication.listDrafts().items.map((draft) => draft.updatedAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(expectApiError(() => world.communication.listDrafts({ status: ["unbekannt"] as never }))).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("voice enrollment and history", () => {
  it("runs a job through capturing and calibrating to completed and updates the profile", () => {
    const world = new MockWorld();
    const profile = world.state.voice.profiles[0]!;
    const before = { samples: profile.sampleCount, quality: profile.quality, version: profile.version };
    const job = world.voice.enroll(profile.id, { sampleTarget: 4, recalibrate: true });
    expect(job).toMatchObject({ status: "queued", samplesCaptured: 0, samplesRequired: 4, finishedAt: null });
    expect(expectApiError(() => world.voice.enroll(profile.id))).toMatchObject({ code: "CONFLICT" });

    world.clock.advance(500 + 1_500 * 2);
    expect(world.voice.getEnrollment(job.id)).toMatchObject({ status: "capturing", samplesCaptured: 2, message: expect.stringContaining("3 von 4") });
    world.clock.advance(1_500 * 2);
    expect(world.voice.getEnrollment(job.id).status).toBe("calibrating");
    world.clock.advance(2_000);
    const done = world.voice.getEnrollment(job.id);
    expect(done).toMatchObject({ status: "completed", samplesCaptured: 4, progress: { mode: "determinate", value: 1 } });
    expect(done.finishedAt).not.toBeNull();
    expect(done.quality).toBeGreaterThan(before.quality);
    const after = world.voice.listProfiles().items.find((candidate) => candidate.id === profile.id)!;
    expect(after).toMatchObject({ sampleCount: before.samples + 4, version: before.version + 1, lastTestResult: "unknown" });
    expect(after.calibratedAt).toBe(done.finishedAt);
    // a finished job is applied exactly once
    world.clock.advance(10_000);
    expect(world.voice.listProfiles().items.find((candidate) => candidate.id === profile.id)?.sampleCount).toBe(before.samples + 4);
    expect(world.voice.enroll(profile.id).status).toBe("queued");
    expect(world.verifyAudit().valid).toBe(true);
  });

  it("answers 404 for unknown profiles and jobs", () => {
    const world = new MockWorld();
    expect(expectApiError(() => world.voice.enroll("vprof_00000000000000000000000000"))).toMatchObject({ code: "NOT_FOUND" });
    expect(expectApiError(() => world.voice.getEnrollment("venr_00000000000000000000000000"))).toMatchObject({ code: "NOT_FOUND" });
    expect(expectApiError(() => world.voice.enroll(world.state.voice.profiles[0]!.id, { sampleTarget: 1 }))).toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("deletes the voice history only after confirmation, completely or before a point in time", () => {
    const world = new MockWorld();
    const total = world.state.voice.history.length;
    expect(total).toBeGreaterThan(10);
    expect(expectApiError(() => world.voice.deleteHistory({ confirm: false }))).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(world.state.voice.history).toHaveLength(total);
    const cutoff = world.state.voice.history[10]!;
    const partial = world.voice.deleteHistory({ confirm: true, before: cutoff });
    expect(partial.message).toMatch(/Verlaufseinträge wurden gelöscht/);
    expect(world.state.voice.history.every((at) => Date.parse(at) >= Date.parse(cutoff))).toBe(true);
    expect(world.state.voice.history.length).toBeLessThan(total);
    const rest = world.state.voice.history.length;
    expect(world.voice.deleteHistory({ confirm: true }).message).toContain(String(rest));
    expect(world.state.voice.history).toEqual([]);
    expect(world.state.audit.at(-1)).toMatchObject({ action: "voice.history_deleted", severity: "warning" });
    expect(expectApiError(() => world.voice.deleteHistory({ confirm: true, before: "gestern" }))).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("tasks.assign and tasks.input", () => {
  it("assigns, reassigns a running task (freeing the old agent) and releases", () => {
    const world = new MockWorld();
    const task = first(world.state.tasks, (candidate) => candidate.status === "running" && candidate.agentId !== null);
    const oldAgent = world.agents.find(task.agentId!);
    const newAgent = first(world.state.agents, (agent) => agent.status === "idle");
    const version = task.version;
    const moved = world.tasks.assign(task.id, { agentId: newAgent.id, reason: "Mehr Kapazität" }, { ifMatch: version });
    expect(moved).toMatchObject({ agentId: newAgent.id, agentName: newAgent.name, version: version + 1 });
    expect(oldAgent.currentTaskId).not.toBe(task.id);
    expect(world.agents.find(newAgent.id)).toMatchObject({ status: "working", currentTaskId: task.id });
    const released = world.tasks.assign(task.id, { agentId: null });
    expect(released.agentId).toBeNull();
    expect(released.agentName).toBeUndefined();
    expect(world.state.audit.at(-1)).toMatchObject({ action: "task.assigned" });
  });

  it("refuses unknown agents (422), finished tasks and stale versions (409)", () => {
    const world = new MockWorld();
    const open = first(world.state.tasks, (task) => task.status === "todo" || task.status === "ready");
    const done = first(world.state.tasks, (task) => task.status === "done");
    expect(expectApiError(() => world.tasks.assign(open.id, { agentId: "agent_00000000000000000000000000" }))).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(expectApiError(() => world.tasks.assign(done.id, { agentId: null }))).toMatchObject({ code: "CONFLICT" });
    expect(expectApiError(() => world.tasks.assign(open.id, { agentId: null }, { ifMatch: open.version + 9 }))).toMatchObject({ code: "CONFLICT" });
  });

  it("resolves the input_needed blocker, continues the task and keeps the answer out of audit and events", () => {
    const world = new MockWorld();
    const recorder = record(world);
    const task = first(world.state.tasks, (candidate) => candidate.blockers.some((blocker) => blocker.kind === "input_needed"));
    const blocker = task.blockers.find((entry) => entry.kind === "input_needed")!;
    const answer = "Geheimer Freitext der Eingabe";
    const updated = world.tasks.provideInput(task.id, { input: answer, blockerId: blocker.id });
    expect(updated.blockers.some((entry) => entry.id === blocker.id)).toBe(false);
    if (updated.blockers.length === 0) expect(updated.status === "running" || updated.status === "ready").toBe(true);
    expect(JSON.stringify(world.state.audit.at(-1))).not.toContain(answer);
    expect(JSON.stringify(recorder.events)).not.toContain(answer);
    expect(expectApiError(() => world.tasks.provideInput(task.id, { input: "nochmal" }))).toMatchObject({ code: "CONFLICT" });
    expect(expectApiError(() => world.tasks.provideInput(task.id, { input: "" }))).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(eventProblems(recorder.events)).toEqual([]);
  });
});
