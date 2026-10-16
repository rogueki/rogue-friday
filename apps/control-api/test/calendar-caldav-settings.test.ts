import { expect, it } from "vitest";
import { startTestApi } from "./helpers";

it("requires complete CalDAV credentials and rejects local endpoints before switching providers", async () => {
  const api = await startTestApi({
    dataMode: "hybrid",
    authMode: "local",
    ownerPassword: "synthetic-test-password",
    adaptersYaml: 'allowlist:\n  caldav-calendar: "@friday/adapter-calendar-placeholder"\n',
  });
  try {
    const owner = api.client();
    await owner.loginOwner("synthetic-test-password");
    const settings = (await owner.get("/api/v1/settings/adapters", { query: { limit: "100" } })).json().items;
    const calendar = settings.find((item: { category: string }) => item.category === "calendar");
    expect(calendar.provider).toBe("mock-calendar");
    const path = `/api/v1/settings/adapters/${calendar.adapterId}`;
    const missing = await owner.patch(path, { provider: "caldav-calendar", config: { mode: "caldav" }, enabled: true });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.code).toBe("VALIDATION_FAILED");
    const local = await owner.patch(path, {
      provider: "caldav-calendar", config: { mode: "caldav" }, enabled: true,
      secrets: { calendarUrl: "https://127.0.0.1/dav/", username: "account", password: "app-password" },
    });
    expect(local.statusCode).toBe(422);
    expect(local.json().error.code).toBe("VALIDATION_FAILED");
    const after = (await owner.get("/api/v1/settings/adapters", { query: { limit: "100" } })).json().items
      .find((item: { category: string }) => item.category === "calendar");
    expect(after.provider).toBe("mock-calendar");
  } finally {
    await api.close();
  }
});
