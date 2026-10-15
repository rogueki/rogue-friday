import { describe, expect, it } from "vitest";
import { MockAdapterError, MockClock, MockWorld, IdFactory, Rng, nextCronRun, sha256Hex, verifyAuditChain } from "../src";
import { createWorld, eventProblems, expectApiError, record, validator } from "./support";

describe("deterministic foundations", () => {
  it("PRNG: same seed, same sequence; fork does not advance the parent", () => {
    const a = new Rng(7);
    const b = new Rng(7);
    expect([a.next(), a.int(1, 10), a.pick(["x", "y", "z"])]).toEqual([b.next(), b.int(1, 10), b.pick(["x", "y", "z"])]);
    const before = a.state;
    a.fork("errors");
    expect(a.state).toBe(before);
  });

  it("IDs have the contract shape and are reproducible", () => {
    const one = new IdFactory(1, 0);
    const two = new IdFactory(1, 0);
    const id = one.next("task");
    expect(id).toMatch(/^task_[0-9A-Za-z]{26}$/);
    expect(two.next("task")).toBe(id);
    expect(one.next("task")).not.toBe(id);
  });

  it("clock: advance fires timers in order, intervals repeat, setTime jumps", () => {
    const clock = new MockClock("2026-10-14T08:00:00.000Z");
    const log: string[] = [];
    clock.setTimeout(() => log.push("b"), 2000);
    clock.setTimeout(() => log.push("a"), 1000);
    const interval = clock.setInterval(() => log.push("i"), 700);
    clock.advance(2100);
    interval.cancel();
    expect(log).toEqual(["i", "a", "i", "b", "i"]);
    clock.setTime("2026-10-14T09:00:00.000Z");
    expect(clock.nowIso()).toBe("2026-10-14T09:00:00.000Z");
  });

  it("sha256 matches the known vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("cron: next run for weekday 07:00 Berlin (CEST) is 05:00Z", () => {
    expect(nextCronRun("0 7 * * 1-5", Date.parse("2026-10-14T08:15:00Z"), "Europe/Berlin")).toBe("2026-10-15T05:00:00.000Z");
  });

  it("same seed gives a byte-identical snapshot; a different seed differs", () => {
    const a = JSON.stringify(createWorld({ seed: 42 }).snapshot());
    const b = JSON.stringify(createWorld({ seed: 42 }).snapshot());
    const c = JSON.stringify(createWorld({ seed: 43 }).snapshot());
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("high-load generation stays within the time budget", () => {
    const started = performance.now();
    const world = createWorld({ profile: "highLoad" });
    const elapsed = performance.now() - started;
    expect(world.state.tasks).toHaveLength(1000);
    expect(world.state.activity).toHaveLength(10_000);
    expect(world.state.agents).toHaveLength(100);
    expect(elapsed).toBeLessThan(1500);
  });

  it("high-load seed objects validate", () => {
    const world = createWorld({ profile: "highLoad" });
    const sample = [
      ...world.state.tasks.filter((_, i) => i % 7 === 0).map((x) => ["Task", x] as const),
      ...world.state.activity.filter((_, i) => i % 41 === 0).map((x) => ["ActivityEvent", x] as const),
      ...world.state.agents.map((x) => ["Agent", x] as const),
      ...world.state.approvals.map((x) => ["Approval", x] as const),
      ...world.state.threads.map((x) => ["Thread", x] as const),
      ...world.state.memory.map((x) => ["Memory", x] as const),
      ...world.state.files.map((x) => ["FileItem", x] as const),
      ...world.state.notifications.map((x) => ["Notification", x] as const),
      ...world.state.audit.map((x) => ["AuditEvent", x] as const),
      ...world.state.automations.map((x) => ["Automation", x] as const),
    ];
    const failures = sample.filter(([schema, item]) => !validator.validate(schema, item).valid);
    expect(failures).toEqual([]);
  });

  it("audit hash chain of every profile is valid", () => {
    for (const profile of ["default", "empty", "highLoad", "longGerman"] as const) {
      expect(verifyAuditChain(createWorld({ profile }).state.audit).valid).toBe(true);
    }
  });
});

describe("tasks", () => {
  it("lists with filters, sorting and cursor pagination", () => {
    const world = createWorld();
    const running = world.tasks.list({ status: ["running"] as never });
    expect(running.items.length).toBeGreaterThan(0);
    expect(running.items.every((task) => task.status === "running")).toBe(true);
    const csv = world.tasks.list({ status: "running,waiting" as never });
    expect(csv.items.every((task) => ["running", "waiting"].includes(task.status))).toBe(true);
    expect(world.tasks.list({ q: "büromöbel" }).items.length).toBeGreaterThan(0);
    expect(world.tasks.list({ priority: ["P1"] as never }).items.every((task) => task.priority === "P1")).toBe(true);
    const page1 = world.tasks.list({ limit: 5, sort: "priority" });
    const page2 = world.tasks.list({ limit: 5, sort: "priority", cursor: page1.pageInfo.nextCursor as string });
    expect(page1.items).toHaveLength(5);
    expect(page1.items.map((t) => t.id)).not.toEqual(page2.items.map((t) => t.id));
    const ranks = page1.items.map((task) => Number(task.priority.slice(1)));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(expectApiError(() => world.tasks.list({ status: ["bogus"] as never })).code).toBe("VALIDATION_FAILED");
    expect(expectApiError(() => world.tasks.list({ limit: 0 })).code).toBe("VALIDATION_FAILED");
  });

  it("covers all statuses and progress kinds in the default profile", () => {
    const world = createWorld();
    expect(new Set(world.state.tasks.map((task) => task.status))).toEqual(new Set(["triage", "todo", "ready", "running", "waiting", "review", "done", "failed", "cancelled"]));
    expect(new Set(world.state.tasks.map((task) => task.progress.mode))).toEqual(new Set(["determinate", "indeterminate", "none"]));
    expect(world.state.tasks.some((task) => task.blockers.length > 0)).toBe(true);
  });

  it("create/patch bump version and updatedAt, emit events and append audit", () => {
    const world = createWorld();
    const recorder = record(world);
    const created = world.tasks.create({ title: "Wartungsvertrag prüfen", priority: "P2" });
    expect(created.version).toBe(1);
    world.clock.advance(5_000);
    const updated = world.tasks.update(created.id, { priority: "P1" }, { ifMatch: created.version });
    expect(updated.version).toBe(2);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt));
    const types = recorder.events.map((event) => event.type);
    expect(types).toContain("friday.task.created");
    expect(types).toContain("friday.task.updated");
    expect(types).toContain("friday.audit.appended");
    expect(world.state.audit.at(-1)?.action).toBe("task.updated");
    expect(eventProblems(recorder.events)).toEqual([]);
  });

  it("If-Match mismatch yields CONFLICT, quoted ETags are accepted", () => {
    const world = createWorld();
    const task = world.tasks.create({ title: "Konfliktprobe" });
    expect(expectApiError(() => world.tasks.update(task.id, { title: "x" }, { ifMatch: 99 }))).toEqual({ code: "CONFLICT", status: 409 });
    expect(world.tasks.update(task.id, { title: "y" }, { ifMatch: `W/"${task.version}"` }).title).toBe("y");
  });

  it("idempotency: repeated key replays the stored result without side effects; reuse for another body conflicts", () => {
    const world = createWorld();
    const recorder = record(world);
    const first = world.tasks.create({ title: "Einmalig" }, { idempotencyKey: "idem-key-0001" });
    const eventsAfterFirst = recorder.events.length;
    const second = world.tasks.create({ title: "Einmalig" }, { idempotencyKey: "idem-key-0001" });
    expect(second).toEqual(first);
    expect(recorder.events).toHaveLength(eventsAfterFirst);
    expect(world.state.tasks.filter((task) => task.title === "Einmalig")).toHaveLength(1);
    expect(expectApiError(() => world.tasks.create({ title: "Anders" }, { idempotencyKey: "idem-key-0001" })).code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("cancel / retry / pause / resume follow state rules", () => {
    const world = createWorld();
    const running = world.state.tasks.find((task) => task.status === "running" && task.agentId) as NonNullable<MockWorld["state"]["tasks"][number]>;
    const paused = world.tasks.pause(running.id);
    expect(paused.status).toBe("waiting");
    expect(world.agents.get(running.agentId as string).status).toBe("paused");
    expect(world.tasks.resume(running.id).status).toBe("running");
    expect(expectApiError(() => world.tasks.resume(running.id)).code).toBe("CONFLICT");
    const cancelled = world.tasks.cancel(running.id, { reason: "Test" });
    expect(cancelled.status).toBe("cancelled");
    expect(expectApiError(() => world.tasks.cancel(running.id)).code).toBe("CONFLICT");
    expect(world.tasks.retry(running.id).status).toBe("running");
    expect(expectApiError(() => world.tasks.get("task_00000000000000000000000000")).code).toBe("NOT_FOUND");
  });
});

describe("memory", () => {
  it("has all 10 types, locked/pinned/sensitive entries, conflicts, TTL and history", () => {
    const world = createWorld();
    const memories = world.state.memory;
    expect(new Set(memories.map((memory) => memory.type)).size).toBe(10);
    expect(memories.some((memory) => memory.locked)).toBe(true);
    expect(memories.some((memory) => memory.pinned)).toBe(true);
    expect(memories.some((memory) => memory.sensitivity === "restricted")).toBe(true);
    expect(memories.some((memory) => memory.conflicts.length > 0)).toBe(true);
    expect(memories.some((memory) => memory.ttlSeconds)).toBe(true);
    expect(memories.every((memory) => memory.history.length > 0)).toBe(true);
  });

  it("CRUD with locks, history and deletion audit", () => {
    const world = createWorld();
    const created = world.memory.create({ type: "fact", content: "Der Server steht im Raum 3.", title: "Serverraum", tags: ["it"] });
    expect(created.history[0]?.change).toBe("created");
    const confirmed = world.memory.update(created.id, { confirm: true, locked: true });
    expect(confirmed.confirmedAt).not.toBeNull();
    expect(confirmed.history.map((entry) => entry.change)).toEqual(expect.arrayContaining(["confirmed", "locked"]));
    expect(expectApiError(() => world.memory.update(created.id, { content: "neu" })).code).toBe("CONFLICT");
    expect(expectApiError(() => world.memory.delete(created.id)).code).toBe("CONFLICT");
    world.memory.update(created.id, { locked: false });
    const before = world.state.audit.length;
    const result = world.memory.delete(created.id);
    expect(result.status).toBe("completed");
    expect(world.state.audit.length).toBe(before + 1);
    expect(expectApiError(() => world.memory.get(created.id)).code).toBe("NOT_FOUND");
  });

  it("token-overlap search ranks the best match first and honours filters", () => {
    const world = createWorld();
    const hits = world.memory.search({ query: "Zahlungsziel Becker" });
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0]?.memory.title).toContain("Zahlungsziel");
    expect(hits.map((hit) => hit.score)).toEqual([...hits.map((hit) => hit.score)].sort((a, b) => b - a));
    expect(world.memory.search({ query: "Becker", types: ["person"] }).every((hit) => hit.memory.type === "person")).toBe(true);
    expect(world.memory.search({ query: "Gutschein" })).toHaveLength(0);
    expect(world.memory.search({ query: "Gutschein", includeExpired: true }).length).toBeGreaterThan(0);
    expect(world.memory.search({ query: "buro moebel", semantic: true }).length).toBeGreaterThanOrEqual(0);
  });
});

describe("approvals and drafts", () => {
  it("covers all types, risk tiers and statuses", () => {
    const world = createWorld();
    const types = new Set(world.state.approvals.map((approval) => approval.type));
    expect(types.size).toBe(8);
    expect(new Set(world.state.approvals.map((approval) => approval.riskTier))).toEqual(new Set([1, 2, 3]));
    expect(new Set(world.state.approvals.map((approval) => approval.status))).toEqual(new Set(["pending", "approved", "rejected", "expired", "cancelled", "executed", "failed"]));
    expect(world.state.approvals.every((approval) => approval.preview.body.length > 0)).toBe(true);
  });

  it("request-send creates an approval and never sends; approve executes and emits follow-up events", () => {
    const world = createWorld();
    const channel = world.state.channels.find((candidate) => candidate.kind === "email") as NonNullable<MockWorld["state"]["channels"][number]>;
    const draft = world.communication.createDraft({ channelId: channel.id, to: [{ name: "Katharina Becker", address: "k.becker@becker-maschinenbau.example" }], subject: "Unterlagen", body: "Anbei die Unterlagen." });
    const messagesBefore = world.state.messages.length;
    const recorder = record(world);
    const approval = world.communication.requestSend(draft.id, {}, { idempotencyKey: "idem-send-0001" });
    expect(approval.status).toBe("pending");
    expect(world.communication.requestSend(draft.id, {}, { idempotencyKey: "idem-send-0001" }).id).toBe(approval.id);
    expect(world.state.drafts.find((candidate) => candidate.id === draft.id)?.status).toBe("pending_approval");
    expect(world.state.messages).toHaveLength(messagesBefore);
    world.clock.advance(120_000);
    expect(world.approvals.get(approval.id).status).toBe("pending");

    const approved = world.approvals.approve(approval.id, { comment: "Passt" });
    expect(approved.status).toBe("executed");
    expect(approved.executionResult).toContain("gesendet");
    expect(world.state.drafts.find((candidate) => candidate.id === draft.id)?.status).toBe("sent");
    const types = recorder.events.map((event) => event.type);
    expect(types.filter((type) => type === "friday.approval.resolved").length).toBe(2);
    expect(types).toContain("friday.communication.draft_updated");
    expect(expectApiError(() => world.approvals.approve(approval.id)).code).toBe("CONFLICT");
    expect(eventProblems(recorder.events)).toEqual([]);
  });

  it("reject returns the draft to draft state; expiry fires on the clock", () => {
    const world = createWorld();
    const pending = world.approvals.list({ status: ["pending"] as never, type: ["send_email"] as never }).items[0];
    expect(pending).toBeDefined();
    const rejected = world.approvals.reject(pending?.id as string, { comment: "Nein" });
    expect(rejected.status).toBe("rejected");
    expect(world.state.drafts.find((draft) => draft.approvalId === pending?.id)).toBeUndefined();
    const expiring = world.approvals.raise({ type: "send_message", action: "Kurzlebig", riskTier: 1, rationale: "Test", preview: { kind: "text", title: "t", body: "b" }, expiresInMs: 60_000 });
    const types: string[] = [];
    world.events.subscribe((event) => types.push(event.type));
    world.clock.advance(61_000);
    expect(world.approvals.get(expiring.id).status).toBe("expired");
    expect(types).toContain("friday.approval.expired");
  });

  it("Tier 3 needs re-authentication and is never approvable by voice alone", () => {
    const world = createWorld();
    const payment = world.state.approvals.find((approval) => approval.type === "payment" && approval.status === "pending") as NonNullable<MockWorld["state"]["approvals"][number]>;
    expect(payment.requiredAuth).toBe("reauth");
    expect(expectApiError(() => world.approvals.approve(payment.id)).code).toBe("REAUTH_REQUIRED");
    const reauth = world.auth.reauth({ password: "egal" });
    expect(expectApiError(() => world.approvals.approve(payment.id, { reauthToken: reauth.reauthToken }, { inputChannel: "voice" })).code).toBe("FORBIDDEN");
    const done = world.approvals.approve(payment.id, { reauthToken: reauth.reauthToken });
    expect(done.status).toBe("executed");
    expect(expectApiError(() => world.approvals.approve(payment.id, { reauthToken: reauth.reauthToken })).code).toBe("CONFLICT");
  });

  it("request-context keeps the approval pending and records the answer", () => {
    const world = createWorld();
    const pending = world.approvals.list({ status: ["pending"] as never }).items[0];
    const answered = world.approvals.requestContext(pending?.id as string, { question: "Warum ist das nötig?" });
    expect(answered.status).toBe("pending");
    expect(answered.rationale).toContain("Rückfrage: Warum ist das nötig?");
  });

  it("calendar proposals go through approvals and are applied only after approval", () => {
    const world = createWorld();
    const event = world.state.calendarEvents.find((candidate) => candidate.title.startsWith("Zahnarzt")) as NonNullable<MockWorld["state"]["calendarEvents"][number]>;
    const proposal = world.calendar.createProposal({ type: "reschedule", eventId: event.id, start: "2026-10-20T08:00:00.000Z", end: "2026-10-20T08:45:00.000Z", reason: "Passt besser" });
    expect(proposal.status).toBe("pending_approval");
    expect(world.calendar.getEvent(event.id).start).toBe(event.start);
    world.approvals.approve(proposal.approvalId as string);
    expect(world.calendar.getEvent(event.id).start).toBe("2026-10-20T08:00:00.000Z");
    expect(world.state.calendarProposals.find((candidate) => candidate.id === proposal.id)?.status).toBe("applied");
  });

  it("deleting a non-temporary file requires approval, temporary files go directly", () => {
    const world = createWorld();
    const report = world.state.files.find((file) => file.category === "reports") as NonNullable<MockWorld["state"]["files"][number]>;
    const outcome = world.files.delete(report.id);
    expect(outcome.kind).toBe("approval");
    expect(world.files.get(report.id).id).toBe(report.id);
    const temp = world.state.files.find((file) => file.category === "temporary" && file.sizeBytes < 10_000) as NonNullable<MockWorld["state"]["files"][number]>;
    expect(world.files.delete(temp.id).kind).toBe("deleted");
  });
});

describe("automations, notifications, voice, system, audit, settings, commands", () => {
  it("dry run explains the decision and executes nothing", () => {
    const world = createWorld();
    const automation = world.state.automations.find((candidate) => candidate.name.startsWith("Wichtige Mail")) as NonNullable<MockWorld["state"]["automations"][number]>;
    const tasksBefore = world.state.tasks.length;
    const run = world.automations.test(automation.id, { dryRun: true, sampleData: { thread: { priority: "P1", channelKind: "email" } } });
    expect(run.status).toBe("dry_run");
    expect(run.conditionsEvaluated.every((entry) => entry.met)).toBe(true);
    expect(run.actionsExecuted.every((entry) => entry.status === "simulated")).toBe(true);
    expect(run.result).toContain("nichts ausgeführt");
    const skipped = world.automations.test(automation.id, { sampleData: { thread: { priority: "P3", channelKind: "email" } } });
    expect(skipped.conditionsEvaluated.some((entry) => !entry.met)).toBe(true);
    expect(skipped.actionsExecuted.every((entry) => entry.status === "skipped")).toBe(true);
    expect(world.state.tasks).toHaveLength(tasksBefore);
    expect(world.automations.listRuns(automation.id).items[0]?.id).toBe(skipped.id);
  });

  it("enable/disable/update bump the version and honour If-Match", () => {
    const world = createWorld();
    const automation = world.state.automations[0] as NonNullable<MockWorld["state"]["automations"][number]>;
    const version = automation.version;
    const disabled = world.automations.disable(automation.id, { ifMatch: version });
    expect(disabled.enabled).toBe(false);
    expect(disabled.nextRunAt).toBeNull();
    expect(expectApiError(() => world.automations.enable(automation.id, { ifMatch: version })).code).toBe("CONFLICT");
    expect(expectApiError(() => world.automations.create({ name: "x", trigger: { type: "schedule", schedule: "kaputt", description: "x" }, conditions: [], actions: [{ id: "a", type: "notify", requiresApproval: false, description: "x" }] })).code).toBe("VALIDATION_FAILED");
  });

  it("notifications: acknowledge stops escalation, snooze reopens on the clock, resolve", () => {
    const world = createWorld();
    const alert = world.notifications.raise({ priority: "P1", category: "system", title: "Test", body: "b", chain: ["dashboard", "telegram", "phone"], stepSeconds: [0, 30, 60] });
    world.clock.advance(31_000);
    expect(world.notifications.list({ status: ["open"] as never }).items.find((n) => n.id === alert.id)?.escalation.map((s) => s.state)).toEqual(["sent", "sent", "pending"]);
    const acknowledged = world.notifications.acknowledge(alert.id);
    expect(acknowledged.escalation.map((s) => s.state)).toEqual(["sent", "acknowledged", "skipped"]);
    const second = world.notifications.raise({ priority: "P3", category: "task", title: "Später", body: "b" });
    const snoozed = world.notifications.snooze(second.id, { durationMinutes: 10 });
    expect(snoozed.status).toBe("snoozed");
    world.clock.advance(11 * 60_000);
    expect(world.state.notifications.find((n) => n.id === second.id)?.status).toBe("open");
    expect(world.notifications.resolve(second.id).status).toBe("resolved");
    expect(expectApiError(() => world.notifications.resolve(second.id)).code).toBe("CONFLICT");
  });

  it("voice: tests, stop and conflict while idle", () => {
    const world = createWorld();
    const full = world.voice.test({ kind: "full_pipeline" });
    expect(full.success).toBe(true);
    expect(full.stages.length).toBe(6);
    expect(expectApiError(() => world.voice.stop()).code).toBe("CONFLICT");
    world.voice.setMode("speaking", { text: "Hallo" });
    expect(world.voice.stop().accepted).toBe(true);
    expect(world.state.voice.status.mode).toBe("idle");
  });

  it("system healthcheck reports the service state", () => {
    const world = createWorld();
    const worker = world.state.system.services.find((service) => service.name === "Windows Worker") as NonNullable<MockWorld["state"]["system"]["services"][number]>;
    const result = world.system.healthcheck(worker.id);
    expect(result.status).toBe("degraded");
    expect(world.state.system.services.map((service) => service.name)).toEqual(
      expect.arrayContaining(["Hermes", "Kimi API", "Local Qwen", "Voice STT", "Voice TTS", "WSL", "Control API", "Event Stream", "Windows Worker"]),
    );
    expect(world.system.getMetrics().storage.some((volume) => volume.mount === "D:\\")).toBe(true);
  });

  it("audit: filters, export formats and chain verification after mutations", () => {
    const world = createWorld();
    world.tasks.create({ title: "Auditprobe" });
    expect(world.audit.list({ action: "task.created", limit: 5 }).items.every((event) => event.action === "task.created")).toBe(true);
    expect(world.audit.list({ category: ["approval"] as never }).items.every((event) => event.category === "approval")).toBe(true);
    const ndjson = world.audit.export({ format: "ndjson" });
    expect(ndjson.text?.trim().split("\n").length).toBeGreaterThan(10);
    expect(JSON.parse(ndjson.text?.split("\n")[0] as string).hash).toMatch(/^[0-9a-f]{64}$/);
    expect(world.audit.export({ format: "csv" }).text?.startsWith("id,sequence")).toBe(true);
    expect(world.audit.verifyChain().valid).toBe(true);
    const tampered = structuredClone(world.state.audit);
    (tampered[3] as { action: string }).action = "manipuliert";
    expect(verifyAuditChain(tampered)).toMatchObject({ valid: false, brokenAt: 3 });
  });

  it("settings: patch with If-Match, export never contains secrets", () => {
    const world = createWorld();
    const settings = world.settings.get();
    const updated = world.settings.patch({ dashboard: { ...settings.dashboard, compact: true } }, { ifMatch: settings.version });
    expect(updated.version).toBe(settings.version + 1);
    expect(expectApiError(() => world.settings.patch({ dashboard: settings.dashboard }, { ifMatch: settings.version })).code).toBe("CONFLICT");
    world.settings.updateAdapter("mock-communication", { secrets: { imapPassword: "geheim-klartext-123" } });
    const exported = JSON.stringify(world.settings.export());
    expect(exported).not.toContain("geheim-klartext-123");
    expect(JSON.stringify(world.state)).not.toContain("geheim-klartext-123");
    expect(JSON.stringify(world.settings.get())).not.toContain("geheim-klartext-123");
    expect(world.settings.get().adapters.find((adapter) => adapter.adapterId === "mock-communication")?.secretFields.imapPassword?.configured).toBe(true);
    expect(validator.validate("SettingsExport", world.settings.export()).errors).toEqual([]);
  });

  it("commands: preview first, confirmed repeat executes; risky actions create approvals; history redacts", () => {
    const world = createWorld();
    const preview = world.commands.execute({ text: "Sende eine E-Mail an Frau Becker wegen der Unterlagen", source: "text" });
    expect(preview.status).toBe("requires_confirmation");
    expect(preview.previewText).toContain("E-Mail an");
    const sentBefore = world.state.drafts.filter((draft) => draft.status === "sent").length;
    const confirmed = world.commands.execute({ text: "Sende eine E-Mail an Frau Becker wegen der Unterlagen", source: "text", confirm: true, previewId: preview.previewId as string });
    expect(confirmed.status).toBe("requires_approval");
    expect(confirmed.approvalId).toBeTruthy();
    expect(world.state.drafts.filter((draft) => draft.status === "sent")).toHaveLength(sentBefore);
    expect(world.approvals.get(confirmed.approvalId as string).status).toBe("pending");

    expect(expectApiError(() => world.commands.execute({ text: "Sende eine E-Mail an Frau Becker wegen der Unterlagen", source: "text", confirm: true, previewId: "prev_gibtsnicht" })).code).toBe("VALIDATION_FAILED");

    const nav = world.commands.execute({ text: "Öffne die Aufgaben", source: "palette" });
    expect(nav).toMatchObject({ status: "executed", result: { targetRoute: "/tasks" } });

    const pay = world.commands.execute({ text: "Überweise 500 Euro an Nordlicht", source: "text" });
    expect(pay.riskTier).toBe(3);
    const payConfirmed = world.commands.execute({ text: "Überweise 500 Euro an Nordlicht", source: "text", confirm: true, previewId: pay.previewId as string });
    expect(world.approvals.get(payConfirmed.approvalId as string).requiredAuth).toBe("reauth");

    const ask = world.commands.execute({ text: "Wie viele Termine habe ich morgen?", source: "voice" });
    expect(ask.status).toBe("accepted");
    expect(world.orbSnapshot().status.mode).toBe("waiting_approval");

    world.commands.execute({ text: "Mein Passwort lautet geheim", source: "text" });
    const history = world.commands.history({ limit: 5 }).items;
    expect(history[0]?.redacted).toBe(true);
    expect(history[0]?.text).not.toContain("geheim");
    expect(world.commands.execute({ text: "lösche alles", source: "text" }).status).toBe("rejected");
  });

  it("commands: stop/pause/resume for all and per scope", () => {
    const world = createWorld();
    const paused = world.commands.pause({ scope: "all" });
    expect(paused.message).toContain("pausiert");
    expect(world.state.agents.every((agent) => agent.status !== "working")).toBe(true);
    world.commands.resume({ scope: "all" });
    expect(world.state.agents.some((agent) => agent.status === "working")).toBe(true);
    expect(expectApiError(() => world.commands.stop({ scope: "task" })).code).toBe("VALIDATION_FAILED");
    const stopped = world.commands.stop({ scope: "all" });
    expect(stopped.message).toContain("gestoppt");
    expect(world.state.tasks.some((task) => task.status === "running")).toBe(false);
  });
});

describe("availability, latency, errors and capabilities", () => {
  it("offline adapters throw typed MockAdapterError with canonical codes; others keep working", () => {
    const world = createWorld();
    world.setAdapterState("mail" in {} ? "communication" : "communication", "offline");
    let caught: unknown;
    try {
      world.communication.listThreads();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MockAdapterError);
    expect(caught).toMatchObject({ code: "ADAPTER_UNAVAILABLE", status: 503, retryable: true, adapterId: "mock-communication" });
    world.setAdapterState("calendar", "timeout");
    expect(expectApiError(() => world.calendar.listEvents()).code).toBe("ADAPTER_TIMEOUT");
    world.setAdapterState("memory", "degraded");
    expect(world.memory.list().items.length).toBeGreaterThan(0);
    expect(world.freshness("memory").state).toBe("stale");
    expect(world.adapterHealth("memory").status).toBe("degraded");
    expect(world.adapterHealth("communication").status).toBe("offline");
    expect(world.tasks.list().items.length).toBeGreaterThan(0);
    world.setAdapterState("communication", "online");
    expect(world.communication.listThreads().items.length).toBeGreaterThan(0);
  });

  it("capability toggles are reflected in the capabilities document and enforced", () => {
    const world = createWorld();
    const recorder = record(world);
    world.setCapability("tasks", "create", false);
    expect(world.meta.getCapabilities().modules.tasks.create).toBe(false);
    const error = expectApiError(() => world.tasks.create({ title: "Verboten" }));
    expect(error).toEqual({ code: "CAPABILITY_MISSING", status: 403 });
    expect(recorder.events.some((event) => event.type === "friday.adapter.capabilities_changed")).toBe(true);
    world.setCapability("mail", "send", false);
    expect(world.meta.getCapabilities().modules.communication.send).toBe(false);
    const draft = world.state.drafts.find((candidate) => candidate.status === "draft") as NonNullable<MockWorld["state"]["drafts"][number]>;
    expect(expectApiError(() => world.communication.requestSend(draft.id)).code).toBe("CAPABILITY_MISSING");
    expect(world.meta.getOverview().quickCommands.find((command) => command.id === "new-task")).toMatchObject({ enabled: false });
    expect(validator.validate("Capabilities", world.meta.getCapabilities()).errors).toEqual([]);
  });

  it("read-only channels cannot send", () => {
    const world = createWorld();
    const whatsapp = world.state.channels.find((channel) => channel.kind === "whatsapp") as NonNullable<MockWorld["state"]["channels"][number]>;
    expect(whatsapp.status).toBe("read_only");
    expect(expectApiError(() => world.communication.createDraft({ channelId: whatsapp.id, to: [{ name: "A", address: "a" }], subject: "s", body: "b" })).code).toBe("CAPABILITY_MISSING");
  });

  it("latency and error injection are reproducible", () => {
    const run = (): { latencies: number[]; failures: boolean[] } => {
      const world = createWorld({ seed: 5 });
      world.setLatency(100);
      world.setErrorRate(0.4, "tasks");
      const latencies = Array.from({ length: 6 }, () => world.latencyFor("memory"));
      const failures = Array.from({ length: 20 }, () => {
        try {
          world.tasks.list();
          return false;
        } catch (error) {
          return (error as { code?: string }).code === "ADAPTER_TIMEOUT" || (error as { code?: string }).code === "ADAPTER_UNAVAILABLE";
        }
      });
      return { latencies, failures };
    };
    const first = run();
    expect(first).toEqual(run());
    expect(first.latencies.every((ms) => ms >= 80 && ms <= 120)).toBe(true);
    expect(first.failures.some(Boolean)).toBe(true);
    expect(first.failures.some((failed) => !failed)).toBe(true);
  });

  it("restore() resets state, clock and announces a resync; sequences stay monotonic", () => {
    const world = createWorld();
    const baselineTasks = world.state.tasks.length;
    world.tasks.create({ title: "Wird verworfen" });
    const seq = world.events.lastId;
    expect(seq).toBeTruthy();
    const recorder = record(world);
    world.clock.advance(60_000);
    world.reset();
    expect(world.state.tasks).toHaveLength(baselineTasks);
    expect(world.nowIso()).toBe("2026-10-14T08:15:00.000Z");
    expect(recorder.events.at(-1)?.type).toBe("friday.status.resync_required");
    world.tasks.create({ title: "Danach" });
    const sequences = recorder.events.map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });
});

describe("orb derivation", () => {
  it("follows the priority order and emits status changes", () => {
    const world = createWorld();
    world.quiesce();
    const recorder = record(world);
    expect(world.orbSnapshot().status).toMatchObject({ mode: "idle", activityText: "BEREIT", progressMode: "none" });
    world.voice.setMode("listening");
    expect(world.orbSnapshot().status.mode).toBe("listening");
    world.approvals.raise({ type: "send_email", action: "Test", riskTier: 2, rationale: "r", preview: { kind: "text", title: "t", body: "b" } });
    expect(world.orbSnapshot().status.mode).toBe("waiting_approval");
    world.notifications.raise({ priority: "P0", category: "system", title: "Kritisch", body: "b" });
    expect(world.orbSnapshot().status.mode).toBe("error");
    expect(world.orbSnapshot().status.detailText).toContain("Kritisch");
    expect(world.orbSnapshot().layers).toMatchObject({ voice: "listening", attention: "error" });
    const modes = recorder.events.filter((event) => event.type === "friday.orb.status_changed").map((event) => (event.data as { status: { mode: string } }).status.mode);
    expect(modes).toEqual(["listening", "waiting_approval", "error"]);
    expect(eventProblems(recorder.events)).toEqual([]);
  });

  it("reports real progress only: determinate with a value, indeterminate otherwise", () => {
    const world = createWorld();
    world.quiesce();
    const determinate = world.tasks.spawn({ title: "Mit Fortschritt", status: "running", agentId: world.state.agents[0]?.id as string, progress: { mode: "determinate", value: 0.4 } });
    expect(world.orbSnapshot().status).toMatchObject({ mode: "working", progressMode: "determinate", progress: 0.4 });
    world.tasks.setProgress(determinate.id, null);
    expect(world.orbSnapshot().status).toMatchObject({ mode: "working", progressMode: "indeterminate", progress: null });
  });

  it("forceOrbState overrides and releases", () => {
    const world = createWorld();
    world.forceOrbState("paused");
    expect(world.orbSnapshot().status.mode).toBe("paused");
    world.forceOrbState(null);
    expect(world.orbSnapshot().status.mode).toBe("waiting_approval");
  });

  it("raw dev events are validated against the event schemas", () => {
    const world = createWorld();
    expect(expectApiError(() => world.emitRaw({ type: "friday.nope.nope", data: {} })).code).toBe("VALIDATION_FAILED");
    expect(expectApiError(() => world.emitRaw({ type: "friday.voice.audio_level", data: { level: 5 } })).code).toBe("VALIDATION_FAILED");
    const event = world.emitRaw({ type: "friday.voice.audio_level", data: { direction: "input", level: 0.4, at: world.nowIso() } });
    expect(event.type).toBe("friday.voice.audio_level");
  });
});
