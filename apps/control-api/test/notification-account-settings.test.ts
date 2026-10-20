import { afterEach, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

const opened: TestApi[] = [];
afterEach(async () => { for (const api of opened.splice(0)) await api.close(); });

it("rejects unsupported active messenger account IDs while preserving disabled legacy values", async () => {
  const api = await startTestApi();
  opened.push(api);
  const owner = api.client();
  await owner.loginDev("owner");
  const original = (await owner.get("/api/v1/settings")).json().data;
  const channels = original.notifications.channels.filter((channel: { kind: string }) => channel.kind !== "telegram");
  const legacy = { ...original.notifications, channels: [...channels,
    { kind: "telegram", enabled: false, minPriority: "P2", accountId: "old-profile" }] };
  const saved = await owner.patch("/api/v1/settings", { notifications: legacy },
    { headers: { "if-match": String(original.version) } });
  expect(saved.statusCode, saved.body).toBe(200);
  const version = saved.json().data.version as number;
  const enabled = { ...legacy, channels: legacy.channels.map((channel: { kind: string; enabled: boolean }) =>
    channel.kind === "telegram" ? { ...channel, enabled: true } : channel) };
  const rejected = await owner.patch("/api/v1/settings", { notifications: enabled },
    { headers: { "if-match": String(version) } });
  expect(rejected.statusCode).toBe(422);
  expect(rejected.json().error.details.fieldErrors).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: "notifications.channels.telegram.accountId" }),
  ]));
  const unchanged = (await owner.get("/api/v1/settings")).json().data;
  expect(unchanged.version).toBe(version);
  expect(unchanged.notifications.channels.find((channel: { kind: string }) => channel.kind === "telegram"))
    .toMatchObject({ enabled: false, accountId: "old-profile" });
  const defaultOnly = { ...legacy, channels: legacy.channels.map((channel: { kind: string }) =>
    channel.kind === "telegram" ? { ...channel, enabled: true, accountId: "default" } : channel) };
  expect((await owner.patch("/api/v1/settings", { notifications: defaultOnly },
    { headers: { "if-match": String(version) } })).statusCode).toBe(200);
});
