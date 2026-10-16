import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONTRACT_VERSION, createFridayClient } from "@friday/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { MediaWorkshop } from "./MediaWorkshop";

afterEach(() => { setApiClient(null); vi.unstubAllGlobals(); });

describe("Content Studio media controls", () => {
  it("requires an explicit paid-action check before starting kie.ai and exposes task status", async () => {
    const requests: Array<{ method: string; url: string; headers: Headers; body: unknown }> = [];
    setApiClient(createFridayClient({ baseUrl: "http://localhost", getCsrfToken: () => "csrf-test", fetch: async (input) => {
      const request = input as Request;
      requests.push({ method: request.method, url: request.url, headers: request.headers, body: request.method === "POST" ? await request.json() : null });
      const task = { taskId: "mock-task", kind: "image", state: request.method === "GET" ? "success" : "waiting", resultUrls: [], creditsConsumed: null };
      return Response.json({ contractVersion: CONTRACT_VERSION, data: task, freshness: { state: "fresh", asOf: new Date().toISOString() } }, { status: request.method === "POST" ? 202 : 200 });
    } }));
    const user = userEvent.setup();
    render(<MediaWorkshop />);
    const start = screen.getByRole("button", { name: "Auftrag starten" });
    expect(start).toBeDisabled();
    await user.type(screen.getByLabelText("Prompt"), "A blue room");
    expect(start).toBeDisabled();
    await user.click(screen.getByLabelText(/Kosten und Rechte habe ich geprüft/));
    await user.click(start);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.body).toMatchObject({ prompt: "A blue room", confirmed: true, kind: "image" });
    expect(requests[0]?.headers.get("Idempotency-Key")).toMatch(/^idem_/);
    expect(requests[0]?.headers.get("X-CSRF-Token")).toBe("csrf-test");
    expect(await screen.findByText(/Status: waiting/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Status abrufen" }));
    expect(await screen.findByText(/Status: success/)).toBeInTheDocument();
  });

  it("keeps speech generation disabled without explicit confirmation", async () => {
    const user = userEvent.setup();
    render(<MediaWorkshop />);
    const button = screen.getByRole("button", { name: "MP3 erzeugen" });
    await user.type(screen.getByLabelText("Voice-ID"), "voice123");
    await user.type(screen.getByLabelText("Text"), "Hallo");
    expect(button).toBeDisabled();
    await user.click(screen.getByLabelText(/Nutzungsrechte der Stimme/));
    expect(button).toBeEnabled();
  });
});
