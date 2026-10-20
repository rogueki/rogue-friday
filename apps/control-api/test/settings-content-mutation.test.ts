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

  it("saves a typed dashboard refresh interval through the canonical settings handler", async () => {
    const before = (await owner.get("/api/v1/settings")).json().data;
    const next = before.dashboard.autoRefreshSeconds === 3600 ? 3599 : before.dashboard.autoRefreshSeconds + 1;
    const text = `Set dashboard refresh to ${next} seconds`;
    const preview = await command(owner, text);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().previewText).toContain(`${next} Sekunden`);
    const previewId = preview.json().previewId as string;
    const confirmed = await command(owner, text, { confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().result.message).toContain("Laufzeitwirkung nicht separat verifiziert");
    const after = (await owner.get("/api/v1/settings")).json().data;
    expect(after.dashboard.autoRefreshSeconds).toBe(next);
    expect(after.version).toBe(before.version + 1);
    expect((await command(owner, text, { confirm: true, previewId })).json().status).toBe("executed");
    expect((await owner.get("/api/v1/settings")).json().data.version).toBe(after.version);
  });

  it("saves dashboard grid, sound and Content Studio switches through typed actions", async () => {
    const before = (await owner.get("/api/v1/settings")).json().data;
    const grid = !before.dashboard.backgroundGrid;
    const sound = !before.dashboard.soundEffects;
    const settingsEnabled = before.dashboard.contentStudioEnabled !== true;
    const actions = [
      [`Set dashboard background grid to ${grid ? "on" : "off"}`, "backgroundGrid", grid],
      [`Set sound effects to ${sound ? "on" : "off"}`, "soundEffects", sound],
      [`${settingsEnabled ? "Enable" : "Disable"} Content Studio`, "contentStudioEnabled", settingsEnabled],
    ] as const;
    for (const [text, key, value] of actions) {
      const preview = await command(owner, text);
      expect(preview.statusCode, preview.body).toBe(200);
      const previewId = preview.json().previewId as string;
      expect((await command(owner, text, { confirm: true, previewId })).statusCode).toBe(200);
      expect((await owner.get("/api/v1/settings")).json().data.dashboard[key]).toBe(value);
    }
  });

  it("guides plan export and import to the actual browser file actions", async () => {
    const settings = api.runtime.settings.get();
    if (!settings.dashboard.contentStudioEnabled)
      api.runtime.settings.patch({ dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, settings.version);
    const before = api.runtime.contentStudioPlan.get();
    const exported = await command(owner, "Export Content Studio plan");
    expect(exported.statusCode, exported.body).toBe(200);
    expect(exported.json()).toMatchObject({ status: "executed", result: { targetRoute: "/content-studio", message: expect.stringContaining("Plan exportieren") } });
    const imported = await command(owner, "Importiere den Redaktionsplan");
    expect(imported.json()).toMatchObject({ status: "executed", result: { targetRoute: "/content-studio", message: expect.stringContaining("Dateiauswahldialog") } });
    expect((await command(operator, "Export Content Studio plan")).statusCode).toBe(403);
    expect(api.runtime.contentStudioPlan.get().revision).toBe(before.revision);
  });

  it("saves typed profile enum choices through the canonical settings handler", async () => {
    const before = (await owner.get("/api/v1/settings")).json().data;
    const cases = [
      ["Set language to English", "locale", "en"],
      ["Set date format to yyyy-MM-dd", "dateFormat", "yyyy-MM-dd"],
      ["Set time format to 12h", "timeFormat", "12h"],
      ["Set first day of the week to Sunday", "firstDayOfWeek", "sunday"],
      ["Set timezone to Europe/Paris", "timeZone", "Europe/Paris"],
    ] as const;
    for (const [text, key, value] of cases) {
      const preview = await command(owner, text);
      expect(preview.statusCode, preview.body).toBe(200);
      expect(preview.json().previewText).toContain(key === "firstDayOfWeek" ? "Sonntag" : value);
      const previewId = preview.json().previewId as string;
      expect((await command(operator, text)).statusCode).toBe(403);
      expect((await command(owner, text, { confirm: true, previewId })).statusCode).toBe(200);
      const saved = (await owner.get("/api/v1/settings")).json().data;
      expect(saved.profile[key]).toBe(value);
      expect(saved.version).toBeGreaterThan(before.version);
    }
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

  it("renames an idea and changes its description through the captured plan revision", async () => {
    const settings = api.runtime.settings.get();
    if (!settings.dashboard.contentStudioEnabled)
      api.runtime.settings.patch({ dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, settings.version);
    const current = api.runtime.contentStudioPlan.get();
    const item = { id: "rename-target", titel: "Original title", plattform: "LinkedIn" as const,
      ziele: ["LinkedIn" as const], format: "Feed-Post" as const, beschreibung: "Old notes", zieldatum: "", status: "idee" as const };
    api.runtime.contentStudioPlan.put({ version: 1, exportiert_am: new Date().toISOString(),
      content: [...(current.plan?.content ?? []), item], postings: current.plan?.postings ?? [] }, current.revision);

    const renameText = 'Rename idea "original title" to "Updated title"';
    const discardedRename = await command(owner, renameText);
    expect((await command(owner, renameText, { previewId: discardedRename.json().previewId as string })).json().status).toBe("rejected");
    expect(api.runtime.contentStudioPlan.get().plan?.content.find((entry) => entry.id === item.id)?.titel).toBe("Original title");
    const renamePreview = await command(owner, renameText);
    expect(renamePreview.statusCode, renamePreview.body).toBe(200);
    expect(renamePreview.json().previewText).toContain("Updated title");
    const renameId = renamePreview.json().previewId as string;
    expect((await command(owner, 'Rename idea "original title" to "Correction"', { confirm: true, previewId: renameId })).statusCode).toBe(409);
    const renamed = await command(owner, renameText, { confirm: true, previewId: renameId });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(api.runtime.contentStudioPlan.get().plan?.content.find((entry) => entry.id === item.id)?.titel).toBe("Updated title");
    expect((await command(owner, renameText, { confirm: true, previewId: renameId })).json().status).toBe("executed");

    const descriptionText = 'Set description of idea "Updated title" to "Show recent audit events"';
    const descriptionPreview = await command(owner, descriptionText);
    const descriptionId = descriptionPreview.json().previewId as string;
    expect(descriptionPreview.json().previewText).toContain("Show recent audit events");
    const described = await command(owner, descriptionText, { confirm: true, previewId: descriptionId });
    expect(described.statusCode, described.body).toBe(200);
    expect(api.runtime.contentStudioPlan.get().plan?.content.find((entry) => entry.id === item.id)?.beschreibung).toBe("Show recent audit events");
    expect((await command(owner, descriptionText, { confirm: true, previewId: descriptionId })).json().status).toBe("executed");
  });

  it("schedules an idea as a posting with the UI default time and plan CAS", async () => {
    const settings = api.runtime.settings.get();
    if (!settings.dashboard.contentStudioEnabled)
      api.runtime.settings.patch({ dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, settings.version);
    const current = api.runtime.contentStudioPlan.get();
    const item = { id: "posting-source", titel: "Campaign draft", plattform: "Beide" as const,
      ziele: ["Instagram" as const, "Facebook" as const], format: "Story" as const, beschreibung: "", zieldatum: "", status: "idee" as const };
    api.runtime.contentStudioPlan.put({ version: 1, exportiert_am: new Date().toISOString(),
      content: [...(current.plan?.content ?? []), item], postings: current.plan?.postings ?? [] }, current.revision);
    const text = 'Schedule idea "campaign draft" for 2026-10-22';
    const discarded = await command(owner, text);
    const beforeDiscard = api.runtime.contentStudioPlan.get();
    expect((await command(owner, text, { previewId: discarded.json().previewId as string })).json().status).toBe("rejected");
    expect(api.runtime.contentStudioPlan.get().revision).toBe(beforeDiscard.revision);
    const preview = await command(owner, text);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().previewText).toContain("09:00");
    const previewId = preview.json().previewId as string;
    expect((await command(operator, text)).statusCode).toBe(403);
    const confirmed = await command(owner, text, { confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const saved = api.runtime.contentStudioPlan.get();
    expect(saved.plan?.postings.at(-1)).toMatchObject({ titel: item.titel, datum: "2026-10-22", uhrzeit: "09:00",
      plattform: "Instagram", ziele: ["Instagram", "Facebook"], format: "Story", status: "geplant" });
    const revision = saved.revision;
    expect((await command(owner, text, { confirm: true, previewId })).json().status).toBe("executed");
    expect(api.runtime.contentStudioPlan.get().revision).toBe(revision);

    const stalePreview = await command(owner, text);
    const staleId = stalePreview.json().previewId as string;
    const concurrent = api.runtime.contentStudioPlan.get();
    api.runtime.contentStudioPlan.put({ ...concurrent.plan!, content: concurrent.plan!.content.map((entry) =>
      entry.id === item.id ? { ...entry, beschreibung: "Changed by dashboard" } : entry) }, concurrent.revision);
    expect((await command(owner, text, { confirm: true, previewId: staleId })).statusCode).toBe(409);
    const afterStale = api.runtime.contentStudioPlan.get();
    expect(afterStale.plan?.postings.filter((entry) => entry.titel === item.titel)).toHaveLength(1);
    expect(afterStale.plan?.content.find((entry) => entry.id === item.id)?.beschreibung).toBe("Changed by dashboard");
    const ownerId = api.runtime.auth.issueDevSession("owner").principal.userId;
    expect(api.runtime.nativeApprovals.stateOf(ownerId, staleId)).toBe("uncertain");
  });

  it("updates idea date, format and target platforms using only allowed typed values", async () => {
    const settings = api.runtime.settings.get();
    if (!settings.dashboard.contentStudioEnabled)
      api.runtime.settings.patch({ dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, settings.version);
    const current = api.runtime.contentStudioPlan.get();
    const item = { id: "field-target", titel: "Field target", plattform: "LinkedIn" as const,
      ziele: ["LinkedIn" as const], format: "Feed-Post" as const, beschreibung: "", zieldatum: "", status: "idee" as const };
    api.runtime.contentStudioPlan.put({ version: 1, exportiert_am: new Date().toISOString(),
      content: [...(current.plan?.content ?? []), item], postings: current.plan?.postings ?? [] }, current.revision);
    const actions = [
      ['Set target date of idea "Field target" to 2026-10-22', { zieldatum: "2026-10-22" }],
      ['Set format of idea "Field target" to "YouTube-Short"', { format: "YouTube-Short" }],
      ['Set platforms of idea "Field target" to "TikTok and YouTube"', { plattform: "TikTok", ziele: ["TikTok", "YouTube"] }],
    ] as const;
    for (const [text, expected] of actions) {
      const preview = await command(owner, text);
      expect(preview.statusCode, preview.body).toBe(200);
      const previewId = preview.json().previewId as string;
      expect((await command(owner, text, { confirm: true, previewId })).statusCode).toBe(200);
      expect(api.runtime.contentStudioPlan.get().plan?.content.find((entry) => entry.id === item.id)).toMatchObject(expected);
    }
  });

  it("creates a manual posting and updates its status through canonical plan writes", async () => {
    const settings = api.runtime.settings.get();
    if (!settings.dashboard.contentStudioEnabled)
      api.runtime.settings.patch({ dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, settings.version);
    const text = 'Schedule posting "Release note" for 2026-10-23 at 14:30 on Instagram as "Story"';
    const preview = await command(owner, text);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().previewText).toContain("14:30");
    const previewId = preview.json().previewId as string;
    const confirmed = await command(owner, text, { confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const saved = api.runtime.contentStudioPlan.get();
    const posting = saved.plan?.postings.find((entry) => entry.titel === "Release note");
    expect(posting).toMatchObject({ datum: "2026-10-23", uhrzeit: "14:30", plattform: "Instagram", format: "Story", status: "geplant" });
    expect((await command(owner, text, { confirm: true, previewId })).json().status).toBe("executed");
    expect(api.runtime.contentStudioPlan.get().revision).toBe(saved.revision);

    const statusText = 'Set status of posting "Release note" on 2026-10-23 at 14:30 to posted';
    const statusPreview = await command(owner, statusText);
    const statusId = statusPreview.json().previewId as string;
    expect(statusPreview.json().previewText).toContain("gepostet");
    expect((await command(owner, statusText, { confirm: true, previewId: statusId })).statusCode).toBe(200);
    expect(api.runtime.contentStudioPlan.get().plan?.postings.find((entry) => entry.id === posting?.id)?.status).toBe("gepostet");
  });

  it("removes an idea and a posting only after their exact preview is confirmed", async () => {
    const settings = api.runtime.settings.get();
    if (!settings.dashboard.contentStudioEnabled)
      api.runtime.settings.patch({ dashboard: { ...settings.dashboard, contentStudioEnabled: true } }, settings.version);
    const current = api.runtime.contentStudioPlan.get();
    const idea = { id: "remove-idea", titel: "Delete this idea", plattform: "LinkedIn" as const,
      ziele: ["LinkedIn" as const], format: "Feed-Post" as const, beschreibung: "", zieldatum: "", status: "idee" as const };
    const posting = { id: "remove-posting", titel: "Delete this posting", datum: "2026-10-24", uhrzeit: "10:15",
      plattform: "Instagram" as const, ziele: ["Instagram" as const], format: "Story" as const, status: "geplant" as const };
    api.runtime.contentStudioPlan.put({ version: 1, exportiert_am: new Date().toISOString(),
      content: [...(current.plan?.content ?? []), idea], postings: [...(current.plan?.postings ?? []), posting] }, current.revision);

    const ideaText = 'Remove idea "Delete this idea"';
    const ideaPreview = await command(owner, ideaText);
    expect(ideaPreview.json().previewText).toContain("Zugehoerige Postings bleiben bestehen");
    const ideaId = ideaPreview.json().previewId as string;
    expect((await command(owner, ideaText, { previewId: ideaId })).json().status).toBe("rejected");
    expect(api.runtime.contentStudioPlan.get().plan?.content.some((entry) => entry.id === idea.id)).toBe(true);
    const confirmedIdeaPreview = await command(owner, ideaText);
    const confirmedIdeaId = confirmedIdeaPreview.json().previewId as string;
    expect((await command(owner, ideaText, { confirm: true, previewId: confirmedIdeaId })).statusCode).toBe(200);
    expect(api.runtime.contentStudioPlan.get().plan?.content.some((entry) => entry.id === idea.id)).toBe(false);
    expect(api.runtime.contentStudioPlan.get().plan?.postings.some((entry) => entry.id === posting.id)).toBe(true);

    const postingText = 'Remove posting "Delete this posting" on 2026-10-24 at 10:15';
    const postingPreview = await command(owner, postingText);
    const postingId = postingPreview.json().previewId as string;
    expect(postingPreview.json().previewText).toContain("Delete this posting");
    expect((await command(owner, postingText, { confirm: true, previewId: postingId })).statusCode).toBe(200);
    expect(api.runtime.contentStudioPlan.get().plan?.postings.some((entry) => entry.id === posting.id)).toBe(false);
  });
});
