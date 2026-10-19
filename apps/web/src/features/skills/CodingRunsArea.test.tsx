import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONTRACT_VERSION, createFridayClient } from "@friday/sdk";
import { ToastProvider } from "@friday/ui";
import { afterEach, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { CodingRunsArea } from "./CodingRunsArea";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/skills",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => { setApiClient(null); vi.unstubAllGlobals(); window.localStorage.clear(); });

it("sends an idempotency key in the shared SDK format for a coding run", async () => {
  const requests: Request[] = [];
  setApiClient(createFridayClient({ baseUrl: "http://localhost", getCsrfToken: () => "csrf-test", fetch: async (input) => {
    const request = input as Request;
    requests.push(request);
    if (request.url.endsWith("/api/v1/coding-runs/voice-repository")) return Response.json({ contractVersion: CONTRACT_VERSION,
      data: { alias: "", repository: "", revision: 0 }, freshness: { state: "fresh", asOf: new Date().toISOString() } });
    return Response.json({ contractVersion: CONTRACT_VERSION, data: {
      runId: "run_" + "a".repeat(32), status: "queued", requestedCli: "codex", requestedWorkdir: "/tmp/repo",
      preflightVersion: "codex 0.163.0", executionVerified: false, output: null, error: null, updatedAt: 1,
    }, freshness: { state: "fresh", asOf: new Date().toISOString() } }, { status: 202 });
  } }));
  const user = userEvent.setup();
  render(<QueryClientProvider client={new QueryClient()}><ToastProvider><CodingRunsArea skills={[]} /></ToastProvider></QueryClientProvider>);
  await user.type(screen.getByLabelText("Git-Repository unter deinem Benutzerprofil oder Friday-Installationspfad"), "C:\\Users\\Test\\repo");
  await user.type(screen.getByLabelText("Auftrag"), "Bitte diese Datei anpassen");
  await user.click(screen.getByRole("button", { name: "Coding-Auftrag starten" }));
  await waitFor(() => expect(requests.some((request) => request.method === "POST")).toBe(true));
  const post = requests.find((request) => request.method === "POST")!;
  expect(post.headers.get("Idempotency-Key")).toMatch(/^idem_[A-Z0-9]{26}$/);
  expect(post.headers.get("X-CSRF-Token")).toBe("csrf-test");
});
