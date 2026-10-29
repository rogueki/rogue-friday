import { expect, it } from "vitest";
import { startTestApi } from "./helpers";

it("rejects path parameters that violate the contract schema", async () => {
  const api = await startTestApi({ dataMode: "mock", authMode: "local", ownerPassword: "synthetic-test-password",
    responseValidation: "throw" });
  try {
    const voice = api.client();
    const owner = api.client();
    expect((await owner.loginOwner("synthetic-test-password")).statusCode).toBe(200);
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };

    const traversal = await voice.get("/api/v1/voice/tasks/-..%2F", { headers });
    expect(traversal.statusCode, traversal.body).toBe(400);
    expect(traversal.json().error.code).toBe("VALIDATION_FAILED");

    const malformed = await voice.get("/api/v1/voice/tasks/task_short", { headers });
    expect(malformed.statusCode, malformed.body).toBe(400);
    expect(malformed.json().error.code).toBe("VALIDATION_FAILED");

    const skill = await owner.get("/api/v1/skills/-..%2Fetc/inspect");
    expect(skill.statusCode, skill.body).toBe(400);
    expect(skill.json().error.code).toBe("VALIDATION_FAILED");

    const items = (await owner.get("/api/v1/tasks")).json().items as Array<{ id: string }>;
    expect(items.length).toBeGreaterThan(0);
    const valid = await owner.get(`/api/v1/tasks/${items[0]!.id}`);
    expect(valid.statusCode, valid.body).toBe(200);

    const tooLong = await owner.get(`/api/v1/tasks/${"x".repeat(129)}`);
    expect(tooLong.statusCode, tooLong.body).toBe(400);
    expect(tooLong.json().error.code).toBe("VALIDATION_FAILED");
  } finally { await api.close(); }
});
