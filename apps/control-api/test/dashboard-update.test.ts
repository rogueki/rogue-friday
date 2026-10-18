import { expect, it } from "vitest";
import { startTestApi } from "./helpers";

it("requires owner and CSRF before starting a dashboard update", async () => {
  const api = await startTestApi();
  try {
    const anonymous = api.client();
    const viewer = api.client(); await viewer.loginDev("viewer");
    const owner = api.client(); await owner.loginDev("owner");
    const path = "/api/v1/dashboard-update/install";
    const body = { commit: "invalid" };
    expect((await anonymous.get("/api/v1/dashboard-update")).statusCode).toBe(403);
    expect((await viewer.get("/api/v1/dashboard-update")).statusCode).toBe(403);
    expect((await anonymous.request("POST", path, { body })).statusCode).toBe(403);
    expect((await viewer.request("POST", path, { body })).statusCode).toBe(403);
    expect((await owner.request("POST", path, { body, csrf: false })).statusCode).toBe(403);
    expect((await owner.request("POST", path, { body })).statusCode).toBe(409);
  } finally { await api.close(); }
});
