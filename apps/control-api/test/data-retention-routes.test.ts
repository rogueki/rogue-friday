import { expect, it } from "vitest";
import { startTestApi } from "./helpers";

it("exposes owner-only preview and scoped run through the API", async () => {
  const api = await startTestApi();
  try {
    const viewer = api.client(); await viewer.loginDev("viewer");
    const owner = api.client(); await owner.loginDev("owner");
    expect((await viewer.request("GET", "/api/v1/data-retention")).statusCode).toBe(403);
    expect((await viewer.request("POST", "/api/v1/data-retention/actions", { body: { action: "run" } })).statusCode).toBe(403);
    expect((await owner.request("POST", "/api/v1/data-retention/actions", { body: { action: "preview" }, csrf: false })).statusCode).toBe(403);
    const preview = await owner.request("POST", "/api/v1/data-retention/actions", { body: { action: "preview" } });
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().data).toMatchObject({ action: "preview", memoryPolicy: "unlimited",
      auditPolicy: "archive-local-indefinitely" });
    expect((await owner.request("GET", "/api/v1/data-retention")).json().data.automaticEnabled).toBe(false);
    const activated = await owner.request("POST", "/api/v1/data-retention/actions", { body: { action: "activate" } });
    expect(activated.statusCode, activated.body).toBe(200);
    expect((await owner.request("GET", "/api/v1/data-retention")).json().data.automaticEnabled).toBe(true);
    const run = await owner.request("POST", "/api/v1/data-retention/actions", { body: { action: "run" } });
    expect(run.statusCode, run.body).toBe(200);
    expect(run.json().data.removed).toBeDefined();
    const status = await owner.request("GET", "/api/v1/data-retention");
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json().data.last.status).toBe("success");
  } finally { await api.close(); }
});
