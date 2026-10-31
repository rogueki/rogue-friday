import { expect, it } from "vitest";
import { startTestApi } from "./helpers";

it("publishes a navigation request for the local voice bridge without changing anything", async () => {
  const api = await startTestApi({ dataMode: "mock", authMode: "local", ownerPassword: "synthetic-test-password",
    responseValidation: "throw" });
  try {
    const voice = api.client();
    const received: Array<{ type: string; data: unknown }> = [];
    const unsubscribe = api.runtime.hub.subscribe((event) => {
      if ((event.type as string) === "friday.ui.navigation_requested") received.push(event);
    });
    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    const response = await voice.post("/api/v1/voice/navigation", { area: "calendar", tour: false }, { headers });
    unsubscribe();
    expect(response.statusCode, response.body).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]?.data).toEqual({ area: "calendar", tour: false });
  } finally { await api.close(); }
});

it("rejects navigation without the bridge token or owner session and validates the area", async () => {
  const api = await startTestApi({ dataMode: "mock", authMode: "local", ownerPassword: "synthetic-test-password",
    responseValidation: "throw" });
  try {
    const voice = api.client();
    const received: Array<{ type: string; data: unknown }> = [];
    const unsubscribe = api.runtime.hub.subscribe((event) => {
      if ((event.type as string) === "friday.ui.navigation_requested") received.push(event);
    });
    const noToken = await voice.post("/api/v1/voice/navigation", { area: "calendar", tour: false });
    expect([401, 403]).toContain(noToken.statusCode);
    expect(received).toHaveLength(0);

    const headers = { authorization: `Bearer ${api.runtime.voiceBridgeKey.toString("base64")}` };
    const invalid = await voice.post("/api/v1/voice/navigation", { area: "nowhere", tour: false }, { headers });
    unsubscribe();
    expect([400, 422]).toContain(invalid.statusCode);
    expect(received).toHaveLength(0);
  } finally { await api.close(); }
});