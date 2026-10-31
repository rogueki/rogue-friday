import { expect, it } from "vitest";
import { startTestApi } from "./helpers";

const path = "/api/v1/quiet-mode";

it("reads and writes quiet mode through the control API", async () => {
  const api = await startTestApi({ dataMode: "mock", authMode: "local", ownerPassword: "synthetic-test-password",
    responseValidation: "throw" });
  try {
    const owner = api.client();
    expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
    const read = await owner.get(path);
    expect(read.statusCode, read.body).toBe(200);
    expect(typeof read.json().data.active).toBe("boolean");

    const bridge = api.client();
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    const until = new Date(api.runtime.nowMs() + 30 * 60_000).toISOString();
    const set = await bridge.request("PUT", path, { body: { until }, headers });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().data.source).toBe("temporary");
    const afterSet = await bridge.get(path, { headers });
    expect(afterSet.statusCode, afterSet.body).toBe(200);
    expect(afterSet.json().data.active).toBe(true);

    const invalid = await bridge.request("PUT", path, { body: { until: new Date(api.runtime.nowMs() - 60_000).toISOString() }, headers });
    expect(invalid.statusCode, invalid.body).toBe(422);

    const cleared = await owner.delete(path);
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(cleared.json().data.temporaryUntil).toBeNull();

    const anonymous = api.client();
    const unauthorized = await anonymous.get(path);
    expect(unauthorized.statusCode).toBe(401);
  } finally { await api.close(); }
});
