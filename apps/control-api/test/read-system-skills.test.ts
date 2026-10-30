import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApi, type ApiClient, type TestApi } from "./helpers";

/**
 * System- und Skillabfrage per Sprache: die Antwort muss mit `GET /api/v1/health`, `GET /api/v1/system/metrics` und
 * `GET /api/v1/skills` uebereinstimmen; Skills bleiben wie die Route dem Eigentuemer vorbehalten.
 */
describe("spoken system and skill reads", () => {
  let api: TestApi;
  let owner: ApiClient;

  beforeEach(async () => {
    api = await startTestApi();
    owner = api.client();
    await owner.loginDev("owner");
  });

  afterEach(async () => {
    await api.close();
  });

  async function command(client: ApiClient, text: string) {
    const response = await client.post("/api/v1/commands", { text, source: "voice" });
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    return response.json().result.message as string;
  }

  it("reports the health the dashboard reports", async () => {
    const health = (await owner.get("/api/v1/health")).json() as { status: string; components: Array<{ name: string; status: string }> };
    const message = await command(owner, "wie ist der systemstatus");
    expect(message).toContain(`Systemstatus ${health.status}`);
    expect(message).toContain(`${health.components.length} Komponenten`);
    for (const component of health.components.filter((item) => item.status !== "online").slice(0, 5))
      expect(message, `${component.name} fehlt in: ${message}`).toContain(component.name);
  });

  it("reports the load the system page reports", async () => {
    const response = await owner.get("/api/v1/system/metrics");
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    const metrics = response.json().data as { cpu: { cores: number } };
    const message = await command(owner, "wie hoch ist die auslastung");
    expect(message).toContain(`${metrics.cpu.cores} Kernen`);
    expect(message).toContain("Arbeitsspeicher");
  });

  it("counts the skills the skill page lists", async () => {
    const response = await owner.get("/api/v1/skills");
    expect(response.statusCode, JSON.stringify(response.body)).toBe(200);
    const skills = response.json().data as Array<{ name: string; enabled: boolean | null }>;
    const message = await command(owner, "welche skills habe ich");
    expect(message).toContain(`${skills.length} Skills`);
    expect(message).toContain(`${skills.filter((skill) => skill.enabled === true).length} aktiv`);
  });

  it("keeps the skill catalog owner-only like the route", async () => {
    const viewer = api.client();
    await viewer.loginDev("viewer");
    expect((await viewer.get("/api/v1/skills")).statusCode).toBe(403);
    const response = await viewer.post("/api/v1/commands", { text: "welche skills habe ich", source: "voice" });
    expect(response.statusCode).toBe(403);
  });
});
