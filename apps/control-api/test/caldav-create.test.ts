import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AdapterRegistry } from "@friday/adapter-core";
import { openDatabase } from "../src/db/database";
import { CalDavCreateService } from "../src/services/caldav-create";
import { startTestApi } from "./helpers";

const event = { title: "Wartung", start: "2026-10-17T10:00:00.000Z", end: "2026-10-17T11:00:00.000Z" };

function fakeRegistry(write: (body: unknown) => Promise<void>) {
  return {
    aggregateCapabilities: () => ({ modules: { calendar: { create: true } } }),
    listAdapters: () => [{ manifest: { category: "calendar" }, provider: "caldav-calendar" }],
    getPort: () => ({ createCalendarEvent: async ({ body }: { body: unknown }) => { await write(body); return { data: {}, freshness: {} }; } }),
  } as unknown as AdapterRegistry;
}

describe("CalDAV owner-confirmed creation", () => {
  it("binds preview to owner, contents and key; reserves durably before one PUT", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "friday-caldav-create-")), "journal.sqlite");
    let db = openDatabase(path);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const write = vi.fn(async () => pending);
    const registry = fakeRegistry(write);
    const secret = Buffer.alloc(32, 7);
    const service = new CalDavCreateService(db, registry, secret, () => "target-a");
    const input = { ...event, start: new Date(Date.now() + 86_400_000).toISOString(), end: new Date(Date.now() + 90_000_000).toISOString() };
    const key = "caldav-key-123456";
    const preview = service.preview(input, "owner", key);
    await expect(service.create({ ...input, confirmationToken: preview.confirmationToken }, "other", key, { correlationId: "test" })).rejects.toThrow();
    await expect(service.create({ ...input, title: "Changed", confirmationToken: preview.confirmationToken }, "owner", key, { correlationId: "test" })).rejects.toThrow();
    const first = service.create({ ...input, confirmationToken: preview.confirmationToken }, "owner", key, { correlationId: "test" });
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(await service.create({ ...input, confirmationToken: preview.confirmationToken }, "owner", key, { correlationId: "test" })).toEqual({ state: "unknown", replayed: true });
    release();
    expect(await first).toEqual({ state: "created", replayed: false });
    db.close();
    db = openDatabase(path);
    expect(await new CalDavCreateService(db, registry, secret, () => "target-a").create({ ...input, confirmationToken: preview.confirmationToken }, "owner", key, { correlationId: "test" }))
      .toEqual({ state: "created", replayed: true });
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(db.prepare("SELECT * FROM caldav_create_journal").get())).not.toContain(input.title);
    db.close();
  });

  it("keeps an ambiguous result unknown and never retries", async () => {
    const db = openDatabase(":memory:");
    const write = vi.fn(async () => { throw new Error("timeout after upstream accepted PUT"); });
    const service = new CalDavCreateService(db, fakeRegistry(write), Buffer.alloc(32, 8), () => "target-a");
    const input = { ...event, start: new Date(Date.now() + 86_400_000).toISOString(), end: new Date(Date.now() + 90_000_000).toISOString() };
    const preview = service.preview(input, "owner", "caldav-key-123456");
    const request = { ...input, confirmationToken: preview.confirmationToken };
    expect(await service.create(request, "owner", "caldav-key-123456", { correlationId: "test" })).toEqual({ state: "unknown", replayed: false });
    expect(await service.create(request, "owner", "caldav-key-123456", { correlationId: "test" })).toEqual({ state: "unknown", replayed: true });
    expect(write).toHaveBeenCalledTimes(1);
    db.close();
  });

  it("invalidates confirmation when the configured calendar or credentials change", async () => {
    const db = openDatabase(":memory:");
    const write = vi.fn(async () => {});
    let target = "collection-a|owner-a|password-a";
    const service = new CalDavCreateService(db, fakeRegistry(write), Buffer.alloc(32, 9), () => target);
    const input = { ...event, start: new Date(Date.now() + 86_400_000).toISOString(), end: new Date(Date.now() + 90_000_000).toISOString() };
    const key = "caldav-key-target-change";
    const preview = service.preview(input, "owner", key);
    target = "collection-b|owner-a|password-a";
    await expect(service.create({ ...input, confirmationToken: preview.confirmationToken }, "owner", key, { correlationId: "test" }))
      .rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(write).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS count FROM caldav_create_journal").get()).toMatchObject({ count: 0 });
    target = "collection-a|owner-a|password-b";
    await expect(service.create({ ...input, confirmationToken: preview.confirmationToken }, "owner", key, { correlationId: "test" }))
      .rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    db.close();
  });

  it("requires owner and CSRF before preview or creation", async () => {
    const api = await startTestApi({ authMode: "local", ownerPassword: "synthetic-test-password" });
    try {
      const guest = api.client();
      expect((await guest.post("/api/v1/calendar/caldav/preview", event, { headers: { "Idempotency-Key": "caldav-key-123456" } })).statusCode).toBe(401);
      const owner = api.client();
      await owner.loginOwner("synthetic-test-password");
      expect((await owner.post("/api/v1/calendar/caldav/preview", event, { csrf: false, headers: { "Idempotency-Key": "caldav-key-123456" } })).statusCode).toBe(403);
    } finally { await api.close(); }
  });

  it("routes only owner-confirmed requests through the API contract", async () => {
    const api = await startTestApi({ responseValidation: "throw" });
    try {
      const owner = api.client();
      const operator = api.client();
      await owner.loginDev("owner");
      await operator.loginDev("operator");
      const input = { ...event, start: new Date(Date.now() + 86_400_000).toISOString(), end: new Date(Date.now() + 90_000_000).toISOString() };
      const headers = { "Idempotency-Key": "caldav-key-123456" };
      expect((await operator.post("/api/v1/calendar/caldav/preview", input, { headers })).statusCode).toBe(403);
      expect((await operator.post("/api/v1/calendar/caldav/events", { ...input, confirmationToken: "0".repeat(78) }, { headers })).statusCode).toBe(403);
      const preview = { ...input, confirmationToken: `${Date.now() + 60_000}.` + "a".repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() };
      const previewCall = vi.spyOn(api.runtime.caldavCreate, "preview").mockReturnValue(preview);
      const createCall = vi.spyOn(api.runtime.caldavCreate, "create").mockResolvedValue({ state: "created", replayed: false });
      const first = await owner.post("/api/v1/calendar/caldav/preview", input, { headers });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().data).toMatchObject({ title: input.title, confirmationToken: preview.confirmationToken });
      const confirm = await owner.post("/api/v1/calendar/caldav/events", { ...input, confirmationToken: preview.confirmationToken }, { headers });
      expect(confirm.statusCode, confirm.body).toBe(200);
      expect(confirm.json().data).toEqual({ state: "created", replayed: false });
      expect(previewCall).toHaveBeenCalledOnce();
      expect(createCall).toHaveBeenCalledOnce();
    } finally { await api.close(); }
  });
});
