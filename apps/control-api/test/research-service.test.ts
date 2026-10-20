import { expect, it, vi } from "vitest";
import { openDatabase } from "../src/db/database";
import { ResearchService } from "../src/services/research";
import { createId } from "@friday/observability";
import { fetchResearchPage, isPublicResearchAddress } from "../src/services/research-page-fetch";

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

it("fetches only three public result pages and persists their content provenance", async () => {
  const db = openDatabase(":memory:");
  const search = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          results: [1, 2, 3, 4].map((n) => ({
            title: `Page ${n}`,
            url: `https://example.org/${n}`,
            content: "index snippet",
          })),
        }),
        { status: 200 },
      ),
  );
  const pages = vi.fn(async (url: string) => `Fetched page content from ${url}`);
  try {
    const service = new ResearchService(
      db,
      "http://127.0.0.1:8080/",
      search as typeof fetch,
      undefined,
      pages,
    );
    const project = await service.create("owner", "Bounded page retrieval", "page-key", 1);
    expect(project.status).toBe("review");
    expect(project.resultSummary).toContain("3 Seiten");
    expect(search).toHaveBeenCalledTimes(1);
    expect(pages).toHaveBeenCalledTimes(3);
    expect(service.sources("owner", project.id).map((source) => source.status)).toEqual([
      "retrieved",
      "retrieved",
      "retrieved",
      "queued",
    ]);
    const row = db
      .prepare(
        "SELECT body_text, content_hash, retrieved_at FROM research_sources WHERE project_id = ? AND status = 'retrieved' LIMIT 1",
      )
      .get(project.id) as { body_text: string; content_hash: string; retrieved_at: string };
    expect(row.body_text).toContain("Fetched page content");
    expect(row.content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.retrieved_at).toBeTruthy();
  } finally {
    db.close();
  }
});

it("keeps a failed page as an unverified search source alongside retrieved pages", async () => {
  const db = openDatabase(":memory:");
  const search = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          results: [
            { title: "Page A", url: "https://example.org/a", content: "search A" },
            { title: "Page B", url: "https://example.org/b", content: "search B" },
          ],
        }),
        { status: 200 },
      ),
  );
  const pages = vi.fn(async (url: string) => {
    if (url.endsWith("/a")) return "Read page A";
    throw new Error("PAGE_TIMEOUT");
  });
  try {
    const service = new ResearchService(
      db,
      "http://127.0.0.1:8080/",
      search as typeof fetch,
      undefined,
      pages,
    );
    const project = await service.create("owner", "Partial page retrieval", "partial-key", 1);
    expect(project.status).toBe("review");
    expect(project.resultSummary).toContain("1 Seiten");
    expect(service.sources("owner", project.id)).toMatchObject([
      { status: "retrieved", contentText: "Read page A", fetchError: null },
      { status: "failed", excerpt: "search B", contentText: null, fetchError: "PAGE_TIMEOUT" },
    ]);
  } finally {
    db.close();
  }
});

it("rejects local, metadata, mapped and documentation addresses before page request", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.2",
    "169.254.169.254",
    "192.168.1.2",
    "198.51.100.1",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
  ]) {
    expect(isPublicResearchAddress(address), address).toBe(false);
  }
  expect(isPublicResearchAddress("8.8.8.8")).toBe(true);
  expect(isPublicResearchAddress("2606:4700:4700::1111")).toBe(true);
});

it("does not request loopback or non-HTTP pages found in search results", async () => {
  await expect(fetchResearchPage("http://127.0.0.1:12345/internal")).rejects.toThrow("UNSAFE_ADDRESS");
  await expect(fetchResearchPage("file:///etc/passwd")).rejects.toThrow("UNSAFE_URL");
});
