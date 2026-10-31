/* eslint-disable @typescript-eslint/no-explicit-any -- test code reads untyped JSON bodies that the contract validators check */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startTestApi, type ApiClient } from "./helpers";

const PASSWORD = "update-result-alert-password";

/** Starts the live runtime with its background checks, hands the update alerts to `act`, and stops it again. */
async function withUpdateAlerts(dir: string, act: (alerts: any[], owner: ApiClient) => Promise<void>): Promise<void> {
  const api = await startTestApi({ dir, dataMode: "live", authMode: "local", ownerPassword: PASSWORD,
    env: { FRIDAY_STORAGE_PATH: "/" }, background: true });
  try {
    const owner = api.client();
    expect((await owner.loginOwner(PASSWORD)).statusCode).toBe(200);
    const deadline = Date.now() + 10_000;
    for (;;) {
      const response = await owner.get("/api/v1/notifications", { query: { category: "system" } });
      expect(response.statusCode, response.body).toBe(200);
      const items = (response.json().items as any[]).filter((item) => item.sourceRef?.id === "dashboard-update");
      if (items.length > 0 || Date.now() > deadline) {
        await act(items, owner);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally { await api.close(); }
}

it("raises one alert for a failed GitHub update and does not reopen it after a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "friday-update-alert-"));
  try {
    mkdirSync(join(dir, "data"), { recursive: true });
    // Written by update-dashboard-github.ps1 when a run fails; the Control API only reads it.
    writeFileSync(join(dir, "data", "dashboard-update-result.json"), JSON.stringify({
      commit: "0123456789abcdef0123456789abcdef01234567", status: "failed", time: "2026-10-31T01:00:00Z",
      message: "Build abgebrochen" }));
    let alertId = "";
    await withUpdateAlerts(dir, async (alerts, owner) => {
      expect(alerts).toEqual([expect.objectContaining({ status: "open", title: "Update fehlgeschlagen",
        targetRoute: "/settings?area=dashboard" })]);
      expect(alerts[0].body).toContain("0123456");
      expect(alerts[0].body).toContain("Build abgebrochen");
      alertId = alerts[0].id;
      const acknowledged = await owner.post(`/api/v1/notifications/${alertId}/acknowledge`, {},
        { headers: { "if-match": String(alerts[0].version) } });
      expect(acknowledged.statusCode, acknowledged.body).toBe(200);
    });

    await withUpdateAlerts(dir, async (alerts) => {
      expect(alerts).toEqual([expect.objectContaining({ id: alertId, status: "acknowledged" })]);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
