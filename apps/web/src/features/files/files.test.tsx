import type { FileItem, FilePreview } from "@friday/sdk";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { errorBody, listOf, NOW, routedFetch, single, SOURCE } from "@/features/system/testSupport";
import { FilesPage } from "./FilesPage";
import { isSameOriginPath, PreviewContent } from "./FilePreview";
import { SafeMarkdown } from "./SafeMarkdown";
import { validateFileName } from "./RenameFileDialog";

const push = vi.fn();
const replace = vi.fn();
let params = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/files",
  useSearchParams: () => params,
}));

const saveBlob = vi.fn();
vi.mock("@/features/system/download", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/features/system/download")>()), saveBlob: (...args: unknown[]) => saveBlob(...args) }));

function file(partial: Partial<FileItem> = {}): FileItem {
  return {
    id: "file_01JAAAAAAAAAAAAAAAAAAAAAAA",
    version: 3,
    createdAt: NOW,
    updatedAt: NOW,
    source: SOURCE,
    name: "Bericht.md",
    mimeType: "text/markdown",
    sizeBytes: 2048,
    category: "reports",
    currentVersion: 2,
    versions: [
      { version: 1, createdAt: NOW, sizeBytes: 1000, createdBy: { type: "agent", id: "agent_1", name: "Recherche-Agent" } },
      { version: 2, createdAt: NOW, sizeBytes: 2048, createdBy: { type: "agent", id: "agent_1", name: "Recherche-Agent" } },
    ],
    createdBy: { type: "agent", id: "agent_1", name: "Recherche-Agent" },
    taskId: "task_01JAAAAAAAAAAAAAAAAAAAAAAA",
    location: "D:\\Friday\\Dateien\\Berichte",
    tags: ["büro"],
    previewKind: "markdown",
    lineage: [{ relation: "output_of", taskId: "task_01JAAAAAAAAAAAAAAAAAAAAAAA", description: "Ergebnis der Angebotsrecherche" }],
    checksum: null,
    ...partial,
  };
}

const preview = (partial: Partial<FilePreview> = {}): FilePreview => ({ fileId: "file_01JAAAAAAAAAAAAAAAAAAAAAAA", kind: "text", contentType: "text/plain", text: "Hallo", truncated: false, sandboxed: true, ...partial });

beforeEach(() => {
  params = new URLSearchParams();
  push.mockReset();
  replace.mockReset();
  saveBlob.mockReset();
});
afterEach(() => setApiClient(null));

describe("safe markdown", () => {
  it("never produces scripts, images, raw HTML or javascript links", () => {
    const evil = [
      "# Titel <script>alert(1)</script>",
      "",
      "<img src=x onerror=alert(1)> **fett** und [böse](javascript:alert(1)) sowie [gut](https://example.org/a).",
      "",
      "![bild](https://tracker.example/pixel.png)",
      "",
      "| A | B |",
      "|---|---|",
      "| <b>x</b> | 2 |",
    ].join("\n");
    const { container } = render(<SafeMarkdown source={evil} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://example.org/a");
    expect(links[0]).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("böse");
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("fett");
  });
});

describe("sandboxed preview (PLAN §37.4)", () => {
  it("renders HTML as inert source text, never as markup", () => {
    const { container } = renderWithProviders(<PreviewContent file={{ id: "file_1", name: "x.html" }} preview={preview({ kind: "html", text: "<h1>Hi</h1><script>alert(1)</script>" })} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("h1")).toBeNull();
    expect(screen.getByTestId("preview-html-source").textContent).toBe("<h1>Hi</h1><script>alert(1)</script>");
  });

  it("puts PDFs in an iframe with an empty sandbox (no allow-scripts, no allow-same-origin)", () => {
    const { container } = renderWithProviders(<PreviewContent file={{ id: "file_1", name: "x.pdf" }} preview={preview({ kind: "pdf", text: undefined, url: "/api/v1/files/file_1/download?version=1" })} />);
    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("sandbox")).not.toContain("allow-scripts");
  });

  it("refuses cross-origin and protocol-relative URLs", () => {
    expect(isSameOriginPath("/api/v1/files/x/download")).toBe(true);
    expect(isSameOriginPath("//evil.example/x")).toBe(false);
    expect(isSameOriginPath("https://evil.example/x")).toBe(false);
    expect(isSameOriginPath("javascript:alert(1)")).toBe(false);
    expect(isSameOriginPath("/\\evil.example")).toBe(false);
    const { container } = renderWithProviders(<PreviewContent file={{ id: "file_1", name: "x.png" }} preview={preview({ kind: "image", text: undefined, url: "https://evil.example/x.png" })} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("Vorschau blockiert")).toBeInTheDocument();
  });

  it("refuses a preview that the server did not flag as sandboxed", () => {
    const { container } = renderWithProviders(<PreviewContent file={{ id: "file_1", name: "x.txt" }} preview={preview({ sandboxed: false })} />);
    expect(container.querySelector("pre")).toBeNull();
    expect(screen.getByText("Vorschau blockiert")).toBeInTheDocument();
  });

  it("renders images as plain <img> for same-origin URLs and notes truncated text", () => {
    const { container, rerender } = renderWithProviders(<PreviewContent file={{ id: "file_1", name: "x.png" }} preview={preview({ kind: "image", text: undefined, url: "/api/v1/files/file_1/download" })} />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/api/v1/files/file_1/download");
    rerender(<PreviewContent file={{ id: "file_1", name: "x.txt" }} preview={preview({ truncated: true })} />);
    expect(screen.getByText(/Vorschau gekürzt/)).toBeInTheDocument();
  });
});

const caps = (files: Record<string, boolean>) => capabilitiesOf({ files: { read: true, preview: true, download: true, ...files } });

function filesRoutes(items: FileItem[], extra: Record<string, unknown> = {}) {
  return {
    "GET /api/v1/files": listOf(items),
    "GET /api/v1/files/file_01JAAAAAAAAAAAAAAAAAAAAAAA/preview": single(preview({ kind: "markdown", text: "# Überschrift\n\nInhalt <script>x</script>" })),
    ...extra,
  };
}

describe("files page", () => {
  it("renders the file card with the PLAN §37.2 fields and previews markdown sandboxed", async () => {
    params = new URLSearchParams("file=file_01JAAAAAAAAAAAAAAAAAAAAAAA");
    const fake = routedFetch(filesRoutes([file()]));
    const { container } = renderWithProviders(<FilesPage />, { fetchImpl: fake.fetch, capabilities: caps({ delete: true }) });
    const card = await screen.findByRole("button", { name: /Bericht\.md/, pressed: true });
    expect(within(card).getByText(/Version 2/)).toBeInTheDocument();
    expect(within(card).getByText(/Recherche-Agent/)).toBeInTheDocument();
    expect(within(card).getByText("D:\\Friday\\Dateien\\Berichte")).toBeInTheDocument();
    expect(within(card).getByText("#büro")).toBeInTheDocument();
    expect(await screen.findByTestId("preview-markdown")).toHaveTextContent("Überschrift");
    expect(container.querySelector("script")).toBeNull();
  });

  it("sends search and category filters to the API", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(filesRoutes([file()]));
    renderWithProviders(<FilesPage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    await screen.findByText("Bericht.md");
    await user.click(screen.getByRole("button", { name: "Berichte" }));
    await waitFor(() => expect(fake.calls.some((call) => call.search.includes("category=reports"))).toBe(true));
    await user.type(screen.getByRole("searchbox", { name: "Dateien durchsuchen" }), "Angebot");
    await waitFor(() => expect(fake.calls.some((call) => call.search.includes("q=Angebot"))).toBe(true), { timeout: 2000 });
  });

  it("hides delete without the capability and explains it", async () => {
    params = new URLSearchParams("file=file_01JAAAAAAAAAAAAAAAAAAAAAAA");
    const fake = routedFetch(filesRoutes([file()]));
    renderWithProviders(<FilesPage />, { fetchImpl: fake.fetch, capabilities: caps({ delete: false, download: false }) });
    await screen.findByTestId("preview-markdown");
    expect(screen.queryByRole("button", { name: /Löschen/ })).toBeNull();
    expect(screen.getByText("Löschen ist für diese Quelle nicht verfügbar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Herunterladen" })).toBeDisabled();
  });

  it("deletes only after confirmation and surfaces the approval that the server raises", async () => {
    params = new URLSearchParams("file=file_01JAAAAAAAAAAAAAAAAAAAAAAA");
    const user = userEvent.setup();
    const approval = { id: "appr_01JAAAAAAAAAAAAAAAAAAAAAAA" };
    const fake = routedFetch(
      filesRoutes([file()], {
        "DELETE /api/v1/files/file_01JAAAAAAAAAAAAAAAAAAAAAAA": () => new Response(JSON.stringify(single(approval)), { status: 202, headers: { "content-type": "application/json" } }),
      }),
    );
    renderWithProviders(<FilesPage />, { fetchImpl: fake.fetch, capabilities: caps({ delete: true }) });
    await user.click(await screen.findByRole("button", { name: /Löschen …/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(fake.calls.some((call) => call.method === "DELETE")).toBe(false);
    expect(within(dialog).getByText(/Freigabe angefordert|Freigabe wird angefordert|eine Freigabe angefordert/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Löschen anfordern" }));
    await waitFor(() => expect(fake.calls.some((call) => call.method === "DELETE")).toBe(true));
    const call = fake.calls.find((entry) => entry.method === "DELETE");
    expect(call?.headers.get("If-Match")).toBe("3");
    expect(call?.headers.get("Idempotency-Key")).toBeTruthy();
    expect(await screen.findByText("Freigabe angefordert")).toBeInTheDocument();
  });

  it("downloads the current file through the SDK", async () => {
    params = new URLSearchParams("file=file_01JAAAAAAAAAAAAAAAAAAAAAAA");
    const user = userEvent.setup();
    const fake = routedFetch(
      filesRoutes([file()], {
        "GET /api/v1/files/file_01JAAAAAAAAAAAAAAAAAAAAAAA/download": () => new Response("# inhalt", { status: 200, headers: { "content-type": "application/octet-stream" } }),
      }),
    );
    renderWithProviders(<FilesPage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    await user.click(await screen.findByRole("button", { name: "Herunterladen" }));
    await waitFor(() => expect(saveBlob).toHaveBeenCalled());
    expect(saveBlob.mock.calls[0]?.[1]).toBe("Bericht.md");
  });

  it("shows empty, filtered-empty and error states", async () => {
    const empty = routedFetch({ "GET /api/v1/files": listOf([]) });
    const first = renderWithProviders(<FilesPage />, { fetchImpl: empty.fetch, capabilities: caps({}) });
    expect(await screen.findByText("Noch keine Dateien")).toBeInTheDocument();
    first.unmount();
    const broken = routedFetch({ "GET /api/v1/files": () => new Response(JSON.stringify({ error: { code: "INTERNAL", message: "kaputt", severity: "error", retryable: false, correlationId: "corr_01JTESTTESTTESTTESTTESTTES", details: {} } }), { status: 500, headers: { "content-type": "application/json" } }) });
    renderWithProviders(<FilesPage />, { fetchImpl: broken.fetch, capabilities: caps({}) });
    expect(await screen.findByText("Daten konnten nicht geladen werden")).toBeInTheDocument();
  });

  it("lists versions with per-version download and lineage links", async () => {
    params = new URLSearchParams("file=file_01JAAAAAAAAAAAAAAAAAAAAAAA");
    const user = userEvent.setup();
    const fake = routedFetch(filesRoutes([file()]));
    renderWithProviders(<FilesPage />, { fetchImpl: fake.fetch, capabilities: caps({}) });
    await user.click(await screen.findByRole("tab", { name: /Versionen/ }));
    expect(await screen.findByRole("button", { name: "Version 1 herunterladen" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: /Herkunft/ }));
    await user.click(await screen.findByRole("button", { name: "Aufgabe öffnen", hidden: false }));
    expect(push).toHaveBeenCalledWith("/tasks?task=task_01JAAAAAAAAAAAAAAAAAAAAAAA");
  });
});

describe("rename (PLAN §37.3)", () => {
  const ID = "file_01JAAAAAAAAAAAAAAAAAAAAAAA";

  it("validates names like the contract", () => {
    expect(validateFileName("Bericht.md")).toBeNull();
    expect(validateFileName("   ")).toBe("empty");
    for (const bad of ["a/b.md", "a\\b.md", "x:y", "..", "ende.", "a*b", "tab\tname", "x".repeat(256)]) expect(validateFileName(bad), bad).toBe("invalid");
  });

  it("is disabled with the reason when the capability is missing", async () => {
    params = new URLSearchParams(`file=${ID}`);
    const fake = routedFetch(filesRoutes([file()]));
    renderWithProviders(<FilesPage />, { fetchImpl: fake.fetch, capabilities: caps({ rename: false }) });
    const button = await screen.findByRole("button", { name: "Umbenennen …" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Nicht verfügbar: Capability files.rename fehlt.");
  });

  it("renames with If-Match, refuses unchanged, invalid and duplicate names before any request, and confirms", async () => {
    params = new URLSearchParams(`file=${ID}`);
    const user = userEvent.setup();
    const other = file({ id: "file_01JBBBBBBBBBBBBBBBBBBBBBBB", name: "Angebot.md" });
    const fake = routedFetch(
      filesRoutes([file(), other], {
        [`PATCH /api/v1/files/${ID}`]: (_url: URL, request: Request) => {
          void request;
          return single(file({ name: "Bericht final.md", version: 4 }));
        },
      }),
    );
    renderWithProviders(<FilesPage />, { fetchImpl: fake.fetch, capabilities: caps({ rename: true }) });
    await user.click(await screen.findByRole("button", { name: "Umbenennen …" }));
    const dialog = await screen.findByRole("dialog", { name: /umbenennen/ });
    const field = within(dialog).getByRole("textbox", { name: "Neuer Name" });
    const confirm = within(dialog).getByRole("button", { name: "Umbenennen" });
    expect(field).toHaveValue("Bericht.md");
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByText("Der Name ist unverändert.")).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, "ordner/neu.md");
    expect(within(dialog).getByText(/darf nicht leer sein/)).toBeInTheDocument();
    expect(confirm).toBeDisabled();

    await user.clear(field);
    await user.type(field, "angebot.MD");
    expect(within(dialog).getByText("Im selben Ordner gibt es bereits eine Datei mit diesem Namen.")).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    expect(fake.calls.some((call) => call.method === "PATCH")).toBe(false);

    await user.clear(field);
    await user.type(field, "Bericht final.md");
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(fake.calls.some((call) => call.method === "PATCH")).toBe(true));
    const call = fake.calls.find((entry) => entry.method === "PATCH");
    expect(call?.headers.get("If-Match")).toBe("3");
    expect(JSON.parse(call?.body ?? "{}")).toEqual({ name: "Bericht final.md" });
    expect(await screen.findByText("Umbenannt in „Bericht final.md“")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /umbenennen/ })).toBeNull());
  });

  it("keeps the dialog open and shows the server message when the rename is refused", async () => {
    params = new URLSearchParams(`file=${ID}`);
    const user = userEvent.setup();
    const fake = routedFetch(filesRoutes([file()], { [`PATCH /api/v1/files/${ID}`]: () => errorBody("VALIDATION_FAILED", "Der Dateiname ist ungültig.", 422) }));
    renderWithProviders(<FilesPage />, { fetchImpl: fake.fetch, capabilities: caps({ rename: true }) });
    await user.click(await screen.findByRole("button", { name: "Umbenennen …" }));
    const dialog = await screen.findByRole("dialog", { name: /umbenennen/ });
    const field = within(dialog).getByRole("textbox", { name: "Neuer Name" });
    await user.clear(field);
    await user.type(field, "Neu.md");
    await user.click(within(dialog).getByRole("button", { name: "Umbenennen" }));
    expect(await within(dialog).findByText("Der Dateiname ist ungültig.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: /umbenennen/ })).toBeInTheDocument();
  });
});
