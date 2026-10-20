import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

describe("owner NLP mutations use native preview, revision checks and replay receipts", () => {
  let api: TestApi;
  let owner: ApiClient;
  let operator: ApiClient;

  beforeAll(async () => {
    api = await startTestApi();
    owner = api.client();
    operator = api.client();
    await owner.loginDev("owner");
    await operator.loginDev("operator");
  });

  afterAll(async () => { await api.close(); });

  const command = (client: ApiClient, text: string, options: { confirm?: boolean; previewId?: string; csrf?: boolean } = {}) => {
    const { csrf, ...bodyOptions } = options;
    return client.post("/api/v1/commands", { text, source: "text", ...bodyOptions }, { csrf });
  };

  it("previews, discards, confirms and replays compact-mode settings with owner and CSRF gates", async () => {
    const settingsBefore = (await owner.get("/api/v1/settings")).json().data;
    const target = !settingsBefore.dashboard.compact;
    const text = `Set dashboard compact to ${target ? "on" : "off"}`;

    const noCsrf = await command(owner, text, { csrf: false });
    expect(noCsrf.statusCode).toBe(403);
    expect((await owner.get("/api/v1/settings")).json().data.dashboard.compact).toBe(settingsBefore.dashboard.compact);

    const denied = await command(operator, text);
    expect(denied.statusCode).toBe(403);

    const discardedPreview = await command(owner, text);
    expect(discardedPreview.statusCode, discardedPreview.body).toBe(200);
    expect(discardedPreview.json()).toMatchObject({ status: "requires_confirmation", requiresConfirmation: true });
    const discardId = discardedPreview.json().previewId as string;
    const discarded = await command(owner, text, { previewId: discardId });
    expect(discarded.json()).toMatchObject({ status: "rejected", result: { message: "Entwurf verworfen." } });
    expect((await owner.get("/api/v1/settings")).json().data.dashboard.compact).toBe(settingsBefore.dashboard.compact);

    const preview = await command(owner, text);
    const previewId = preview.json().previewId as string;
    const confirmed = await command(owner, text, { confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ status: "executed", result: { message: expect.stringContaining("Laufzeitwirkung nicht separat verifiziert") } });
    const committed = (await owner.get("/api/v1/settings")).json().data;
    expect(committed.dashboard.compact).toBe(target);
    expect(committed.version).toBe(settingsBefore.version + 1);

    const replay = await command(owner, text, { confirm: true, previewId });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({ status: "executed" });
    expect((await owner.get("/api/v1/settings")).json().data.version).toBe(committed.version);
  });

  it("does not apply a stale settings preview and marks its mutation receipt uncertain", async () => {
    const settings = (await owner.get("/api/v1/settings")).json().data;
    const target = !settings.dashboard.compact;
    const text = `Set dashboard compact to ${target ? "on" : "off"}`;
    const preview = await command(owner, text);
    const previewId = preview.json().previewId as string;
    api.runtime.settings.patch({ dashboard: { ...settings.dashboard, autoRefreshSeconds: settings.dashboard.autoRefreshSeconds + 1 } }, settings.version);

    const stale = await command(owner, text, { confirm: true, previewId });
    expect(stale.statusCode).toBe(409);
    const ownerId = api.runtime.auth.issueDevSession("owner").principal.userId;
    expect(api.runtime.nativeApprovals.stateOf(ownerId, previewId)).toBe("uncertain");
    const after = (await owner.get("/api/v1/settings")).json().data;
    expect(after.dashboard.compact).toBe(settings.dashboard.compact);
    expect((await command(owner, text, { confirm: true, previewId })).statusCode).toBe(409);
    expect((await owner.get("/api/v1/settings")).json().data.version).toBe(after.version);
  });

  it("adds an idea through a typed action even when its title looks like a read, with plan CAS and replay", async () => {
    const settings = (await owner.get("/api/v1/settings")).json().data;
    if (!settings.dashboard.contentStudioEnabled)
      api.runtime.settings.patch({ dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, settings.version);
    const existing = api.runtime.contentStudioPlan.get();
    const title = "Show recent audit events";
    const text = `Add idea ${title} to Content Studio plan`;
    const preview = await command(owner, text);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ status: "requires_confirmation", previewText: expect.stringContaining(title) });
    const previewId = preview.json().previewId as string;

    expect((await command(operator, text)).statusCode).toBe(403);

    const originalText = "Add idea Original preview title to Content Studio plan";
    const changedText = "Add idea Corrected title to Content Studio plan";
    const correctionPreview = await command(owner, originalText);
    const correctionId = correctionPreview.json().previewId as string;
    expect((await command(owner, changedText, { confirm: true, previewId: correctionId })).statusCode).toBe(409);
    expect(api.runtime.contentStudioPlan.get().revision).toBe(existing.revision);
    expect((await command(owner, originalText, { previewId: correctionId })).json().status).toBe("rejected");

    const confirmed = await command(owner, text, { confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ status: "executed", result: { message: expect.stringContaining(title) } });
    const stored = api.runtime.contentStudioPlan.get();
    expect(stored.revision).toBe(existing.revision + 1);
    expect(stored.plan?.content.at(-1)).toMatchObject({ titel: title, plattform: "LinkedIn", format: "Feed-Post", status: "idee" });
    const replay = await command(owner, text, { confirm: true, previewId });
    expect(replay.json()).toMatchObject({ status: "executed" });
    expect(api.runtime.contentStudioPlan.get().revision).toBe(stored.revision);

    const staleTitle = "Stale plan draft";
    const staleText = `Add idea ${staleTitle} to Content Studio plan`;
    const stalePreview = await command(owner, staleText);
    const staleId = stalePreview.json().previewId as string;
    const current = api.runtime.contentStudioPlan.get();
    api.runtime.contentStudioPlan.put({ ...current.plan!, content: [...current.plan!.content, {
      id: "concurrent-ui-idea", titel: "Concurrent UI edit", plattform: "Instagram", ziele: ["Instagram"],
      format: "Story", beschreibung: "", zieldatum: "", status: "idee",
    }] }, current.revision);
    const staleConfirm = await command(owner, staleText, { confirm: true, previewId: staleId });
    expect(staleConfirm.statusCode).toBe(409);
    const concurrent = api.runtime.contentStudioPlan.get();
    expect(concurrent.plan?.content.some((item) => item.titel === "Concurrent UI edit")).toBe(true);
    expect(concurrent.plan?.content.some((item) => item.titel === staleTitle)).toBe(false);
    const ownerId = api.runtime.auth.issueDevSession("owner").principal.userId;
    expect(api.runtime.nativeApprovals.stateOf(ownerId, staleId)).toBe("uncertain");
  });

  it("changes the status of one uniquely titled idea through the native preview and plan CAS", async () => {
    const settings = (await owner.get("/api/v1/settings")).json().data;
    api.runtime.settings.patch({ approvals: { ...settings.approvals, confirmTier2: true, draftOnlyByDefault: true } }, settings.version);
    if (!settings.dashboard.contentStudioEnabled)
      api.runtime.settings.patch({ dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, api.runtime.settings.get().version);
    const current = api.runtime.contentStudioPlan.get();
    const item = { id: "status-target", titel: "Unique campaign idea", plattform: "LinkedIn" as const,
      ziele: ["LinkedIn" as const], format: "Feed-Post" as const, beschreibung: "", zieldatum: "", status: "idee" as const };
    api.runtime.contentStudioPlan.put({ version: 1, exportiert_am: new Date().toISOString(),
      content: [...(current.plan?.content ?? []), item], postings: current.plan?.postings ?? [] }, current.revision);
    const text = "Set status of idea unique campaign idea to in progress";
    const discardedPreview = await command(owner, text);
    const discardedId = discardedPreview.json().previewId as string;
    expect((await command(owner, text, { previewId: discardedId })).json().status).toBe("rejected");
    expect(api.runtime.contentStudioPlan.get().plan?.content.find((entry) => entry.id === item.id)?.status).toBe("idee");
    const preview = await command(owner, text);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ status: "requires_confirmation", previewText: expect.stringContaining("Unique campaign idea") });
    const previewId = preview.json().previewId as string;
    expect((await command(operator, text)).statusCode).toBe(403);
    const confirmed = await command(owner, text, { confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ status: "executed", result: { message: expect.stringContaining("gespeichert") } });
    const saved = api.runtime.contentStudioPlan.get();
    expect(saved.plan?.content.find((entry) => entry.id === item.id)?.status).toBe("in-arbeit");
    expect((await command(owner, text, { confirm: true, previewId })).json().status).toBe("executed");
    expect(api.runtime.contentStudioPlan.get().revision).toBe(saved.revision);
  });

  it("refuses ambiguous Content Studio idea status titles before staging", async () => {
    const settings = (await owner.get("/api/v1/settings")).json().data;
    if (!settings.dashboard.contentStudioEnabled)
      api.runtime.settings.patch({ dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, settings.version);
    const current = api.runtime.contentStudioPlan.get();
    const duplicate = (id: string) => ({ id, titel: "Duplicate title", plattform: "LinkedIn" as const,
      ziele: ["LinkedIn" as const], format: "Feed-Post" as const, beschreibung: "", zieldatum: "", status: "idee" as const });
    api.runtime.contentStudioPlan.put({ version: 1, exportiert_am: new Date().toISOString(),
      content: [...(current.plan?.content ?? []), duplicate("duplicate-one"), duplicate("duplicate-two")],
      postings: current.plan?.postings ?? [] }, current.revision);
    const response = await command(owner, "Set status of idea Duplicate title to done");
    expect(response.statusCode).toBe(409);
    expect(api.runtime.contentStudioPlan.get().plan?.content.filter((entry) => entry.titel === "Duplicate title").every((entry) => entry.status === "idee")).toBe(true);
  });
});
