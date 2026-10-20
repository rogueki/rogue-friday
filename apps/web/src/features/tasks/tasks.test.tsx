import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateTaskDialog, useCreateTaskDialog } from "@/features/palette/CreateTaskDialog";
import { setApiClient } from "@/lib/api/client";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { decisionKind, isOverdue, progressPercent, showsIndeterminate } from "./model";
import { TaskBoard, COLUMN_PAGE_SIZE } from "./TaskBoard";
import { TasksPage } from "./TasksPage";
import { dataOf, listOf, makeAgentWith, makeTaskWith, routerFetch } from "./testkit";
import { TaskWriteConfirmHost } from "./taskWriteRunner";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/tasks",
  useSearchParams: () => nav.params,
}));

const FULL = capabilitiesOf({
  tasks: { read: true, create: true, update: true, cancel: true, retry: true, pause: true, resume: true },
  agents: { read: true },
  files: { read: true },
  audit: { read: true },
});
const READ_ONLY = capabilitiesOf({ tasks: { read: true, create: false, update: false, cancel: false, retry: false, pause: false, resume: false }, agents: { read: true } });

const ADAPTER_DOWN = {
  status: 503,
  body: { error: { code: "ADAPTER_UNAVAILABLE", message: "Der Adapter für Aufgaben ist derzeit nicht erreichbar.", severity: "error", retryable: true, correlationId: "corr_00000000000000000000000009", details: {} } },
};

/** The staged-write answer of the Control API: 403 APPROVAL_REQUIRED with stage `preview` (P9 slice). */
const previewRequired = (previewText: string, previewId: string) => ({
  status: 403,
  body: { error: { code: "APPROVAL_REQUIRED", message: "Diese Aktion muss zuerst bestätigt werden.", severity: "warning", retryable: false, correlationId: previewId, details: { stage: "preview", previewId, previewText } } },
});

/** Staged route helper: the first call is only staged, the repeat with `X-Action-Preview-Id` executes. */
const stagedRoute = (previewText: string, previewId: string, done: () => unknown) => (request: Request): unknown =>
  request.headers.get("x-action-preview-id") === previewId ? done() : previewRequired(previewText, previewId);

beforeEach(() => {
  nav.params = new URLSearchParams();
  nav.push.mockClear();
  nav.replace.mockClear();
});
afterEach(() => setApiClient(null));

describe("task model", () => {
  it("never turns unknown progress into a number", () => {
    const unknown = makeTaskWith({ progress: { mode: "indeterminate", value: null } });
    expect(progressPercent(unknown)).toBeNull();
    expect(showsIndeterminate(unknown)).toBe(true);
    expect(progressPercent(makeTaskWith({ progress: { mode: "determinate", value: 0.456 } }))).toBe(46);
    // a determinate mode without a value is unknown as well
    expect(progressPercent(makeTaskWith({ progress: { mode: "determinate", value: null } }))).toBeNull();
    expect(showsIndeterminate(makeTaskWith({ status: "todo", progress: { mode: "none", value: null } }))).toBe(false);
    expect(showsIndeterminate(makeTaskWith({ status: "running", progress: { mode: "none", value: null } }))).toBe(true);
  });

  it("classifies tasks that wait for a human decision", () => {
    expect(decisionKind(makeTaskWith({ status: "review" }))).toBe("review");
    expect(decisionKind(makeTaskWith({ status: "waiting", blockers: [{ id: "b", kind: "approval", description: "x" }] }))).toBe("approval");
    expect(decisionKind(makeTaskWith({ status: "waiting", blockers: [{ id: "b", kind: "input_needed", description: "x" }] }))).toBe("input");
    expect(decisionKind(makeTaskWith({ status: "done", blockers: [{ id: "b", kind: "approval", description: "x" }] }))).toBeNull();
    expect(decisionKind(makeTaskWith({ status: "running" }))).toBeNull();
  });

  it("marks only open tasks as overdue", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    expect(isOverdue({ status: "running", dueAt: "2026-10-14T08:00:00Z" }, now)).toBe(true);
    expect(isOverdue({ status: "done", dueAt: "2026-10-14T08:00:00Z" }, now)).toBe(false);
    expect(isOverdue({ status: "running", dueAt: null }, now)).toBe(false);
  });
});

describe("TaskBoard: drag and drop only with the update capability", () => {
  const tasks = [makeTaskWith({ title: "Analyse", status: "todo" }), makeTaskWith({ title: "Bericht", status: "review" })];

  it("is read-only without the capability: no draggable cards, no status select, a visible reason", () => {
    renderWithProviders(<TaskBoard tasks={tasks} canMove={false} lockedReason="Nur Lesezugriff" onOpen={vi.fn()} onMove={vi.fn()} />);
    for (const card of document.querySelectorAll(".tk-draggable")) expect(card).toHaveAttribute("data-draggable", "false");
    expect(screen.queryByRole("combobox", { name: /Status ändern/ })).toBeNull();
    expect(screen.getAllByText("Nur Lesezugriff").length).toBeGreaterThan(0);
  });

  it("moves by status select and by Shift+Pfeil when the capability is granted", async () => {
    const onMove = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<TaskBoard tasks={tasks} canMove onOpen={vi.fn()} onMove={onMove} />);
    for (const card of document.querySelectorAll(".tk-draggable")) expect(card).toHaveAttribute("data-draggable", "true");

    await user.selectOptions(screen.getByRole("combobox", { name: "Status ändern: Analyse" }), "running");
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ title: "Analyse" }), "running");

    const title = screen.getByRole("button", { name: "Analyse" });
    title.focus();
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(onMove).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Analyse" }), "ready");
    // the leftmost column cannot move further left
    onMove.mockClear();
    const first = makeTaskWith({ title: "Ganz links", status: "triage" });
    renderWithProviders(<TaskBoard tasks={[first]} canMove onOpen={vi.fn()} onMove={onMove} />);
    screen.getByRole("button", { name: "Ganz links" }).focus();
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(onMove).not.toHaveBeenCalled();
  });

  it("keeps history (failed, cancelled) visible and outside the drop columns", () => {
    const history = [makeTaskWith({ title: "Defekt", status: "failed" }), makeTaskWith({ title: "Verworfen", status: "cancelled" })];
    renderWithProviders(<TaskBoard tasks={history} canMove onOpen={vi.fn()} onMove={vi.fn()} />);
    const section = screen.getByRole("region", { name: /Verlauf/ });
    expect(within(section).getByText("Defekt")).toBeInTheDocument();
    expect(within(section).getByText("Verworfen")).toBeInTheDocument();
    expect(document.querySelectorAll(".tk-col")).toHaveLength(7);
  });

  it("renders a bounded number of cards for 1000 tasks and offers the rest per column", () => {
    const many = Array.from({ length: 1000 }, (_, index) => makeTaskWith({ title: `Aufgabe ${index}`, status: index % 2 === 0 ? "todo" : "running" }));
    renderWithProviders(<TaskBoard tasks={many} canMove onOpen={vi.fn()} onMove={vi.fn()} />);
    expect(document.querySelectorAll("[data-task-card]").length).toBe(2 * COLUMN_PAGE_SIZE);
    expect(screen.getAllByRole("button", { name: /weitere anzeigen/ })).toHaveLength(2);
  });
});

describe("TasksPage", () => {
  const agent = makeAgentWith({ name: "Coding-Agent" });
  const running = makeTaskWith({ title: "Wettbewerbsanalyse", status: "running", agentId: agent.id, agentName: agent.name });

  it("shows loading first and then the board with source and freshness", async () => {
    const api = routerFetch({ "GET /tasks": listOf([running]), "GET /agents": listOf([agent]) });
    renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: api.fetch });
    expect(screen.getAllByLabelText("Wird geladen …").length).toBeGreaterThan(0);
    expect(await screen.findByText("Wettbewerbsanalyse")).toBeInTheDocument();
    expect(screen.getAllByText("Aktuell").length).toBeGreaterThan(0);
    expect(screen.getAllByText("mock").length).toBeGreaterThan(0);
  });

  it("explains an unreachable adapter as offline state with a retry", async () => {
    const api = routerFetch({ "GET /tasks": () => ADAPTER_DOWN, "GET /agents": listOf([agent]) });
    renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: api.fetch });
    expect(await screen.findByText("Offline")).toBeInTheDocument();
    expect(screen.getByText(/Adapter für Aufgaben nicht erreichbar/)).toBeInTheDocument();
    expect(screen.getByText(/Der Adapter für Aufgaben ist derzeit nicht erreichbar\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeInTheDocument();
  });

  it("shows other failures as an error with the correlation id", async () => {
    const api = routerFetch({
      "GET /tasks": () => ({ status: 500, body: { error: { code: "INTERNAL", message: "Interner Fehler", severity: "error", retryable: false, correlationId: "corr_00000000000000000000000007", details: {} } } }),
      "GET /agents": listOf([agent]),
    });
    renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: api.fetch });
    expect(await screen.findByText("Daten konnten nicht geladen werden")).toBeInTheDocument();
    expect(screen.getByText("corr_00000000000000000000000007")).toBeInTheDocument();
  });

  it("shows the empty state of a new installation with the create action", async () => {
    const api = routerFetch({ "GET /tasks": listOf([]), "GET /agents": listOf([]) });
    renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: api.fetch });
    expect(await screen.findByText("Noch keine Aufgaben")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Neue Aufgabe" }).every((button) => !button.hasAttribute("disabled"))).toBe(true);
  });

  it("warns that stale data may be outdated", async () => {
    const api = routerFetch({ "GET /tasks": listOf([running], { freshness: "stale" }), "GET /agents": listOf([agent]) });
    renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: api.fetch });
    expect(await screen.findByText("Diese Daten sind möglicherweise nicht mehr aktuell.")).toBeInTheDocument();
    expect(screen.getAllByText("Veraltet").length).toBeGreaterThan(0);
  });

  it("is read-only without write capabilities: notice, disabled create with reason, no move controls", async () => {
    const api = routerFetch({ "GET /tasks": listOf([running]), "GET /agents": listOf([agent]) });
    renderWithProviders(<TasksPage />, { capabilities: READ_ONLY, fetchImpl: api.fetch });
    await screen.findByText("Wettbewerbsanalyse");
    expect(screen.getByText("Lesen verfügbar · Schreiben nicht verfügbar")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: /Neue Aufgabe/ });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute("title", expect.stringContaining("Nur Lesezugriff"));
    expect(screen.queryByRole("combobox", { name: /Status ändern/ })).toBeNull();
  });

  it("stages a card move with If-Match and executes it only after the server preview is confirmed", async () => {
    const api = routerFetch({
      "GET /tasks": listOf([running]),
      "GET /agents": listOf([agent]),
      "PATCH /tasks/:id": stagedRoute("Verschiebe „Wettbewerbsanalyse“ von „Laufend“ nach „Review“.", "corr_0000000000000000000000mv1", () => dataOf({ ...running, status: "review", version: 2 })),
    });
    const user = userEvent.setup();
    renderWithProviders(<><TasksPage /><TaskWriteConfirmHost /></>, { capabilities: FULL, fetchImpl: api.fetch });
    await screen.findByText("Wettbewerbsanalyse");
    await user.selectOptions(screen.getByRole("combobox", { name: "Status ändern: Wettbewerbsanalyse" }), "review");
    await waitFor(() => expect(api.callsTo("PATCH /tasks/:id")).toHaveLength(1));
    const staged = api.callsTo("PATCH /tasks/:id")[0]!;
    expect(staged.headers.get("if-match")).toBe("1");
    expect(staged.headers.get("x-action-preview-id")).toBeNull();
    expect(staged.body).toEqual({ status: "review" });
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Du bist dabei:")).toBeInTheDocument();
    expect(within(confirm).getByText("Verschiebe „Wettbewerbsanalyse“ von „Laufend“ nach „Review“.")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(api.callsTo("PATCH /tasks/:id")).toHaveLength(2));
    const executed = api.callsTo("PATCH /tasks/:id")[1]!;
    expect(executed.headers.get("x-action-preview-id")).toBe("corr_0000000000000000000000mv1");
    expect(executed.headers.get("if-match")).toBe("1");
    expect(executed.body).toEqual({ status: "review" });
    expect(await screen.findByText("Aufgabe verschoben")).toBeInTheDocument();
  });

  it("loads further pages by cursor", async () => {
    const second = makeTaskWith({ title: "Zweite Seite", status: "todo" });
    const api = routerFetch({
      "GET /tasks": (request: Request) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        return cursor === "c1" ? listOf([second], { totalCount: 2 }) : listOf([running], { nextCursor: "c1", totalCount: 2 });
      },
      "GET /agents": listOf([agent]),
    });
    const user = userEvent.setup();
    renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: api.fetch });
    await screen.findByText("Wettbewerbsanalyse");
    expect(screen.getByText("1 von 2 Aufgaben geladen")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mehr laden" }));
    expect(await screen.findByText("Zweite Seite")).toBeInTheDocument();
    expect(screen.getByText("Wettbewerbsanalyse")).toBeInTheDocument();
    expect(api.callsTo("GET /tasks").some((call) => call.query.get("cursor") === "c1")).toBe(true);
  });

  it("writes the view into the URL and renders the list view", async () => {
    nav.params = new URLSearchParams("view=list");
    const api = routerFetch({ "GET /tasks": listOf([running]), "GET /agents": listOf([agent]) });
    renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: api.fetch });
    expect(await screen.findByRole("grid", { name: "Aufgabenliste" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Timeline/ }));
    expect(nav.replace).toHaveBeenCalledWith("/tasks?view=timeline");
  });
});

describe("TaskDrawer", () => {
  const task = makeTaskWith({
    title: "Rechnung prüfen",
    status: "running",
    steps: [{ id: "s1", index: 0, title: "Beleg lesen", status: "done" }],
    errors: [{ code: "ADAPTER_TIMEOUT", message: "Zeitüberschreitung", severity: "warning", retryable: true, correlationId: "corr_00000000000000000000000005", details: {} }],
  });

  const routes = (extra: Parameters<typeof routerFetch>[0] = {}) =>
    routerFetch({ "GET /tasks": listOf([task]), "GET /agents": listOf([]), "GET /tasks/:id": dataOf(task), ...extra });

  it("opens from ?task= with all nine tabs and the capability-gated actions", async () => {
    nav.params = new URLSearchParams(`task=${task.id}`);
    const api = routes();
    renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: api.fetch });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("heading", { name: "Rechnung prüfen" })).toBeInTheDocument();
    expect(within(dialog).getAllByRole("tab").map((tab) => tab.textContent?.replace(/\d+$/, ""))).toEqual(["Übersicht", "Schritte", "Aktivität", "Tools", "Quellen", "Artefakte", "Freigaben", "Fehler", "Audit"]);
    // status running: pause and cancel allowed; resume, retry and approve-result are blocked by the status and say why
    expect(within(dialog).getByRole("button", { name: /Pausieren/ })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /Abbrechen/ })).toBeEnabled();
    const resume = within(dialog).getByRole("button", { name: /Fortsetzen/ });
    expect(resume).toBeDisabled();
    expect(resume).toHaveAttribute("title", "Im aktuellen Status der Aufgabe nicht möglich.");
  });

  it("disables actions the adapter does not support, with the reason", async () => {
    nav.params = new URLSearchParams(`task=${task.id}`);
    renderWithProviders(<TasksPage />, { capabilities: READ_ONLY, fetchImpl: routes().fetch });
    const dialog = await screen.findByRole("dialog");
    const cancel = await within(dialog).findByRole("button", { name: /Abbrechen/ });
    expect(cancel).toBeDisabled();
    expect(cancel).toHaveAttribute("title", expect.stringContaining("Nur Lesezugriff"));
    expect(within(dialog).getByRole("combobox", { name: "Agent zuweisen" })).toBeDisabled();
  });

  it("stages the cancel and executes it only after the server preview is confirmed", async () => {
    nav.params = new URLSearchParams(`task=${task.id}`);
    const api = routes({ "POST /tasks/:id/cancel": stagedRoute("Breche „Rechnung prüfen“ ab.", "corr_0000000000000000000000cn1", () => dataOf({ ...task, status: "cancelled", version: 2 })) });
    const user = userEvent.setup();
    renderWithProviders(<><TasksPage /><TaskWriteConfirmHost /></>, { capabilities: FULL, fetchImpl: api.fetch });
    const dialog = await screen.findByRole("dialog");
    await user.click(await within(dialog).findByRole("button", { name: /Abbrechen/ }));
    await waitFor(() => expect(api.callsTo("POST /tasks/:id/cancel")).toHaveLength(1));
    const staged = api.callsTo("POST /tasks/:id/cancel")[0]!;
    expect(staged.headers.get("if-match")).toBe("1");
    expect(staged.headers.get("x-action-preview-id")).toBeNull();
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Du bist dabei:")).toBeInTheDocument();
    expect(within(confirm).getByText("Breche „Rechnung prüfen“ ab.")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(api.callsTo("POST /tasks/:id/cancel")).toHaveLength(2));
    const executed = api.callsTo("POST /tasks/:id/cancel")[1]!;
    expect(executed.headers.get("x-action-preview-id")).toBe("corr_0000000000000000000000cn1");
    expect(executed.headers.get("if-match")).toBe("1");
    expect(await screen.findByText("Aufgabe abgebrochen")).toBeInTheDocument();
  });

  it("shows the steps tab and writes the selected tab into the URL", async () => {
    nav.params = new URLSearchParams(`task=${task.id}&tab=steps`);
    const user = userEvent.setup();
    renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Beleg lesen")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("tab", { name: /Fehler/ }));
    expect(nav.replace).toHaveBeenCalledWith(expect.stringContaining("tab=errors"));
  });

  it("lists errors with their correlation id and shows empty states for the other tabs", async () => {
    nav.params = new URLSearchParams(`task=${task.id}&tab=errors`);
    const { unmount } = renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Zeitüberschreitung")).toBeInTheDocument();
    expect(within(dialog).getByText("corr_00000000000000000000000005")).toBeInTheDocument();
    unmount();

    nav.params = new URLSearchParams(`task=${task.id}&tab=artifacts`);
    renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    expect(await screen.findByText("Noch keine Artefakte.")).toBeInTheDocument();
  });

  it("explains a task that does not exist", async () => {
    nav.params = new URLSearchParams("task=task_00000000000000000000000404");
    const api = routes({
      "GET /tasks/:id": () => ({ status: 404, body: { error: { code: "NOT_FOUND", message: "nicht gefunden", severity: "warning", retryable: false, correlationId: "corr_00000000000000000000000008", details: {} } } }),
    });
    renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: api.fetch });
    expect(await screen.findByText("Aufgabe nicht gefunden")).toBeInTheDocument();
  });
});

describe("task actions: retry, artifacts, create", () => {
  const failed = makeTaskWith({ title: "Update fehlgeschlagen", status: "failed", artifacts: [{ id: "art_1", name: "Bericht.pdf", kind: "report", fileId: "file_00000000000000000000000001" }, { id: "art_2", name: "Notizen", kind: "other" }], artifactCount: 2 });
  const routes = (extra: Parameters<typeof routerFetch>[0] = {}) =>
    routerFetch({ "GET /tasks": listOf([failed]), "GET /agents": listOf([]), "GET /tasks/:id": dataOf(failed), ...extra });

  it("retries a failed task and keeps the history entry", async () => {
    nav.params = new URLSearchParams(`task=${failed.id}`);
    const previewId = "corr_0000000000000000000000rt1";
    const api = routes({ "POST /tasks/:id/retry": stagedRoute(
      "Aufgabe „Update fehlgeschlagen“ erneut starten?", previewId,
      () => dataOf({ ...failed, status: "running", version: 2 })) });
    const user = userEvent.setup();
    renderWithProviders(<><TasksPage /><TaskWriteConfirmHost /></>, { capabilities: FULL, fetchImpl: api.fetch });
    const dialog = await screen.findByRole("dialog");
    const retry = await within(dialog).findByRole("button", { name: /Wiederholen/ });
    expect(retry).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: /Pausieren/ })).toBeDisabled();
    await user.click(retry);
    await waitFor(() => expect(api.callsTo("POST /tasks/:id/retry")).toHaveLength(1));
    expect(api.callsTo("POST /tasks/:id/retry")[0]?.headers.get("if-match")).toBe("1");
    expect(api.callsTo("POST /tasks/:id/retry")[0]?.headers.get("x-action-preview-id")).toBeNull();
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Aufgabe „Update fehlgeschlagen“ erneut starten?")).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(api.callsTo("POST /tasks/:id/retry")).toHaveLength(2));
    expect(api.callsTo("POST /tasks/:id/retry")[1]?.headers.get("x-action-preview-id")).toBe(previewId);
    expect(api.callsTo("POST /tasks/:id/retry")[1]?.headers.get("if-match")).toBe("1");
  });

  it("opens an artifact only with a file and the files capability", async () => {
    nav.params = new URLSearchParams(`task=${failed.id}&tab=artifacts`);
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    const dialog = await screen.findByRole("dialog");
    const buttons = await within(dialog).findAllByRole("button", { name: "Artefakt öffnen" });
    expect(buttons[0]).toBeEnabled();
    expect(buttons[1]).toBeDisabled();
    expect(buttons[1]).toHaveAttribute("title", "Für dieses Artefakt ist keine Datei hinterlegt.");
    await user.click(buttons[0]!);
    expect(nav.push).toHaveBeenCalledWith("/files?file=file_00000000000000000000000001");
    unmount();

    renderWithProviders(<TasksPage />, { capabilities: capabilitiesOf({ tasks: { read: true } }), fetchImpl: routes().fetch });
    const second = await screen.findByRole("dialog");
    const locked = await within(second).findAllByRole("button", { name: "Artefakt öffnen" });
    expect(locked[0]).toBeDisabled();
  });

  it("opens the create dialog from the button and from the quick command link ?new=1", async () => {
    const user = userEvent.setup();
    useCreateTaskDialog.setState({ open: false });
    const first = renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    await screen.findByText("Update fehlgeschlagen");
    await user.click(screen.getAllByRole("button", { name: /Neue Aufgabe/ })[0]!);
    expect(useCreateTaskDialog.getState().open).toBe(true);
    first.unmount();

    useCreateTaskDialog.setState({ open: false });
    nav.params = new URLSearchParams("new=1");
    renderWithProviders(<TasksPage />, { capabilities: FULL, fetchImpl: routes().fetch });
    await waitFor(() => expect(useCreateTaskDialog.getState().open).toBe(true));
    expect(nav.replace).toHaveBeenCalledWith("/tasks");
    useCreateTaskDialog.setState({ open: false });
  });

  it("discards a staged direct task-create preview through the task API before closing", async () => {
    const user = userEvent.setup();
    const previewId = "corr_00000000000000000000000031";
    let releaseCancel = (): void => {};
    const cancellationGate = new Promise<void>((resolve) => { releaseCancel = resolve; });
    const api = routerFetch({
      "POST /tasks": (request: Request, body: unknown) => {
        if (request.headers.get("x-action-preview-cancel") === "true") {
          return cancellationGate.then(() => ({ status: 204 }));
        }
        if (request.headers.get("x-action-preview-id") === previewId) return dataOf(makeTaskWith({ title: (body as { title: string }).title }));
        return previewRequired("Direkter Task-Entwurf", previewId);
      },
    });
    useCreateTaskDialog.setState({ open: true });
    renderWithProviders(<><CreateTaskDialog /><TaskWriteConfirmHost /></>, { capabilities: FULL, fetchImpl: api.fetch });

    await user.type(screen.getByRole("textbox", { name: "Titel der Aufgabe" }), "API Task verwerfen");
    await user.click(screen.getByRole("button", { name: "Aufgabe anlegen" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(api.callsTo("POST /tasks")).toHaveLength(1);
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Abbrechen" }));
    await waitFor(() => expect(api.callsTo("POST /tasks")).toHaveLength(2));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(api.callsTo("POST /tasks")[1]?.body).toEqual({ title: "API Task verwerfen", priority: "P2" });
    expect(api.callsTo("POST /tasks")[1]?.headers.get("x-action-preview-id")).toBe(previewId);
    expect(api.callsTo("POST /tasks")[1]?.headers.get("x-action-preview-cancel")).toBe("true");
    releaseCancel();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(api.callsTo("POST /tasks")).toHaveLength(2);
  });

  it("confirms a direct task-create preview with the unchanged request body", async () => {
    const user = userEvent.setup();
    const previewId = "corr_00000000000000000000000033";
    const api = routerFetch({
      "POST /tasks": (request: Request, body: unknown) => request.headers.get("x-action-preview-id") === previewId
        ? dataOf(makeTaskWith({ title: (body as { title: string }).title }))
        : previewRequired("Direkter Task-Entwurf", previewId),
    });
    useCreateTaskDialog.setState({ open: true });
    renderWithProviders(<><CreateTaskDialog /><TaskWriteConfirmHost /></>, { capabilities: FULL, fetchImpl: api.fetch });

    await user.type(screen.getByRole("textbox", { name: "Titel der Aufgabe" }), "API Task bestätigen");
    await user.click(screen.getByRole("button", { name: "Aufgabe anlegen" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(api.callsTo("POST /tasks")).toHaveLength(2));
    expect(api.callsTo("POST /tasks")[1]?.body).toEqual({ title: "API Task bestätigen", priority: "P2" });
    expect(api.callsTo("POST /tasks")[1]?.headers.get("x-action-preview-id")).toBe(previewId);
    expect(api.callsTo("POST /tasks")[1]?.headers.get("x-action-preview-cancel")).toBeNull();
    expect(await screen.findByText("Aufgabe angelegt")).toBeInTheDocument();
  });

  it("keeps the direct task-create preview open when backend discard fails", async () => {
    const user = userEvent.setup();
    const previewId = "corr_00000000000000000000000032";
    const api = routerFetch({
      "POST /tasks": (request: Request, body: unknown) => {
        if (request.headers.get("x-action-preview-cancel") === "true") {
          return { status: 409, body: { error: { code: "CONFLICT", message: "Draft nicht mehr offen.", severity: "warning", retryable: false,
            correlationId: previewId, details: {} } } };
        }
        if (request.headers.get("x-action-preview-id") === previewId) return dataOf(makeTaskWith({ title: (body as { title: string }).title }));
        return previewRequired("Direkter Task-Entwurf", previewId);
      },
    });
    useCreateTaskDialog.setState({ open: true });
    renderWithProviders(<><CreateTaskDialog /><TaskWriteConfirmHost /></>, { capabilities: FULL, fetchImpl: api.fetch });

    await user.type(screen.getByRole("textbox", { name: "Titel der Aufgabe" }), "API Task bleibt sichtbar");
    await user.click(screen.getByRole("button", { name: "Aufgabe anlegen" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Abbrechen" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(api.callsTo("POST /tasks")).toHaveLength(2);
  });
});

describe("assigning a task (agents.assignTask)", () => {
  const agent = makeAgentWith({ name: "Coding-Agent", status: "idle" });
  const task = makeTaskWith({ title: "Rechnung prüfen", status: "ready", agentId: null });
  const withAssign = capabilitiesOf({ tasks: { read: true, update: true }, agents: { read: true, assignTask: true } });
  const withoutAssign = capabilitiesOf({ tasks: { read: true, update: true }, agents: { read: true } });

  const open = async (capabilities: ReturnType<typeof capabilitiesOf>, extra: Parameters<typeof routerFetch>[0] = {}) => {
    nav.params = new URLSearchParams(`task=${task.id}`);
    const api = routerFetch({ "GET /tasks": listOf([task]), "GET /agents": listOf([agent]), "GET /tasks/:id": dataOf(task), ...extra });
    renderWithProviders(<><TasksPage /><TaskWriteConfirmHost /></>, { capabilities, fetchImpl: api.fetch });
    const dialog = await screen.findByRole("dialog");
    const select = await within(dialog).findByRole("combobox", { name: "Agent zuweisen" });
    await within(dialog).findByRole("option", { name: /Coding-Agent/ });
    return { api, dialog, select };
  };

  it("assigns via the staged POST /tasks/{id}/assign with If-Match instead of a PATCH", async () => {
    const user = userEvent.setup();
    const { api, select } = await open(withAssign, {
      "POST /tasks/:id/assign": stagedRoute("Aufgabe „Rechnung prüfen“ an Coding-Agent zuweisen?", "corr_0000000000000000000000as2",
        () => dataOf({ ...task, agentId: agent.id, agentName: agent.name, version: 2 })),
    });
    await user.selectOptions(select, agent.id);
    await waitFor(() => expect(api.callsTo("POST /tasks/:id/assign")).toHaveLength(1));
    const staged = api.callsTo("POST /tasks/:id/assign")[0]!;
    expect(staged.body).toEqual({ agentId: agent.id });
    expect(staged.headers.get("if-match")).toBe("1");
    expect(staged.headers.get("x-action-preview-id")).toBeNull();
    expect(api.callsTo("PATCH /tasks/:id")).toHaveLength(0);
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(api.callsTo("POST /tasks/:id/assign")).toHaveLength(2));
    expect(api.callsTo("POST /tasks/:id/assign")[1]?.headers.get("x-action-preview-id")).toBe("corr_0000000000000000000000as2");
    expect(await screen.findByText("Agent zugewiesen")).toBeInTheDocument();
  });

  it("releases the task with agentId null", async () => {
    const assigned = { ...task, agentId: agent.id, agentName: agent.name };
    nav.params = new URLSearchParams(`task=${task.id}`);
    const api = routerFetch({
      "GET /tasks": listOf([assigned]), "GET /agents": listOf([agent]), "GET /tasks/:id": dataOf(assigned),
      "POST /tasks/:id/assign": stagedRoute("Aufgabe „Rechnung prüfen“ freigeben (kein Agent)?", "corr_0000000000000000000000as3",
        () => dataOf({ ...task, version: 2 })),
    });
    const user = userEvent.setup();
    renderWithProviders(<><TasksPage /><TaskWriteConfirmHost /></>, { capabilities: withAssign, fetchImpl: api.fetch });
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(await within(dialog).findByRole("combobox", { name: "Agent zuweisen" }), "");
    await waitFor(() => expect(api.callsTo("POST /tasks/:id/assign")).toHaveLength(1));
    expect(api.callsTo("POST /tasks/:id/assign")[0]?.body).toEqual({ agentId: null });
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(api.callsTo("POST /tasks/:id/assign")).toHaveLength(2));
    expect(await screen.findByText("Zuweisung aufgehoben")).toBeInTheDocument();
  });

  it("falls back to a staged task update for adapters without the assign operation", async () => {
    const user = userEvent.setup();
    const { api, select } = await open(withoutAssign, {
      "PATCH /tasks/:id": stagedRoute("Weise „Rechnung prüfen“ dem Agenten „Coding-Agent“ zu.", "corr_0000000000000000000000as1", () => dataOf({ ...task, agentId: agent.id, agentName: agent.name, version: 2 })),
    });
    await user.selectOptions(select, agent.id);
    await waitFor(() => expect(api.callsTo("PATCH /tasks/:id")).toHaveLength(1));
    expect(api.callsTo("PATCH /tasks/:id")[0]?.body).toEqual({ agentId: agent.id });
    expect(api.callsTo("PATCH /tasks/:id")[0]?.headers.get("x-action-preview-id")).toBeNull();
    expect(api.callsTo("POST /tasks/:id/assign")).toHaveLength(0);
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
    await waitFor(() => expect(api.callsTo("PATCH /tasks/:id")).toHaveLength(2));
    expect(api.callsTo("PATCH /tasks/:id")[1]?.headers.get("x-action-preview-id")).toBe("corr_0000000000000000000000as1");
    expect(await screen.findByText("Agent zugewiesen")).toBeInTheDocument();
  });

  it("is disabled when neither operation is available", async () => {
    const { select } = await open(capabilitiesOf({ tasks: { read: true }, agents: { read: true } }));
    expect(select).toBeDisabled();
  });
});

describe("answering a task that waits for input (tasks.input)", () => {
  const agent = makeAgentWith({ name: "Rechercheagent" });
  const waiting = makeTaskWith({
    title: "Angebot einholen",
    status: "waiting",
    agentId: agent.id,
    agentName: agent.name,
    blockers: [{ id: "blk_input_1", kind: "input_needed", description: "Welches Budget gilt für das Angebot?", since: "2026-10-14T07:00:00Z" }],
  });
  const withInput = capabilitiesOf({ tasks: { read: true, update: true, input: true }, agents: { read: true } });

  const routes = (extra: Parameters<typeof routerFetch>[0] = {}) =>
    routerFetch({ "GET /tasks": listOf([waiting]), "GET /agents": listOf([agent]), "GET /tasks/:id": dataOf(waiting), ...extra });

  it("sends the answer to POST /tasks/{id}/input with the blocker id, If-Match and an idempotency key, without leaving the page", async () => {
    nav.params = new URLSearchParams("view=decisions");
    const api = routes({ "POST /tasks/:id/input": () => dataOf({ ...waiting, status: "running", blockers: [], version: 2 }) });
    const user = userEvent.setup();
    renderWithProviders(<TasksPage />, { capabilities: withInput, fetchImpl: api.fetch });
    expect(await screen.findByText("Welches Budget gilt für das Angebot?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Eingabe geben" }));
    const dialog = await screen.findByRole("dialog", { name: /Eingabe für/ });
    const send = within(dialog).getByRole("button", { name: "Eingabe senden" });
    expect(send).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Antwort"), "  Das Budget liegt bei 4.500 Euro.  ");
    expect(send).toBeEnabled();
    expect(api.callsTo("POST /tasks/:id/input")).toHaveLength(0);
    await user.click(send);
    await waitFor(() => expect(api.callsTo("POST /tasks/:id/input")).toHaveLength(1));
    const call = api.callsTo("POST /tasks/:id/input")[0]!;
    expect(call.body).toEqual({ input: "Das Budget liegt bei 4.500 Euro.", blockerId: "blk_input_1" });
    expect(call.headers.get("if-match")).toBe(String(waiting.version));
    expect(call.headers.get("idempotency-key")).toBeTruthy();
    expect(await screen.findByText("Eingabe gesendet")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Eingabe für/ })).toBeNull());
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("is disabled with the reason when the adapter does not offer it", async () => {
    nav.params = new URLSearchParams("view=decisions");
    renderWithProviders(<TasksPage />, { capabilities: capabilitiesOf({ tasks: { read: true, update: true }, agents: { read: true } }), fetchImpl: routes().fetch });
    const button = await screen.findByRole("button", { name: /Eingabe geben/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringContaining("Nur Lesezugriff"));
  });

  it("offers the same answer dialog next to the blocker in the task drawer", async () => {
    nav.params = new URLSearchParams(`task=${waiting.id}`);
    const user = userEvent.setup();
    renderWithProviders(<TasksPage />, { capabilities: withInput, fetchImpl: routes().fetch });
    const drawer = await screen.findByRole("dialog");
    await user.click(await within(drawer).findByRole("button", { name: "Eingabe geben" }));
    expect(await screen.findByRole("dialog", { name: /Eingabe für/ })).toBeInTheDocument();
  });

  it("keeps the dialog open when the server refuses the answer", async () => {
    nav.params = new URLSearchParams("view=decisions");
    const api = routes({ "POST /tasks/:id/input": () => ({ status: 409, body: { error: { code: "CONFLICT", message: "Die Aufgabe wartet auf keine Eingabe.", severity: "warning", retryable: false, correlationId: "corr_00000000000000000000000011", details: {} } } }) });
    const user = userEvent.setup();
    renderWithProviders(<TasksPage />, { capabilities: withInput, fetchImpl: api.fetch });
    await user.click(await screen.findByRole("button", { name: "Eingabe geben" }));
    const dialog = await screen.findByRole("dialog", { name: /Eingabe für/ });
    await user.type(within(dialog).getByLabelText("Antwort"), "Antwort");
    await user.click(within(dialog).getByRole("button", { name: "Eingabe senden" }));
    await waitFor(() => expect(api.callsTo("POST /tasks/:id/input")).toHaveLength(1));
    expect(screen.getByRole("dialog", { name: /Eingabe für/ })).toBeInTheDocument();
    expect(screen.queryByText("Eingabe gesendet")).toBeNull();
  });
});
