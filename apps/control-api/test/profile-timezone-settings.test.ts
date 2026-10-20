import { afterEach, expect, it } from "vitest";
import { startTestApi, type TestApi } from "./helpers";

const opened: TestApi[] = [];
afterEach(async () => { for (const api of opened.splice(0)) await api.close(); });

it("rejects an unformattable profile time zone without changing the stored profile", async () => {
  const api = await startTestApi();
  opened.push(api);
  const owner = api.client();
  await owner.loginDev("owner");
  const original = (await owner.get("/api/v1/settings")).json().data;
  const rejected = await owner.patch("/api/v1/settings", {
    profile: { ...original.profile, timeZone: "Invalid/Zone" },
  }, { headers: { "if-match": String(original.version) } });
  expect(rejected.statusCode).toBe(422);
  expect(rejected.json().error.details.fieldErrors).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: "profile.timeZone" }),
  ]));
  const unchanged = (await owner.get("/api/v1/settings")).json().data;
  expect(unchanged.version).toBe(original.version);
  expect(unchanged.profile).toEqual(original.profile);

  const accepted = await owner.patch("/api/v1/settings", {
    profile: { ...original.profile, timeZone: "Europe/Berlin" },
  }, { headers: { "if-match": String(original.version) } });
  expect(accepted.statusCode, accepted.body).toBe(200);
  expect(accepted.json().data.profile.timeZone).toBe("Europe/Berlin");
});
