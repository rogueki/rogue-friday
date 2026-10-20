import { expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database";
import { ResearchService } from "../src/services/research";
import { createId } from "@friday/observability";

it("stops reading an oversized provider stream before buffering more than the cap", async () => {
  const db = openDatabase(":memory:");
  let cancelled = false;
  const fetcher = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(300_000));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 200 },
      ),
  );
  try {
    const service = new ResearchService(db, "http://127.0.0.1:8080/", fetcher as typeof fetch);
    const result = await service.create("owner", "Provider mit grosser Antwort", "large-response", 1);
    expect(result.status).toBe("failed");
    expect(result.sourceCount).toBe(0);
    expect(cancelled).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    db.close();
  }
});

it("marks a pre-crash running search as interrupted without submitting again", () => {
  const db = openDatabase(":memory:");
  try {
    const stamp = new Date().toISOString();
    const id = "rsp_01JAAAAAAAAAAAAAAAAAAAAAAA";
    db.prepare(
      "INSERT INTO research_projects (id, owner_id, request_key, topic, mission, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)",
    ).run(id, "owner", "earlier-request", "Thema", "Thema", stamp, stamp);
    const service = new ResearchService(db, "http://127.0.0.1:8080/", vi.fn() as typeof fetch);
    const project = service.get("owner", id);
    expect(project.status).toBe("failed");
    expect(project.resultSummary).toContain("unterbrochen");
  } finally {
    db.close();
  }
});

it("paginates persisted projects without hiding records beyond the first page", () => {
  const db = openDatabase(":memory:");
  try {
    const service = new ResearchService(db, undefined, vi.fn() as typeof fetch);
    const stamp = new Date().toISOString();
    for (let n = 0; n < 55; n += 1) {
      db.prepare(
        "INSERT INTO research_projects (id, owner_id, request_key, topic, mission, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'review', ?, ?)",
      ).run(createId("rsp"), "owner", `key-${n}`, `Topic ${n}`, `Topic ${n}`, stamp, stamp);
    }
    expect(service.count("owner")).toBe(55);
    const first = service.list("owner", undefined, 50, 0);
    const second = service.list("owner", undefined, 50, 50);
    expect(first).toHaveLength(50);
    expect(second).toHaveLength(5);
    expect(new Set([...first, ...second].map((row) => row.id)).size).toBe(55);
  } finally {
    db.close();
  }
});
