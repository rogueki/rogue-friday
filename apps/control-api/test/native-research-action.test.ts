import { expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";

const endpoint = "http://127.0.0.1:8080/";
const results = {
  results: [
    { title: "Quelle A", url: "https://example.org/article", content: "Ein Suchindex-Snippet" },
    { title: "Duplikat", url: "https://example.org/article", content: "nochmal" },
    { title: "Unbrauchbar", url: "file:///etc/passwd", content: "nicht uebernehmen" },
  ],
};
const search = vi.fn(
  async (_input: RequestInfo | URL) =>
    new Response(JSON.stringify(results), { status: 200, headers: { "content-type": "application/json" } }),
);

async function disableTier2(owner: ReturnType<Awaited<ReturnType<typeof startTestApi>>["client"]>) {
  const settings = (await owner.get("/api/v1/settings")).json().data;
  expect(
    (
      await owner.patch(
        "/api/v1/settings",
        { approvals: { ...settings.approvals, confirmTier2: false } },
        { headers: { "if-match": String(settings.version) } },
      )
    ).statusCode,
  ).toBe(200);
}

async function disconnectProvider(owner: ReturnType<Awaited<ReturnType<typeof startTestApi>>["client"]>) {
  const current = (await owner.get("/api/v1/research/provider")).json().data;
  const response = await owner.patch(
    "/api/v1/research/provider",
    { endpoint: "" },
    { headers: { "if-match": String(current.version) } },
  );
  expect(response.statusCode, response.body).toBe(200);
}

it("stages exact research request, searches once, persists only unverified sources and replays", async () => {
  search.mockClear();
  const api = await startTestApi({
    dataMode: "hybrid",
    authMode: "local",
    ownerPassword: "strong-test-password",
    responseValidation: "throw",
    env: { FRIDAY_RESEARCH_SEARXNG_URL: endpoint },
    providerFetch: search as typeof fetch,
  });
  try {
    const owner = api.client();
    expect((await owner.loginOwner("strong-test-password")).statusCode).toBe(200);
    await disableTier2(owner);
    const stage = await owner.post("/api/v1/research/projects", { topic: "   Energiepreise Europa   " });
    expect(stage.statusCode, stage.body).toBe(403);
    expect(stage.json().error.details.stage).toBe("preview");
    expect(search).not.toHaveBeenCalled();
    const preview = stage.json().error.details.previewId as string;
    expect(
      (
        await owner.post(
          "/api/v1/research/projects",
          { topic: "Anderes Thema" },
          { headers: { "x-action-preview-id": preview } },
        )
      ).statusCode,
    ).toBe(409);
    const created = await owner.post(
      "/api/v1/research/projects",
      { topic: "Energiepreise Europa" },
      { headers: { "x-action-preview-id": preview } },
    );
    expect(created.statusCode, created.body).toBe(201);
    const project = created.json().data;
    expect(project).toMatchObject({
      status: "review",
      sourceCount: 1,
      findingCount: 0,
      artifactCount: 0,
      costEur: null,
      resultSummary: expect.stringContaining("unverifizierte"),
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(new URL(String(search.mock.calls[0]![0])).searchParams.get("q")).toBe("Energiepreise Europa");
    const sourceList = await owner.get(`/api/v1/research/projects/${project.id}/sources`);
    expect(sourceList.statusCode, sourceList.body).toBe(200);
    expect(sourceList.json().items).toMatchObject([
      {
        status: "queued",
        retrievedAt: null,
        reliability: 0,
        supportsStatement: null,
        url: "https://example.org/article",
      },
    ]);
    const replay = await owner.post(
      "/api/v1/research/projects",
      { topic: "Energiepreise Europa" },
      { headers: { "x-action-preview-id": preview } },
    );
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.id).toBe(project.id);
    expect(search).toHaveBeenCalledTimes(1);
    await disconnectProvider(owner);
    const replayAfterDisconnect = await owner.post(
      "/api/v1/research/projects",
      { topic: "Energiepreise Europa" },
      { headers: { "x-action-preview-id": preview } },
    );
    expect(replayAfterDisconnect.statusCode, replayAfterDisconnect.body).toBe(201);
    expect(replayAfterDisconnect.json().data.id).toBe(project.id);
    expect(search).toHaveBeenCalledTimes(1);
    expect((await owner.get("/api/v1/research/projects")).json().items).toHaveLength(1);
  } finally {
    await api.close();
  }
});

it("fails before staging when no provider is configured", async () => {
  const api = await startTestApi({
    dataMode: "hybrid",
    authMode: "local",
    ownerPassword: "strong-test-password",
    responseValidation: "throw",
  });
  try {
    const owner = api.client();
    expect((await owner.loginOwner("strong-test-password")).statusCode).toBe(200);
    const result = await owner.post("/api/v1/research/projects", { topic: "Energiepreise Europa" });
    expect([403, 503]).toContain(result.statusCode);
    expect(
      (api.runtime.db.prepare("SELECT COUNT(*) AS n FROM native_approval_requests").get() as { n: number }).n,
    ).toBe(0);
  } finally {
    await api.close();
  }
});

it("keeps failed provider calls visible and never repeats a search after confirmation replay", async () => {
  const failedSearch = vi.fn(async () => new Response("unavailable", { status: 503 }));
  const api = await startTestApi({
    dataMode: "hybrid",
    authMode: "local",
    ownerPassword: "strong-test-password",
    responseValidation: "throw",
    env: { FRIDAY_RESEARCH_SEARXNG_URL: endpoint },
    providerFetch: failedSearch as typeof fetch,
  });
  try {
    const owner = api.client();
    expect((await owner.loginOwner("strong-test-password")).statusCode).toBe(200);
    await disableTier2(owner);
    const body = { topic: "Forschungssuche Ausfall" };
    const stage = await owner.post("/api/v1/research/projects", body);
    const header = { "x-action-preview-id": stage.json().error.details.previewId as string };
    const created = await owner.post("/api/v1/research/projects", body, { headers: header });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ status: "failed", sourceCount: 0 });
    const replay = await owner.post("/api/v1/research/projects", body, { headers: header });
    expect(replay.json().data.id).toBe(created.json().data.id);
    expect(failedSearch).toHaveBeenCalledTimes(1);
  } finally {
    await api.close();
  }
});

it("owner configuration is revision-bound and changing provider invalidates a staged request", async () => {
  search.mockClear();
  const api = await startTestApi({
    dataMode: "hybrid",
    authMode: "local",
    ownerPassword: "strong-test-password",
    responseValidation: "throw",
    providerFetch: search as typeof fetch,
  });
  try {
    const owner = api.client();
    expect((await owner.loginOwner("strong-test-password")).statusCode).toBe(200);
    const initial = (await owner.get("/api/v1/research/provider")).json().data;
    expect(initial.configured).toBe(false);
    expect(
      (
        await owner.patch(
          "/api/v1/research/provider",
          { endpoint: endpoint },
          { headers: { "if-match": String(initial.version) } },
        )
      ).statusCode,
    ).toBe(200);
    const config = (await owner.get("/api/v1/research/provider")).json().data;
    expect(config).toMatchObject({ configured: true, version: initial.version + 1, maxSources: 10 });
    expect(
      (
        await owner.patch(
          "/api/v1/research/provider",
          { endpoint: "http://127.0.0.1:9090/" },
          { headers: { "if-match": String(initial.version) } },
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await owner.patch(
          "/api/v1/research/provider",
          { endpoint: "https://evil.example/" },
          { headers: { "if-match": String(config.version) } },
        )
      ).statusCode,
    ).toBe(422);
    await disableTier2(owner);
    const body = { topic: "Aenderung zwischen Vorschau und Ausfuehrung" };
    const stage = await owner.post("/api/v1/research/projects", body);
    expect(stage.statusCode).toBe(403);
    const previewId = stage.json().error.details.previewId as string;
    expect(
      (
        await owner.patch(
          "/api/v1/research/provider",
          { endpoint: "http://127.0.0.1:9090/" },
          { headers: { "if-match": String(config.version) } },
        )
      ).statusCode,
    ).toBe(200);
    const drift = await owner.post("/api/v1/research/projects", body, {
      headers: { "x-action-preview-id": previewId },
    });
    expect(drift.statusCode, drift.body).toBe(409);
    expect(search).not.toHaveBeenCalled();
  } finally {
    await api.close();
  }
});

it("approval dispatch records the research once and gives a durable project id", async () => {
  search.mockClear();
  const api = await startTestApi({
    dataMode: "hybrid",
    authMode: "local",
    ownerPassword: "strong-test-password",
    responseValidation: "throw",
    env: { FRIDAY_RESEARCH_SEARXNG_URL: endpoint },
    providerFetch: search as typeof fetch,
  });
  try {
    const owner = api.client();
    expect((await owner.loginOwner("strong-test-password")).statusCode).toBe(200);
    const body = { topic: "Erneuerbare Energie Daten" };
    const stage = await owner.post("/api/v1/research/projects", body);
    const confirm = await owner.post("/api/v1/research/projects", body, {
      headers: { "x-action-preview-id": stage.json().error.details.previewId as string },
    });
    expect(confirm.statusCode, confirm.body).toBe(403);
    expect(confirm.json().error.details.stage).toBe("approval");
    expect(search).not.toHaveBeenCalled();
    const id = confirm.json().error.details.approvalId as string;
    const opened = await owner.get(`/api/v1/approvals/${id}`);
    const decision = await owner.post(
      `/api/v1/approvals/${id}/approve`,
      {},
      { headers: { "x-approval-token": String(opened.headers["x-approval-token"]) } },
    );
    expect(decision.statusCode, decision.body).toBe(200);
    expect(search).toHaveBeenCalledTimes(1);
    expect((await owner.get("/api/v1/research/projects")).json().items).toMatchObject([
      { status: "review", sourceCount: 1 },
    ]);
  } finally {
    await api.close();
  }
});

it("German command uses the same saved action and reports only unverified sources", async () => {
  search.mockClear();
  const api = await startTestApi({
    dataMode: "hybrid",
    authMode: "local",
    ownerPassword: "strong-test-password",
    responseValidation: "throw",
    env: { FRIDAY_RESEARCH_SEARXNG_URL: endpoint },
    providerFetch: search as typeof fetch,
  });
  try {
    const owner = api.client();
    expect((await owner.loginOwner("strong-test-password")).statusCode).toBe(200);
    await disableTier2(owner);
    const text = "Recherchiere zum Thema: Energiepreise Europa und speichere die Quellen";
    const preview = await owner.post("/api/v1/commands", { text, source: "text" });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ status: "requires_confirmation", riskTier: 2 });
    expect(search).not.toHaveBeenCalled();
    const confirmed = await owner.post("/api/v1/commands", {
      text,
      source: "text",
      confirm: true,
      previewId: preview.json().previewId,
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({
      status: "executed",
      result: { message: expect.stringContaining("unverifizierte") },
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect((await owner.get("/api/v1/research/projects")).json().items).toHaveLength(1);
    const draftToDiscard = await owner.post("/api/v1/commands", {
      text: "Recherchiere zum Thema: Klimadaten Europa und speichere die Quellen",
      source: "text",
    });
    expect(draftToDiscard.json().status).toBe("requires_confirmation");
    await disconnectProvider(owner);
    const discarded = await owner.post("/api/v1/commands", {
      text: "Recherchiere zum Thema: Klimadaten Europa und speichere die Quellen",
      source: "text",
      previewId: draftToDiscard.json().previewId,
    });
    expect(discarded.statusCode, discarded.body).toBe(200);
    expect(discarded.json().status).toBe("rejected");
    const replay = await owner.post("/api/v1/commands", {
      text,
      source: "text",
      confirm: true,
      previewId: preview.json().previewId,
    });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().status).toBe("executed");
    expect(search).toHaveBeenCalledTimes(1);
  } finally {
    await api.close();
  }
});
