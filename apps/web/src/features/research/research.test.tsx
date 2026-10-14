import type { ResearchArtifact, ResearchFinding, ResearchProject, ResearchSource } from "@jarvis/sdk";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { listOf, mockElementSize, NOW, routedFetch, SOURCE } from "@/features/system/testSupport";
import { buildResearchJson, buildResearchMarkdown, findingsForSource, mapFindingEvidence, type ResearchBundle } from "./export";
import { ResearchPage } from "./ResearchPage";

const push = vi.fn();
const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), usePathname: () => "/research", useSearchParams: () => params }));

const saveText = vi.fn();
vi.mock("@/features/system/download", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/system/download")>()), saveText: (...args: unknown[]) => saveText(...args) }));

const base = { version: 1, createdAt: NOW, updatedAt: NOW, source: SOURCE };
const PROJECT_ID = "rsch_01JAAAAAAAAAAAAAAAAAAAAAAA";

function project(partial: Partial<ResearchProject> = {}): ResearchProject {
  return {
    ...base,
    id: PROJECT_ID,
    topic: "Büromöbel-Anbieter",
    mission: "Drei Anbieter vergleichen",
    status: "running",
    agentIds: ["agent_01JAAAAAAAAAAAAAAAAAAAAAAA"],
    progress: { mode: "determinate", value: 0.62 },
    sourceCount: 2,
    findingCount: 2,
    contradictionCount: 1,
    artifactCount: 1,
    resultSummary: null,
    runtimeMs: 1_200_000,
    costEur: null,
    ...partial,
  };
}

const sources: ResearchSource[] = [
  { ...base, id: "src_01JAAAAAAAAAAAAAAAAAAAAAAA", projectId: PROJECT_ID, title: "Preisliste 2026", domain: "buero-nord.example", url: "https://buero-nord.example/preise", retrievedAt: NOW, relevance: 0.9, reliability: 0.85, supportsStatement: "Drei Wochen Lieferzeit", excerpt: "Lieferzeit: 3 Wochen", status: "retrieved" },
  { ...base, id: "src_01JBBBBBBBBBBBBBBBBBBBBBBB", projectId: PROJECT_ID, title: "Angebot", domain: "leine.example", url: "javascript:alert(1)", retrievedAt: null, relevance: 0.7, reliability: 0.6, supportsStatement: null, excerpt: null, status: "queued" },
];
const findings: ResearchFinding[] = [
  { ...base, id: "fnd_01JAAAAAAAAAAAAAAAAAAAAAAA", projectId: PROJECT_ID, statement: "Büro-Nord liefert am schnellsten", confidence: 0.88, supportingSourceIds: [sources[0]?.id ?? ""], contradictions: [], status: "verified" },
  { ...base, id: "fnd_01JBBBBBBBBBBBBBBBBBBBBBBB", projectId: PROJECT_ID, statement: "Leine ist am günstigsten", confidence: 0.72, supportingSourceIds: [sources[1]?.id ?? "", "src_01JMISSINGMISSINGMISSINGMI"], contradictions: [{ sourceId: null, findingId: null, description: "Montage nicht enthalten" }], status: "draft" },
];
const artifacts: ResearchArtifact[] = [{ ...base, id: "art_01JAAAAAAAAAAAAAAAAAAAAAAA", projectId: PROJECT_ID, name: "Vergleich.md", format: "markdown", fileId: "file_01JAAAAAAAAAAAAAAAAAAAAAAA", sizeBytes: 1200 }];

const routes = (p: ResearchProject = project()) => ({
  "GET /api/v1/research/projects": listOf([p]),
  [`GET /api/v1/research/projects/${PROJECT_ID}/sources`]: listOf(sources),
  [`GET /api/v1/research/projects/${PROJECT_ID}/findings`]: listOf(findings),
  [`GET /api/v1/research/projects/${PROJECT_ID}/artifacts`]: listOf(artifacts),
  "GET /api/v1/agents": listOf([{ id: "agent_01JAAAAAAAAAAAAAAAAAAAAAAA", name: "Recherche-Agent" }]),
});

let restore: () => void;
beforeEach(() => {
  restore = mockElementSize(1200, 600);
  params = new URLSearchParams();
  push.mockReset();
  replace.mockReset();
  saveText.mockReset();
});
afterEach(() => {
  restore();
  setApiClient(null);
});

describe("evidence mapping and export", () => {
  const bundle: ResearchBundle = { project: project(), sources, findings, artifacts, agentNames: { agent_01JAAAAAAAAAAAAAAAAAAAAAAA: "Recherche-Agent" }, exportedAt: "2026-10-14T09:00:00.000Z" };

  it("maps each finding to the sources that support it and flags unknown ids", () => {
    const evidence = mapFindingEvidence(findings, sources);
    expect(evidence[0]?.supporting.map((s) => s.title)).toEqual(["Preisliste 2026"]);
    expect(evidence[1]?.supporting.map((s) => s.title)).toEqual(["Angebot"]);
    expect(evidence[1]?.missingSourceIds).toEqual(["src_01JMISSINGMISSINGMISSINGMI"]);
    expect(findingsForSource(sources[0]?.id ?? "", findings).map((f) => f.id)).toEqual(["fnd_01JAAAAAAAAAAAAAAAAAAAAAAA"]);
  });

  it("writes a Markdown export in which every statement names its numbered sources", () => {
    const markdown = buildResearchMarkdown(bundle);
    expect(markdown).toContain("# Büromöbel-Anbieter");
    expect(markdown).toContain("1. Büro-Nord liefert am schnellsten (Verifiziert, Konfidenz 88 %)");
    expect(markdown).toContain("Belege: [1]");
    expect(markdown).toContain("Belege: [2] [?]");
    expect(markdown).toContain("Widerspruch: Montage nicht enthalten");
    expect(markdown).toContain("**Kosten:** nicht gemeldet");
    expect(markdown).toContain("Vergleich.md (MARKDOWN)");
  });

  it("writes JSON with the API objects unchanged and escapes Markdown control characters", () => {
    const parsed = JSON.parse(buildResearchJson(bundle)) as { project: ResearchProject; sources: unknown[]; findings: unknown[] };
    expect(parsed.project.id).toBe(PROJECT_ID);
    expect(parsed.sources).toHaveLength(2);
    expect(parsed.findings).toHaveLength(2);
    const tricky = buildResearchMarkdown({ ...bundle, project: project({ topic: "A|B *x*" }) });
    expect(tricky).toContain("# A\\|B \\*x\\*");
  });
});

describe("research page", () => {
  it("shows the project view with real progress, agents, runtime, cost placeholder and evidence chips", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<ResearchPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ research: { read: true, export: true } }) });
    expect(await screen.findAllByText("Büromöbel-Anbieter")).not.toHaveLength(0);
    expect(await screen.findByText("Büro-Nord liefert am schnellsten")).toBeInTheDocument();
    expect(screen.getAllByRole("progressbar", { name: "Fortschritt" })[0]).toHaveAttribute("aria-valuenow", "62");
    expect(await screen.findByText("Recherche-Agent")).toBeInTheDocument();
    expect(screen.getByText("20 Min. 00 Sek.")).toBeInTheDocument();
    expect(screen.getByText("Montage nicht enthalten")).toBeInTheDocument();
    const chip = screen.getByRole("button", { name: /buero-nord\.example/ });
    expect(chip).toBeInTheDocument();
    expect(screen.getByTitle("Diese Quelle ist nicht in der geladenen Quellenliste enthalten.")).toBeInTheDocument();
    // cost is null: stated as missing, not 0
    expect(screen.queryByText(/0,00/)).toBeNull();
  });

  it("states unknown progress instead of inventing it", async () => {
    const fake = routedFetch(routes(project({ progress: { mode: "none", value: null }, status: "planning" })));
    renderWithProviders(<ResearchPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ research: { read: true } }) });
    expect((await screen.findAllByText("kein Fortschritt gemeldet")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("progressbar", { name: "Fortschritt" })).toBeNull();
  });

  it("opens the source drawer from an evidence chip, shows the excerpt and only links http(s) URLs", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<ResearchPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ research: { read: true } }) });
    await user.click(await screen.findByRole("button", { name: /buero-nord\.example/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Lieferzeit: 3 Wochen")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /Quelle im Browser öffnen/ })).toHaveAttribute("href", "https://buero-nord.example/preise");
    expect(within(dialog).getByText("Büro-Nord liefert am schnellsten")).toBeInTheDocument();
  });

  it("never renders a javascript: source URL as a link", async () => {
    params = new URLSearchParams(`project=${PROJECT_ID}`);
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<ResearchPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ research: { read: true } }) });
    await user.click(await screen.findByRole("tab", { name: /Quellen/ }));
    const grid = await screen.findByRole("grid", { name: "Quellen" });
    await user.click(within(grid).getByText("Angebot"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("link")).toBeNull();
  });

  it("exports Markdown and JSON when the capability is granted and keeps PDF/DOCX/PPTX at later", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<ResearchPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ research: { read: true, export: true } }) });
    await user.click(await screen.findByRole("tab", { name: "Export" }));
    const markdown = screen.getByRole("button", { name: "Markdown exportieren" });
    await waitFor(() => expect(markdown).toBeEnabled());
    await user.click(markdown);
    expect(saveText).toHaveBeenCalledTimes(1);
    expect(saveText.mock.calls[0]?.[1]).toBe("recherche-bueromoebel-anbieter.md");
    expect(String(saveText.mock.calls[0]?.[0])).toContain("Belege: [1]");
    await user.click(screen.getByRole("button", { name: "JSON exportieren" }));
    expect(saveText.mock.calls[1]?.[1]).toBe("recherche-bueromoebel-anbieter.json");
    for (const format of ["PDF", "DOCX", "PPTX"]) {
      expect(screen.getByRole("button", { name: new RegExp(format) })).toBeDisabled();
    }
    expect(screen.getAllByText("später")).toHaveLength(3);
  });

  it("disables the export without the capability", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<ResearchPage />, { fetchImpl: fake.fetch, capabilities: capabilitiesOf({ research: { read: true, export: false } }) });
    await user.click(await screen.findByRole("tab", { name: "Export" }));
    expect(screen.getByRole("button", { name: "Markdown exportieren" })).toBeDisabled();
    expect(screen.getAllByText(/Capability research\.export fehlt/).length).toBeGreaterThan(0);
  });

  it("renders the empty and offline states", async () => {
    const empty = routedFetch({ "GET /api/v1/research/projects": listOf([]) });
    const first = renderWithProviders(<ResearchPage />, { fetchImpl: empty.fetch, capabilities: capabilitiesOf({ research: { read: true } }) });
    expect(await screen.findByText("Noch keine Rechercheprojekte")).toBeInTheDocument();
    first.unmount();
    renderWithProviders(<ResearchPage />, { fetchImpl: routedFetch({}).fetch, capabilities: capabilitiesOf({ files: { read: true } }) });
    expect(await screen.findByText("Nicht verbunden")).toBeInTheDocument();
    expect(screen.getByText(/Für „Recherche“ ist kein Adapter konfiguriert/)).toBeInTheDocument();
  });
});
