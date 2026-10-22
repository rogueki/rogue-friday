import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

// DASH-02.03: the typed UI patch and the confirmed voice/text dialog must end in the same canonical action
// (settingsHandlers.updateSettings), bind the confirmation to the staged content and the current revision, and
// leave one audit action type behind. The test observes the real audit table instead of trusting the response text.
describe("UI patch and voice confirmation use the same settings action", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeAll(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });

  afterAll(async () => { await api.close(); });

  const command = (text: string, options: { confirm?: boolean; previewId?: string; csrf?: boolean } = {}) => {
    const { csrf, ...body } = options;
    return owner.post("/api/v1/commands", { text, source: "text", ...body }, { csrf });
  };

  const auditActions = () => (api.runtime.db.prepare("SELECT action FROM audit_log ORDER BY seq").all() as { action: string }[])
    .map((row) => row.action);

  it("commits both paths through the same handler, version step and audit action", async () => {
    const start = (await owner.get("/api/v1/settings")).json().data;
    const refresh = start.dashboard.autoRefreshSeconds === 45 ? 30 : 45;

    const patched = await owner.patch("/api/v1/settings",
      { dashboard: { ...start.dashboard, autoRefreshSeconds: refresh } },
      { headers: { "if-match": String(start.version) } });
    expect(patched.statusCode, patched.body).toBe(200);
    const afterUi = patched.json().data;
    expect(afterUi.version).toBe(start.version + 1);
    expect(afterUi.dashboard.autoRefreshSeconds).toBe(refresh);

    const text = `Set dashboard compact to ${start.dashboard.compact ? "off" : "on"}`;
    const preview = await command(text);
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json()).toMatchObject({ status: "requires_confirmation", requiresConfirmation: true });
    const previewId = preview.json().previewId as string;
    expect(preview.json().previewText).toContain("ompaktansicht");

    const confirmed = await command(text, { confirm: true, previewId });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ status: "executed" });

    const afterVoice = (await owner.get("/api/v1/settings")).json().data;
    expect(afterVoice.version).toBe(afterUi.version + 1);
    expect(afterVoice.dashboard.compact).toBe(!start.dashboard.compact);
    expect(afterVoice.dashboard.autoRefreshSeconds).toBe(refresh);

    const updated = auditActions().filter((action) => action === "settings.updated");
    expect(updated.length).toBeGreaterThanOrEqual(2);

    // A replay of the same confirmation is idempotent: same revision, no second audit write.
    const updatesBeforeReplay = auditActions().filter((action) => action === "settings.updated").length;
    const replay = await command(text, { confirm: true, previewId });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()).toMatchObject({ status: "executed" });
    expect((await owner.get("/api/v1/settings")).json().data.version).toBe(afterVoice.version);
    expect(auditActions().filter((action) => action === "settings.updated").length).toBe(updatesBeforeReplay);
  });

  it("refuses a staged confirmation once the revision moved on", async () => {
    const before = (await owner.get("/api/v1/settings")).json().data;
    const text = `Set dashboard compact to ${before.dashboard.compact ? "off" : "on"}`;
    const preview = await command(text);
    const previewId = preview.json().previewId as string;

    // Someone else writes in between: the staged action carries the old revision.
    const concurrent = await owner.patch("/api/v1/settings",
      { dashboard: { ...before.dashboard, soundEffects: !before.dashboard.soundEffects } },
      { headers: { "if-match": String(before.version) } });
    expect(concurrent.statusCode, concurrent.body).toBe(200);

    const stale = await command(text, { confirm: true, previewId });
    expect(stale.statusCode, stale.body).toBe(409);
    const after = (await owner.get("/api/v1/settings")).json().data;
    expect(after.dashboard.compact).toBe(before.dashboard.compact);
    expect(after.dashboard.soundEffects).toBe(!before.dashboard.soundEffects);
  });

  it("binds the confirmation to the staged content, not to the spoken text", async () => {
    const before = (await owner.get("/api/v1/settings")).json().data;
    const onText = "Set dashboard compact to on";
    const preview = await command(onText);
    expect(preview.json().status).toBe("requires_confirmation");

    // Same preview id, different spoken instruction: the staged content wins or the request is refused.
    const other = await command("Set dashboard compact to off", { confirm: true, previewId: preview.json().previewId as string });
    const after = (await owner.get("/api/v1/settings")).json().data;
    if (other.statusCode === 200) {
      expect(after.dashboard.compact).toBe(true);
    } else {
      expect(other.statusCode).toBe(409);
      expect(after.dashboard.compact).toBe(before.dashboard.compact);
    }
  });
});