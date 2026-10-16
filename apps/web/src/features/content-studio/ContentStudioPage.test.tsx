import { render, screen, waitFor, within } from "@testing-library/react";
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
  it("does not block the page for an empty legacy browser plan", async () => {
    localStorage.setItem("friday.content-studio.plan.v1", JSON.stringify({ version: 1, content: [], postings: [] }));
    setApiClient(createFridayClient({ baseUrl: "http://localhost", fetch: async () => Response.json(envelope({ revision: 0, plan: null, updatedAt: null })) }));
    render(<ContentStudioPage />);
    expect(await screen.findByText("Neue Idee")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Browserplan übernehmen" })).not.toBeInTheDocument();
    expect(localStorage.getItem("friday.content-studio.plan.v1")).not.toBeNull();
  });

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

describe("Content Studio parity views", () => {
  it("shows the production guide, kanban, and calendar from the server plan", async () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const plan = { ...legacy, content: [{ ...legacy.content[0], id: "server", titel: "Serveridee" }], postings: [{ id: "post", titel: "Geplanter Clip", datum: date, uhrzeit: "09:00", plattform: "TikTok", format: "TikTok-Video", status: "geplant" }] };
    let revision = 3;
    const requests: Request[] = [];
    setApiClient(createFridayClient({ baseUrl: "http://localhost", getCsrfToken: () => "csrf-test", fetch: async (input) => {
      const request = input as Request;
      requests.push(request);
      if (request.method === "PUT") { Object.assign(plan, await request.json()); revision++; }
      return Response.json(envelope({ revision, plan, updatedAt: new Date().toISOString() }));
    } }));
    render(<ContentStudioPage />);
    expect(await screen.findByText("Serveridee")).toBeInTheDocument();
    expect(screen.getByText("Stimmen-Tools")).toBeInTheDocument();
    expect(screen.getByText("Format-Cheatsheet")).toBeInTheDocument();
    expect(screen.getByText("Qualitätsregeln")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Idee: 1 Ideen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Geplanter Clip.*Status wechseln/ })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Nächste Woche" }));
    expect(screen.queryByRole("button", { name: /Geplanter Clip.*Status wechseln/ })).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Aktuelle Woche" }));
    await userEvent.setup().click(screen.getByRole("button", { name: /Geplanter Clip.*Status wechseln/ }));
    await waitFor(() => expect(requests.filter((request) => request.method === "PUT")).toHaveLength(1));
    expect(requests.at(-1)?.headers.get("If-Match")).toBe("3");
    expect(plan.postings[0]?.status).toBe("gepostet");
    const ideaColumn = screen.getByRole("region", { name: "Idee: 1 Ideen" });
    await userEvent.setup().click(within(ideaColumn).getByRole("button", { name: "Bearbeiten" }));
    expect(screen.getByDisplayValue("Serveridee")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Änderungen speichern" })).toBeInTheDocument();
    await userEvent.setup().clear(screen.getByDisplayValue("Serveridee"));
    await userEvent.setup().type(screen.getByRole("textbox", { name: "Titel" }), "Bearbeitete Idee");
    await userEvent.setup().click(screen.getByRole("button", { name: "Änderungen speichern" }));
    await waitFor(() => expect(plan.content[0]?.titel).toBe("Bearbeitete Idee"));
    expect(requests.at(-1)?.headers.get("If-Match")).toBe("4");
    expect(await screen.findByText("Bearbeitete Idee")).toBeInTheDocument();
  });
});
