import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONTRACT_VERSION, createFridayClient } from "@friday/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { MediaWorkshop } from "./MediaWorkshop";

afterEach(() => { setApiClient(null); vi.unstubAllGlobals(); });

describe("Content Studio media controls", () => {
  it("requires a current paid-action preview before starting kie.ai and exposes task status", async () => {
    const requests: Array<{ method: string; url: string; headers: Headers; body: unknown }> = [];
    setApiClient(createFridayClient({ baseUrl: "http://localhost", getCsrfToken: () => "csrf-test", fetch: async (input) => {
      const request = input as Request;
      requests.push({ method: request.method, url: request.url, headers: request.headers, body: request.method === "POST" ? await request.json() : null });
      const task = { taskId: "mock-task", kind: "image", state: request.method === "GET" ? "success" : "waiting", resultUrls: [], creditsConsumed: null };
      return Response.json({ contractVersion: CONTRACT_VERSION, data: task, freshness: { state: "fresh", asOf: new Date().toISOString() } }, { status: request.method === "POST" ? 202 : 200 });
    } }));
    const user = userEvent.setup();
    render(<MediaWorkshop />);
    const preview = screen.getByRole("button", { name: "Auftrag prüfen" });
    expect(preview).toBeDisabled();
    await user.type(screen.getByLabelText("Prompt"), "A blue room");
    expect(screen.queryByRole("button", { name: "Kostenpflichtigen Auftrag starten" })).not.toBeInTheDocument();
    await user.click(preview);
    await user.click(screen.getByRole("button", { name: "Kostenpflichtigen Auftrag starten" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.body).toMatchObject({ prompt: "A blue room", confirmed: true, kind: "image" });
    expect(requests[0]?.headers.get("Idempotency-Key")).toMatch(/^idem_/);
    expect(requests[0]?.headers.get("X-CSRF-Token")).toBe("csrf-test");
    expect(await screen.findByText(/Status: waiting/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Status abrufen" }));
    expect(await screen.findByText(/Status: success/)).toBeInTheDocument();
  });

  it("invalidates a speech preview when the text changes", async () => {
    const user = userEvent.setup();
    render(<MediaWorkshop />);
    const button = screen.getByRole("button", { name: "MP3-Auftrag prüfen" });
    await user.type(screen.getByLabelText("Voice-ID"), "voice123");
    await user.type(screen.getByLabelText("Text"), "Hallo");
    expect(button).toBeEnabled();
    await user.click(button);
    expect(screen.getByRole("button", { name: "Kostenpflichtige MP3 erzeugen" })).toBeEnabled();
    await user.type(screen.getByLabelText("Text"), " Friday");
    expect(screen.queryByRole("button", { name: "Kostenpflichtige MP3 erzeugen" })).not.toBeInTheDocument();
  });
});
