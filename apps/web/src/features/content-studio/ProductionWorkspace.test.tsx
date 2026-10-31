import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONTRACT_VERSION, createFridayClient, type ContentIdea } from "@friday/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { ProductionWorkspace } from "./ProductionWorkspace";

vi.mock("@/lib/api/domains/contentStudioMedia", () => ({
  contentStudioMediaApi: { createSpeech: vi.fn(), downloadProductionArtifact: vi.fn() },
}));

const idea: ContentIdea = {
  id: "idea-1", titel: "Produktstart", plattform: "LinkedIn", format: "LinkedIn-Video",
  beschreibung: "Ein kurzer Produktfilm", zieldatum: "", status: "idee",
};

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { setApiClient(null); localStorage.clear(); sessionStorage.clear(); });

describe("automatic Content Studio production", () => {
  it("starts only after a preview bound to the idea and plan revision, then shows the job", async () => {
    const requests: Request[] = [];
    setApiClient(createFridayClient({ baseUrl: "http://localhost", getCsrfToken: () => "csrf-test", fetch: async (input) => {
      const request = input as Request;
      requests.push(request);
      return Response.json({
        contractVersion: CONTRACT_VERSION,
        data: { id: "00112233-4455-6677-8899-aabbccddeeff", ideaId: idea.id, kind: "video", state: "completed", providerTaskId: "task-1", artifactReady: true, errorCode: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        freshness: { state: "fresh", asOf: new Date().toISOString() },
      }, { status: 202 });
    } }));
    const user = userEvent.setup();
    render(<ProductionWorkspace ideas={[idea]} revision={7} />);
    expect(screen.queryByRole("button", { name: "Diesen Produktionsauftrag starten" })).not.toBeInTheDocument();
    expect(requests).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Auftrag prüfen" }));
    await user.click(screen.getByRole("button", { name: "Diesen Produktionsauftrag starten" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.url).toContain("/api/v1/content-studio/production-jobs");
    expect(requests[0]?.headers.get("Idempotency-Key")).toMatch(/^idem_/);
    expect(requests[0]?.headers.get("X-CSRF-Token")).toBe("csrf-test");
    expect(await requests[0]?.clone().json()).toEqual({ ideaId: idea.id, planRevision: 7, confirmed: true });
    expect(await screen.findByText(/Auftrag .*: Fertig/)).toBeInTheDocument();
    expect(sessionStorage.getItem("friday.content-studio.pending-production")).toBeNull();
  });
});
