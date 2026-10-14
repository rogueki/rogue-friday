/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies and frames that the contract validators check */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GENESIS_HASH } from "@jarvis/observability";
import { createSchemaValidator, type AuditEvent, type JarvisEvent } from "@jarvis/sdk";
import { ApiClient, startTestApi, type TestApi } from "./helpers";

const validator = createSchemaValidator();

describe("control-plane audit trail", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
    for (let index = 0; index < 6; index += 1) expect((await owner.post("/api/v1/tasks", { title: `Audit ${index}` })).statusCode).toBe(201);
  });
  afterEach(async () => {
    await api.close();
  });

  const rows = () => api.runtime.db.prepare("SELECT seq, json, prev_hash, hash FROM audit_log ORDER BY seq").all() as unknown as Array<{ seq: number; json: string; prev_hash: string; hash: string }>;

  describe("chain", () => {
    it("is gapless, starts at the genesis hash and links every event to its predecessor", () => {
      const stored = rows();
      expect(stored.length).toBeGreaterThanOrEqual(7); // login + 6 task creations
      expect(stored[0]?.prev_hash).toBe(GENESIS_HASH);
      stored.forEach((row, index) => {
        expect(row.seq).toBe(index + 1);
        if (index > 0) expect(row.prev_hash).toBe(stored[index - 1]?.hash);
      });
      const verification = api.runtime.stores.audit.verify();
      expect(verification).toMatchObject({ valid: true, length: stored.length, headHash: stored.at(-1)?.hash });
      expect(api.runtime.stores.audit.headHash()).toBe(stored.at(-1)?.hash);
    });

    it("stores contract-valid audit events with sequence, hash and prevHash", () => {
      const events = api.runtime.stores.audit.recent(50).reverse();
      for (const event of events) {
        const result = validator.validate("AuditEvent", event);
        expect(result.valid, `${event.action}: ${JSON.stringify(result.errors)}`).toBe(true);
      }
      expect(events[0]?.prevHash).toBeNull();
      events.forEach((event, index) => {
        expect(event.sequence).toBe(index + 1);
        if (index > 0) expect(event.prevHash).toBe(events[index - 1]?.hash);
      });
    });

    it("records who did what: actor, action, result and correlation id of the request", async () => {
      const correlationId = "corr_01ARZ3NDEKTSV4RRFFQ69G5FAW";
      await owner.post("/api/v1/tasks", { title: "Mit Korrelation" }, { headers: { "x-correlation-id": correlationId } });
      const event = api.runtime.stores.audit.recent(5).find((candidate) => candidate.correlationId === correlationId) as AuditEvent;
      expect(event).toBeDefined();
      expect(event.actor).toMatchObject({ type: "user" });
      expect(event.actor.id).toMatch(/^usr_[0-9A-Za-z]{26}$/);
      expect(event.result).toBe("success");
      expect(event.action).toBe("tasks.createTask");
      expect(event.context).toMatchObject({ operationId: "createTask", method: "POST", status: 201 });
    });

    it("records denied attempts (403) and failed requests, but no read traffic", async () => {
      const viewer = api.client();
      await viewer.loginDev("viewer");
      const before = api.runtime.stores.audit.count();
      await viewer.get("/api/v1/tasks");
      await viewer.get("/api/v1/overview");
      expect(api.runtime.stores.audit.count(), "reads are not audited").toBe(before);
      const denied = await viewer.post("/api/v1/tasks", { title: "Verboten" });
      expect(denied.statusCode).toBe(403);
      const latest = api.runtime.stores.audit.recent(1)[0] as AuditEvent;
      expect(latest.result).toBe("denied");
      expect(latest.errorCode).toBe("FORBIDDEN");
      expect(latest.severity).toBe("warning");
      expect(api.runtime.stores.audit.count()).toBe(before + 1);
    });

    it("records failed logins with a sanitized username and never the password", async () => {
      const attacker = api.client();
      const response = await attacker.post("/api/v1/auth/login", { username: "dev-root<script>", password: "hunter2-geheim" }, { csrf: false });
      expect(response.statusCode).toBe(401);
      const latest = api.runtime.stores.audit.recent(1)[0] as AuditEvent;
      expect(latest.category).toBe("security");
      expect(latest.result).not.toBe("success");
      expect(latest.actor.id).toBe("dev-rootscript");
      expect(JSON.stringify(rows())).not.toContain("hunter2-geheim");
    });

    it("publishes each audit event on the stream as jarvis.audit.appended with the stored hash", async () => {
      const seen: JarvisEvent[] = [];
      const off = api.runtime.hub.subscribe((event) => event.type === "jarvis.audit.appended" && event.source === "control-api://core" && seen.push(event));
      await owner.post("/api/v1/tasks", { title: "Stream" });
      off();
      expect(seen).toHaveLength(1);
      const event = seen[0]?.data as unknown as AuditEvent;
      expect(event.hash).toBe(api.runtime.stores.audit.headHash());
    });

    it("exposes the chain state in /health", async () => {
      const health = (await owner.get("/api/v1/health")).json();
      expect(health.components.find((component: any) => component.id === "audit-chain")).toMatchObject({ status: "online" });
    });
  });

  describe("tamper detection", () => {
    const tamper = (sql: string, ...values: Array<string | number>) => {
      api.runtime.db.prepare(sql).run(...values);
    };

    it("detects a modified event and names the first broken sequence", () => {
      const target = rows()[3] as { seq: number; json: string };
      const edited = (JSON.parse(target.json) as AuditEvent & { result: string }).result === "success" ? target.json.replace('"result":"success"', '"result":"failure"') : target.json;
      expect(edited).not.toBe(target.json);
      tamper("UPDATE audit_log SET json = ? WHERE seq = ?", edited, target.seq);
      const verification = api.runtime.stores.audit.verify();
      expect(verification.valid).toBe(false);
      expect(verification.brokenAtSequence).toBe(target.seq);
      expect(verification.reason).toBe("hash_mismatch");
      // restoring the original text heals the chain: the detection reacted to exactly this edit
      tamper("UPDATE audit_log SET json = ? WHERE seq = ?", target.json, target.seq);
      expect(api.runtime.stores.audit.verify().valid).toBe(true);
    });

    it("detects a deleted event", () => {
      const target = rows()[2] as { seq: number };
      tamper("DELETE FROM audit_log WHERE seq = ?", target.seq);
      const verification = api.runtime.stores.audit.verify();
      expect(verification.valid).toBe(false);
      expect(verification.brokenAtSequence).toBe(target.seq + 1);
      expect(verification.reason).toBe("prev_hash_mismatch");
    });

    it("detects an edited hash, reordered events and a forged rewrite of one event", () => {
      const all = rows();
      const first = all[1] as { seq: number; hash: string };
      tamper("UPDATE audit_log SET hash = ? WHERE seq = ?", "0".repeat(64), first.seq);
      expect(api.runtime.stores.audit.verify()).toMatchObject({ valid: false, brokenAtSequence: first.seq });
      tamper("UPDATE audit_log SET hash = ? WHERE seq = ?", first.hash, first.seq);
      expect(api.runtime.stores.audit.verify().valid).toBe(true);

      // swapping two events' payloads (hashes stay): the chain notices
      const a = all[2] as { seq: number; json: string };
      const b = all[3] as { seq: number; json: string };
      tamper("UPDATE audit_log SET json = ? WHERE seq = ?", b.json, a.seq);
      tamper("UPDATE audit_log SET json = ? WHERE seq = ?", a.json, b.seq);
      expect(api.runtime.stores.audit.verify()).toMatchObject({ valid: false, brokenAtSequence: a.seq });
    });

    it("reports a tampered trail in /health after a restart and keeps serving", async () => {
      const dir = mkdtempSync(join(tmpdir(), "jarvis-audit-"));
      try {
        const first = await startTestApi({ dir });
        const client = first.client();
        await client.loginDev("owner");
        await client.post("/api/v1/tasks", { title: "Vor der Manipulation" });
        await client.post("/api/v1/tasks", { title: "Noch eine Aufgabe" });
        const victim = (first.runtime.db.prepare("SELECT seq, json FROM audit_log WHERE seq = 2").get() as { seq: number; json: string });
        first.runtime.db.prepare("UPDATE audit_log SET json = ? WHERE seq = ?").run(victim.json.replace('"info"', '"critical"'), victim.seq);
        await first.app.close();

        const second = await startTestApi({ dir });
        try {
          const again = second.client();
          await again.loginDev("owner");
          const health = (await again.get("/api/v1/health")).json();
          expect(health.status).toBe("degraded");
          expect(health.components.find((component: any) => component.id === "audit-chain")).toMatchObject({ status: "offline" });
          expect(second.runtime.audit.verification()).toMatchObject({ valid: false, brokenAtSequence: 2 });
          expect((await again.get("/api/v1/tasks")).statusCode, "the API stays usable").toBe(200);
          expect(second.runtime.audit.verifyNow().valid).toBe(false);
        } finally {
          await second.app.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("keeps the chain valid across restarts (head hash is re-read from the database)", async () => {
      const dir = mkdtempSync(join(tmpdir(), "jarvis-audit-"));
      try {
        const first = await startTestApi({ dir });
        const client = first.client();
        await client.loginDev("owner");
        await client.post("/api/v1/tasks", { title: "Vorher" });
        await first.app.close();
        const second = await startTestApi({ dir });
        try {
          const again = second.client();
          await again.loginDev("owner");
          await again.post("/api/v1/tasks", { title: "Nachher" });
          expect(second.runtime.stores.audit.verify()).toMatchObject({ valid: true });
          expect(second.runtime.stores.audit.count()).toBeGreaterThanOrEqual(4);
        } finally {
          await second.app.close();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
