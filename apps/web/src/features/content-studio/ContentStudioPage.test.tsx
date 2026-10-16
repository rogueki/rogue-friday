import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CONTRACT_VERSION, createFridayClient } from "@friday/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { ContentStudioPage } from "./ContentStudioPage";

vi.mock("@/lib/settings", () => ({ useAppSettings: () => ({ settings: { dashboard: { contentStudioEnabled: true } }, isLoading: false }) }));
vi.mock("./MediaWorkshop", () => ({ MediaWorkshop: () => null }));

const legacy = { version: 1, exportiert_am: "2026-10-16T00:00:00.000Z", content: [{ id: "legacy", titel: "Alter Plan", plattform: "LinkedIn", format: "Feed-Post", beschreibung: "", zieldatum: "", status: "idee" }], postings: [] };
const envelope = (data: unknown) => ({ contractVersion: CONTRACT_VERSION, data, freshness: { state: "fresh", asOf: new Date().toISOString() } });

beforeEach(() => { localStorage.clear(); });
afterEach(() => { setApiClient(null); vi.unstubAllGlobals(); });

describe("Content Studio browser migration", () => {
  it("offers a controlled import only when the server is empty and preserves the browser backup", async () => {
    localStorage.setItem("friday.content-studio.plan.v1", JSON.stringify(legacy));
    const requests: Request[] = [];
    setApiClient(createFridayClient({ baseUrl: "http://localhost", getCsrfToken: () => "csrf-test", fetch: async (input) => {
      const request = input as Request;
      requests.push(request);
      if (request.method === "GET") return Response.json(envelope({ revision: 0, plan: null, updatedAt: null }));
      return Response.json(envelope({ revision: 1, plan: await request.json(), updatedAt: new Date().toISOString() }));
    } }));
    render(<ContentStudioPage />);
    expect(await screen.findByText(/Browserplan: 1 Ideen/)).toBeInTheDocument();
    expect(requests).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole("button", { name: "Browserplan übernehmen" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.headers.get("If-Match")).toBe("0");
    expect(requests[1]?.headers.get("X-CSRF-Token")).toBe("csrf-test");
    expect(localStorage.getItem("friday.content-studio.plan.v1")).toBe(JSON.stringify(legacy));
    expect(await screen.findByText(/Revision 1/)).toBeInTheDocument();
  });

  it("keeps the existing server plan authoritative over browser data", async () => {
    localStorage.setItem("friday.content-studio.plan.v1", JSON.stringify(legacy));
    const current = { ...legacy, content: [{ ...legacy.content[0], id: "server", titel: "Serverplan" }] };
    setApiClient(createFridayClient({ baseUrl: "http://localhost", fetch: async () => Response.json(envelope({ revision: 4, plan: current, updatedAt: new Date().toISOString() })) }));
    render(<ContentStudioPage />);
    expect(await screen.findByText("Serverplan")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Browserplan übernehmen" })).not.toBeInTheDocument();
    expect(localStorage.getItem("friday.content-studio.plan.v1")).toBe(JSON.stringify(legacy));
  });
});
