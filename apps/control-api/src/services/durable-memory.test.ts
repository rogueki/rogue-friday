import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { DurableMemoryService, type IntegrationEvent } from "./durable-memory";

const paths: string[] = [];
function fixture(): { data: string; vault: string } {
  const root = mkdtempSync(join(tmpdir(), "friday-memory-"));
  paths.push(root);
  return { data: join(root, "data"), vault: join(root, "vault") };
}
function event(id: string, text = "Projekt Delta beschlossen"): IntegrationEvent {
  return { eventId: id, contractVersion: "1.0.0", eventType: "user_utterance", actor: { type: "user", id: "owner", role: null },
    identityId: "owner", channel: "dashboard", sessionId: "s1", dialogId: "d1", correlationId: null, source: "dashboard/chat",
    occurredAt: "2026-10-19T10:00:00Z", outcome: "completed", captureEligibility: "eligible", redaction: "required",
    payload: { kind: "text", text } };
}
afterEach(() => { for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("DurableMemoryService", () => {
  it("keeps a sanitized event through vault failure and service restart, then writes once", () => {
    const { data, vault } = fixture();
    const first = new DurableMemoryService(data, vault);
    expect(first.capture(event("e1", "Mein Passwort ist hunter2"))).toEqual({ eventId: "e1", accepted: true, pending: true });
    expect(first.status()).toMatchObject({ ready: false, pending: 1, lastError: "Vault is unavailable" });
    first.close();
    const outbox = readFileSync(join(data, "memory", "outbox.sqlite"));
    expect(outbox.includes(Buffer.from("hunter2"))).toBe(false);
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const second = new DurableMemoryService(data, vault);
    second.flush();
    expect(second.capture(event("e1", "Mein Passwort ist hunter2"))).toEqual({ eventId: "e1", accepted: true, pending: false });
    const note = readFileSync(join(vault, "Conversations", "2026", "10", "e1.md"), "utf8");
    expect(note).toContain("[Zugangsdaten entfernt]");
    expect(note).not.toContain("hunter2");
    expect(second.search("Zugangsdaten", "owner")).toHaveLength(1);
    expect(second.backup().eventCount).toBe(1);
    expect(second.search("Zugangsdaten", "someone-else")).toHaveLength(0);
    second.close();
  });

  it("excludes private input and rejects mismatched event type", () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = new DurableMemoryService(data, vault);
    expect(service.capture({ ...event("e2"), captureEligibility: "private" }).accepted).toBe(false);
    expect(() => service.capture({ ...event("e3"), eventType: "action_result" })).toThrow(/mismatch/);
    expect(service.search("Projekt", "owner")).toHaveLength(0);
    service.close();
  });

  it("enforces persistent private mode and per-channel capture settings", () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const first = new DurableMemoryService(data, vault);
    first.setSettings({ enabled: true, privateMode: true,
      channels: { dashboard: true, voice: true, hermes: true } });
    expect(first.capture(event("private-mode")).accepted).toBe(false);
    first.setSettings({ enabled: true, privateMode: false,
      channels: { dashboard: false, voice: true, hermes: true } });
    first.close();
    const restarted = new DurableMemoryService(data, vault);
    expect(restarted.capture(event("channel-off")).accepted).toBe(false);
    expect(restarted.status().settings).toMatchObject({ privateMode: false, retention: "unlimited",
      channels: { dashboard: false } });
    expect(restarted.search("Projekt", "owner")).toHaveLength(0);
    restarted.close();
  });

  it("purges pending capture on private switch and rejects direct API capture", () => {
    const { data, vault } = fixture();
    const service = new DurableMemoryService(data, vault);
    expect(service.capture(event("queued-before-private")).pending).toBe(true);
    service.setSettings({ enabled: true, privateMode: true,
      channels: { dashboard: true, voice: true, hermes: true } });
    expect(service.status().pending).toBe(0);
    expect(service.capture(event("direct-private")).accepted).toBe(false);
    service.setSettings({ enabled: true, privateMode: false,
      channels: { dashboard: true, voice: true, hermes: true } });
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    expect(service.capture(event("queued-before-private")).accepted).toBe(false);
    expect(service.search("Projekt", "owner")).toHaveLength(0);
    service.close();
  });

  it("preserves edited notes, tombstones deletion and restores an isolated indexed vault", () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = new DurableMemoryService(data, vault);
    service.capture(event("e4"));
    const original = join(vault, "Conversations", "2026", "10", "e4.md");
    writeFileSync(original, readFileSync(original, "utf8").replace("Projekt Delta", "Projekt Gamma"));
    expect(service.search("Gamma", "owner")).toHaveLength(1);
    const backup = service.backup();
    const restored = service.restore(backup.path, join(data, "memory", "restores", "recovered"));
    expect(restored.eventCount).toBe(1);
    expect(readFileSync(join(restored.targetVaultPath, "Conversations", "2026", "10", "e4.md"), "utf8")).toContain("Gamma");
    const restoredIndex = new DatabaseSync(join(data, "memory", "restores", "recovered-memory-index.sqlite"));
    expect(restoredIndex.prepare("SELECT text FROM entries WHERE event_id='e4'").get()).toEqual({ text: "Projekt Gamma beschlossen" });
    restoredIndex.close();
    expect(service.forget("e4").deleted).toBe(true);
    expect(service.search("Projekt", "owner")).toHaveLength(0);
    expect(service.capture(event("e4")).accepted).toBe(false);
    service.close();
  });

  it("atomically queues a correction and removes the old fact from retrieval", () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = new DurableMemoryService(data, vault);
    service.capture(event("old", "Treffen am Montag"));
    const result = service.correct("old", "Treffen am Dienstag", "owner");
    expect(result.corrected).toBe(true);
    expect(service.search("Montag", "owner")).toHaveLength(0);
    expect(service.search("Dienstag", "owner")).toHaveLength(1);
    expect(service.capture(event("old")).accepted).toBe(false);
    service.close();
  });

  it("deduplicates a crash after vault write but before outbox acknowledgement", () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = new DurableMemoryService(data, vault);
    service.capture(event("crash"));
    const note = join(vault, "Conversations", "2026", "10", "crash.md");
    const original = readFileSync(note, "utf8");
    service.close();
    const db = new DatabaseSync(join(data, "memory", "outbox.sqlite"));
    db.prepare("UPDATE events SET state='pending' WHERE id='crash'").run();
    db.close();
    const restarted = new DurableMemoryService(data, vault);
    restarted.flush();
    expect(restarted.status().pending).toBe(0);
    expect(readFileSync(note, "utf8")).toBe(original);
    restarted.close();
  });

  it("honors a note deleted in Obsidian while the API was stopped", () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const first = new DurableMemoryService(data, vault);
    first.capture(event("offline-delete"));
    const note = join(vault, "Conversations", "2026", "10", "offline-delete.md");
    first.close();
    unlinkSync(note);
    const restarted = new DurableMemoryService(data, vault);
    restarted.flush();
    expect(existsSync(note)).toBe(false);
    expect(restarted.search("Projekt", "owner")).toHaveLength(0);
    expect(restarted.capture(event("offline-delete")).accepted).toBe(false);
    expect(existsSync(note)).toBe(false);
    restarted.close();
  });

  it("never treats a partial or secret-bearing Vault edit as deletion", () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = new DurableMemoryService(data, vault);
    service.capture(event("keep"));
    service.capture(event("other", "Weitere Entscheidung"));
    const note = join(vault, "Conversations", "2026", "10", "keep.md");
    const original = readFileSync(note, "utf8");
    writeFileSync(note, "---\nfriday_memory: 1\nmetadata: broken\n");
    expect(() => service.search("Entscheidung", "owner")).toThrow();
    expect(service.status()).toMatchObject({ indexState: "error" });
    writeFileSync(note, original.replace("Projekt Delta", "Mein Passwort ist geheim"));
    expect(() => service.search("Projekt", "owner")).toThrow();
    expect(() => service.backup()).toThrow();
    writeFileSync(note, original);
    expect(service.search("Projekt", "owner")).toHaveLength(1);
    service.close();
  });

  it("keeps ordinary words and marks aborted actions honestly", () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = new DurableMemoryService(data, vault);
    service.capture(event("shopping", "Shopping am Montag"));
    expect(service.search("Shopping", "owner")[0]?.text).toBe("Shopping am Montag");
    const action: IntegrationEvent = { ...event("aborted"), eventType: "action_result", actor: { type: "assistant", id: "friday", role: null },
      outcome: "aborted", payload: { kind: "action", actionId: "calendar.create", targetId: null, externalId: null } };
    service.capture(action);
    expect(readFileSync(join(vault, "Conversations", "2026", "10", "aborted.md"), "utf8")).toContain("Outcome: aborted");
    service.close();
  });

  it("refuses an incomplete or modified backup during isolated restore", () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = new DurableMemoryService(data, vault);
    service.capture(event("backup-test"));
    const snapshot = service.backup();
    const note = join(snapshot.path, "Conversations", "2026", "10", "backup-test.md");
    writeFileSync(note, readFileSync(note, "utf8") + "tampered");
    expect(() => service.restore(snapshot.path, join(data, "memory", "restores", "bad"))).toThrow(/checksum/);
    service.close();
  });

  it("never opens or deletes a pre-existing neighboring restore index", () => {
    const { data, vault } = fixture();
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    const service = new DurableMemoryService(data, vault);
    service.capture(event("canary"));
    const snapshot = service.backup();
    const parent = join(data, "memory", "restores");
    mkdirSync(parent, { recursive: true });
    const index = join(parent, "recovered-memory-index.sqlite");
    const canary = Buffer.from("pre-existing index must remain byte-for-byte unchanged");
    writeFileSync(index, canary);
    expect(() => service.restore(snapshot.path, join(parent, "recovered"))).toThrow(/new isolated vault/);
    expect(readFileSync(index)).toEqual(canary);
    expect(existsSync(join(parent, "recovered"))).toBe(false);
    service.close();
  });

  it("switches to a selected Vault while preserving notes and rejecting conflicts", () => {
    const { data, vault } = fixture();
    const next = join(data, "new-vault");
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    mkdirSync(join(next, ".obsidian"), { recursive: true });
    const service = new DurableMemoryService(data, vault);
    service.capture(event("switch"));
    service.switchVault(next);
    expect(service.vaultPath).toBe(next);
    expect(service.search("Projekt", "owner")).toHaveLength(1);
    const conflictVault = join(data, "conflict-vault");
    mkdirSync(join(conflictVault, ".obsidian"), { recursive: true });
    mkdirSync(join(conflictVault, "Conversations", "2026", "10"), { recursive: true });
    writeFileSync(join(conflictVault, "Conversations", "2026", "10", "switch.md"), "custom edit");
    expect(() => service.prepareVaultSwitch(conflictVault)).toThrow(/conflicting/);
    expect(service.vaultPath).toBe(next);
    service.close();
  });
});
