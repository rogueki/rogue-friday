import type { AutomationRun } from "@jarvis/sdk";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import type { AutomationDto } from "@/lib/api/domains/automations";
import { renderWithProviders } from "@/test/render";
import { resetRouter } from "../memory/kit/testRouter";
import { errorResponse, FULL, listOf, modules, NOW, resource, routedFetch, single } from "../memory/kit/testSupport";
import { AutomationsPage } from "./AutomationsPage";
import { sampleFromConditions } from "./TestPanel";

vi.mock("next/navigation", async () => (await import("../memory/kit/testRouter")).navigationMock);

const A1 = "auto_01JAAAAAAAAAAAAAAAAAAAAAAA";
const A2 = "auto_01JBBBBBBBBBBBBBBBBBBBBBBB";
const A3 = "auto_01JCCCCCCCCCCCCCCCCCCCCCCC";

function automation(id: string, partial: Partial<AutomationDto> = {}): AutomationDto {
  return {
    ...resource(id, 3),
    name: "Wichtige Mail eskalieren",
    description: "Neue P1-Mail → Telegram, nach 10 Minuten Anruf.",
    enabled: true,
    paused: false,
    trigger: { type: "event", event: "jarvis.communication.thread_updated", description: "Neuer E-Mail-Thread mit Priorität P1" },
    conditions: [{ id: "cond_1", field: "thread.priority", operator: "eq", value: "P1", description: "Priorität ist P1" }],
    actions: [{ id: "act_1", type: "notify", channel: "telegram", requiresApproval: false, description: "Telegram senden" }],
    escalation: [{ afterSeconds: 600, channel: "phone", description: "Anruf nach 10 Minuten", stopOnAcknowledge: true }],
    nextRunAt: null,
    lastRunAt: NOW,
    lastSuccess: { at: NOW, runId: "run_01JAAAAAAAAAAAAAAAAAAAAAAA" },
    lastError: null,
    runCount: 23,
    ...partial,
  } as AutomationDto;
}

const mail = automation(A1);
const backup = automation(A2, { name: "Backup-Verifikation", description: "Täglich um 22:00.", trigger: { type: "schedule", schedule: "0 22 * * *", timeZone: "Europe/Berlin", description: "Täglich um 22:00 Uhr" }, conditions: [], nextRunAt: "2026-10-14T20:00:00Z", lastError: { at: NOW, message: "Prüfsumme weicht ab", runId: "run_01JBBBBBBBBBBBBBBBBBBBBBBB" } });
const idle = automation(A3, { name: "Rechnungseingang", enabled: false, description: "Derzeit deaktiviert." });

function run(partial: Partial<AutomationRun> = {}): AutomationRun {
  return {
    ...resource("run_01JAAAAAAAAAAAAAAAAAAAAAAA"),
    automationId: A1,
    automationVersion: 3,
    status: "succeeded",
    dryRun: false,
    triggeredAt: "2026-10-14T07:00:00Z",
    finishedAt: "2026-10-14T07:00:04Z",
    triggerReason: "Neuer P1-Thread eingetroffen",
    conditionsEvaluated: [{ conditionId: "cond_1", met: true, detail: "thread.priority = P1" }],
    actionsExecuted: [{ actionId: "act_1", status: "succeeded", executedAt: "2026-10-14T07:00:03Z", resultSummary: "Telegram gesendet" }],
    result: "Alle Aktionen erfolgreich ausgeführt.",
    correlationId: "corr_01JTESTTESTTESTTESTTESTTES",
    ...partial,
  };
}

const routes = (items: AutomationDto[] = [mail, backup, idle]) => ({
  "GET /api/v1/automations": listOf(items),
  [`GET /api/v1/automations/${A1}/runs`]: listOf([run(), run({ id: "run_01JBBBBBBBBBBBBBBBBBBBBBBB", status: "failed", triggeredAt: "2026-10-13T07:00:00Z", conditionsEvaluated: [{ conditionId: "cond_1", met: false, detail: "thread.priority = P3" }], actionsExecuted: [], result: "Bedingung nicht erfüllt." })]),
});

beforeEach(() => resetRouter("/automations"));
afterEach(() => setApiClient(null));

async function openFirst(user: ReturnType<typeof userEvent.setup>, name = "Wichtige Mail eskalieren"): Promise<HTMLElement> {
  await user.click(await screen.findByRole("button", { name: `Details zu ${name} öffnen` }));
  return await screen.findByRole("dialog");
}

describe("automations page: list", () => {
  it("shows state, trigger, last success/error and next run per automation", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const row = (await screen.findByText("Backup-Verifikation")).closest("li") as HTMLElement;
    expect(row).toHaveAttribute("data-state", "active");
    expect(within(row).getByText("Zeitplan: Täglich um 22:00 Uhr")).toBeInTheDocument();
    expect(within(row).getByText(/Erfolg:/)).toBeInTheDocument();
    expect(within(row).getByText(/Fehler:/)).toBeInTheDocument();
    expect(within(row).getByText(/Nächste: 14\.10\.2026/)).toBeInTheDocument();
    expect((screen.getByText("Rechnungseingang").closest("li") as HTMLElement)).toHaveAttribute("data-state", "inactive");
    expect(screen.getByText("2 aktiv")).toBeInTheDocument();
    expect(screen.getByText("1 inaktiv")).toBeInTheDocument();
  });

  it("shows empty, error and offline states", async () => {
    const empty = routedFetch({ ...routes([]) });
    const first = renderWithProviders(<AutomationsPage />, { fetchImpl: empty.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Noch keine Automationen")).toBeInTheDocument();
    first.unmount();
    const broken = routedFetch({ "GET /api/v1/automations": errorResponse("INTERNAL", "Kaputt", 500) });
    const second = renderWithProviders(<AutomationsPage />, { fetchImpl: broken.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Kaputt")).toBeInTheDocument();
    second.unmount();
    const offline = routedFetch({ "GET /api/v1/automations": errorResponse("ADAPTER_UNAVAILABLE", "Automations-Dienst offline", 503) });
    renderWithProviders(<AutomationsPage />, { fetchImpl: offline.fetch, capabilities: modules(FULL) });
    expect(await screen.findByText("Automations-Dienst offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Adapter konfigurieren/ })).toBeInTheDocument();
  });

  it("disables the switch and creation without the matching capabilities", async () => {
    const fake = routedFetch(routes());
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules({ automations: { read: true } }) });
    await screen.findByText("Backup-Verifikation");
    expect(screen.getByText("Lesen verfügbar")).toBeInTheDocument();
    for (const toggle of screen.getAllByRole("switch")) expect(toggle).toBeDisabled();
    expect(screen.getByRole("button", { name: "Neue Automation" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Alle pausieren" })).toBeDisabled();
  });

  it("disables an active automation with If-Match", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({ ...routes(), [`POST /api/v1/automations/${A1}/disable`]: () => single({ ...mail, enabled: false, version: 4 }) });
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await user.click(await screen.findByRole("switch", { name: "Wichtige Mail eskalieren ein- oder ausschalten" }));
    await waitFor(() => expect(fake.to("POST", `/api/v1/automations/${A1}/disable`)).toHaveLength(1));
    expect(fake.to("POST", `/api/v1/automations/${A1}/disable`)[0]?.headers.get("If-Match")).toBe("3");
  });
});

describe("automations page: Pause All", () => {
  it("needs confirmation and pauses every active automation with its own If-Match", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({
      ...routes(),
      [`PATCH /api/v1/automations/${A1}`]: () => single({ ...mail, paused: true, version: 4 }),
      [`PATCH /api/v1/automations/${A2}`]: () => single({ ...backup, paused: true, version: 4 }),
    });
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    await screen.findByText("Backup-Verifikation");
    await user.click(screen.getByRole("button", { name: "Alle pausieren" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/2 aktive Automationen anzuhalten/)).toBeInTheDocument();
    expect(within(confirm).getByText("Wichtige Mail eskalieren")).toBeInTheDocument();
    expect(fake.calls.filter((call) => call.method === "PATCH")).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Alle pausieren" }));
    await waitFor(() => expect(fake.calls.filter((call) => call.method === "PATCH")).toHaveLength(2));
    for (const call of fake.calls.filter((entry) => entry.method === "PATCH")) {
      expect(call.body).toEqual({ paused: true });
      expect(call.headers.get("If-Match")).toBe("3");
    }
  });

  it("offers 'Alle fortsetzen' when everything enabled is paused", async () => {
    const fake = routedFetch(routes([automation(A1, { paused: true }), idle]));
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    expect(await screen.findByRole("button", { name: "Alle fortsetzen" })).toBeEnabled();
    expect(screen.getAllByText(/1 Automation\(en\) pausiert/).length).toBeGreaterThan(0);
  });
});

describe("automations page: detail, runs and no black box", () => {
  it("shows the flow Trigger → Bedingungen → Aktionen → Eskalation", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const drawer = await openFirst(user);
    const flow = within(drawer).getByRole("list", { name: "Ablauf der Automation" });
    expect(within(flow).getByText("Neuer E-Mail-Thread mit Priorität P1")).toBeInTheDocument();
    expect(within(flow).getByText("Priorität ist P1")).toBeInTheDocument();
    expect(within(flow).getByText(/thread\.priority ist gleich P1/)).toBeInTheDocument();
    expect(within(flow).getByText("Telegram senden")).toBeInTheDocument();
    expect(within(flow).getByText(/Nach 10 Min\. → Telefon/)).toBeInTheDocument();
  });

  it("explains every run: why it fired, which conditions held, which actions ran, the result", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const drawer = await openFirst(user);
    await user.click(within(drawer).getByRole("tab", { name: /Läufe/ }));
    const heads = await within(drawer).findAllByRole("button", { expanded: false });
    const failed = heads.find((head) => head.textContent?.includes("Bedingung nicht erfüllt.")) as HTMLElement;
    await user.click(failed);
    expect(within(drawer).getByText("Warum ausgelöst")).toBeInTheDocument();
    expect(within(drawer).getByText("Neuer P1-Thread eingetroffen")).toBeInTheDocument();
    expect(within(drawer).getByText(/Priorität ist P1 · nicht erfüllt/)).toBeInTheDocument();
    expect(within(drawer).getByText("Keine Aktion ausgeführt.")).toBeInTheDocument();
    expect(within(drawer).getAllByText("Bedingung nicht erfüllt.").length).toBeGreaterThan(1);
  });

  it("runs a dry run with sample data and shows the simulated outcome without executing anything", async () => {
    const user = userEvent.setup();
    const dry = run({ id: "run_01JDDDDDDDDDDDDDDDDDDDDDDD", status: "dry_run", dryRun: true, actionsExecuted: [{ actionId: "act_1", status: "simulated", executedAt: NOW, resultSummary: "Würde Telegram senden" }], result: "Trockenlauf: 1 Aktion simuliert." });
    const fake = routedFetch({ ...routes(), [`POST /api/v1/automations/${A1}/test`]: () => single(dry) });
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const drawer = await openFirst(user);
    await user.click(within(drawer).getByRole("tab", { name: "Test" }));
    expect(within(drawer).getByText(/Es wird nichts wirklich ausgeführt/)).toBeInTheDocument();
    const sample = within(drawer).getByLabelText("Beispieldaten (JSON)") as HTMLTextAreaElement;
    expect(JSON.parse(sample.value)).toEqual({ thread: { priority: "P1" } });
    await user.click(within(drawer).getByRole("button", { name: "Trockenlauf starten" }));
    await waitFor(() => expect(fake.to("POST", `/api/v1/automations/${A1}/test`)).toHaveLength(1));
    expect(fake.to("POST", `/api/v1/automations/${A1}/test`)[0]?.body).toEqual({ dryRun: true, sampleData: { thread: { priority: "P1" } } });
    expect(await within(drawer).findByText("Würde Telegram senden")).toBeInTheDocument();
    expect(within(drawer).getByText("1 von 1 Aktionen simuliert.")).toBeInTheDocument();
    expect(within(drawer).getByText("Simuliert")).toBeInTheDocument();
  });

  it("rejects invalid sample JSON and respects the test capability", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const drawer = await openFirst(user);
    await user.click(within(drawer).getByRole("tab", { name: "Test" }));
    const sample = within(drawer).getByLabelText("Beispieldaten (JSON)");
    await user.clear(sample);
    await user.type(sample, "{{ kaputt");
    await user.click(within(drawer).getByRole("button", { name: "Trockenlauf starten" }));
    expect(within(drawer).getByText("Die Beispieldaten müssen ein gültiges JSON-Objekt sein.")).toBeInTheDocument();
    expect(fake.to("POST", `/api/v1/automations/${A1}/test`)).toHaveLength(0);
  });

  it("disables the dry run without the test capability", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules({ automations: { read: true } }) });
    const drawer = await openFirst(user);
    await user.click(within(drawer).getByRole("tab", { name: "Test" }));
    expect(within(drawer).getByRole("button", { name: "Trockenlauf starten" })).toBeDisabled();
    expect(within(drawer).getAllByText("Testen ist für diesen Adapter nicht verfügbar.").length).toBeGreaterThan(0);
  });

  it("shows version information", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const drawer = await openFirst(user);
    await user.click(within(drawer).getByRole("tab", { name: "Version" }));
    expect(within(drawer).getByText("v3", { selector: "dd" })).toBeInTheDocument();
    expect(await within(drawer).findByText("v3: 2")).toBeInTheDocument();
  });
});

describe("automation wizard", () => {
  async function openWizard(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await screen.findByText("Backup-Verifikation");
    await user.click(screen.getByRole("button", { name: "Neue Automation" }));
    return await screen.findByRole("dialog");
  }

  it("validates each step before moving on", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const dialog = await openWizard(user);
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    expect(within(dialog).getByText("Bitte einen Namen mit mindestens 3 Zeichen angeben.")).toBeInTheDocument();
    expect(within(dialog).getByText("Bitte ein Ereignis angeben.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Name/), "Mail melden");
    await user.type(within(dialog).getByLabelText(/^Ereignis/), "jarvis.communication.thread_updated");
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    expect(within(dialog).getByText(/Optional: Die Aktionen laufen nur/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    expect(within(dialog).getByText("Bitte mindestens eine Aktion hinzufügen.")).toBeInTheDocument();
  });

  it("rejects an invalid cron expression and a non-increasing escalation", async () => {
    const user = userEvent.setup();
    const fake = routedFetch(routes());
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const dialog = await openWizard(user);
    await user.type(within(dialog).getByLabelText(/^Name/), "Zeitplan");
    await user.selectOptions(within(dialog).getByLabelText("Art des Triggers"), "schedule");
    const cron = within(dialog).getByLabelText(/Cron-Ausdruck/);
    await user.clear(cron);
    await user.type(cron, "jeden Tag");
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    expect(within(dialog).getByText("Kein gültiger Cron-Ausdruck mit fünf Feldern.")).toBeInTheDocument();
    await user.clear(cron);
    await user.type(cron, "0 7 * * 1-5");
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    await user.click(within(dialog).getByRole("button", { name: "Aktion hinzufügen" }));
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    await user.click(within(dialog).getByRole("button", { name: "Eskalationsstufe hinzufügen" }));
    await user.click(within(dialog).getByRole("button", { name: "Eskalationsstufe hinzufügen" }));
    const minutes = within(dialog).getAllByLabelText("Nach (Minuten)");
    await user.clear(minutes[1] as HTMLElement);
    await user.type(minutes[1] as HTMLElement, "5");
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));
    expect(within(dialog).getByText("Die Zeit muss größer sein als die der vorigen Stufe.")).toBeInTheDocument();
  });

  it("walks Trigger → Bedingungen → Aktionen → Eskalation → Prüfen and creates the automation", async () => {
    const user = userEvent.setup();
    const created = automation("auto_01JEEEEEEEEEEEEEEEEEEEEEEE", { name: "Mail melden", version: 1 });
    const fake = routedFetch({ ...routes(), "POST /api/v1/automations": () => single(created) });
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const dialog = await openWizard(user);
    await user.type(within(dialog).getByLabelText(/^Name/), "Mail melden");
    await user.type(within(dialog).getByLabelText(/^Ereignis/), "jarvis.communication.thread_updated");
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));

    await user.click(within(dialog).getByRole("button", { name: "Bedingung hinzufügen" }));
    await user.type(within(dialog).getByLabelText("Feld"), "thread.priority");
    await user.type(within(dialog).getByLabelText("Wert"), "P1");
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));

    await user.click(within(dialog).getByRole("button", { name: "Aktion hinzufügen" }));
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));

    await user.click(within(dialog).getByRole("button", { name: "Eskalationsstufe hinzufügen" }));
    await user.click(within(dialog).getByRole("button", { name: "Weiter" }));

    expect(within(dialog).getByText("Jede Änderung erzeugt eine neue Version")).toBeInTheDocument();
    expect(within(dialog).getByText(/thread\.priority ist gleich P1/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Automation anlegen" }));
    await waitFor(() => expect(fake.to("POST", "/api/v1/automations")).toHaveLength(1));
    const call = fake.to("POST", "/api/v1/automations")[0];
    expect(call?.headers.get("Idempotency-Key")).toBeTruthy();
    expect(call?.body).toMatchObject({
      name: "Mail melden",
      enabled: true,
      trigger: { type: "event", event: "jarvis.communication.thread_updated" },
      conditions: [{ id: "cond_1", field: "thread.priority", operator: "eq", value: "P1" }],
      actions: [{ id: "act_1", type: "notify", channel: "dashboard", requiresApproval: false }],
      escalation: [{ afterSeconds: 600, channel: "telegram", stopOnAcknowledge: true }],
    });
  });

  it("edits an existing automation with If-Match and bumps nothing locally", async () => {
    const user = userEvent.setup();
    const fake = routedFetch({ ...routes(), [`PATCH /api/v1/automations/${A1}`]: () => single({ ...mail, name: "Mail sofort melden", version: 4 }) });
    renderWithProviders(<AutomationsPage />, { fetchImpl: fake.fetch, capabilities: modules(FULL) });
    const drawer = await openFirst(user);
    await user.click(within(drawer).getByRole("button", { name: "Bearbeiten" }));
    const dialog = (await screen.findAllByRole("dialog")).at(-1) as HTMLElement;
    const name = within(dialog).getByLabelText(/^Name/);
    await user.clear(name);
    await user.type(name, "Mail sofort melden");
    await user.click(within(dialog).getByRole("button", { name: /Prüfen/ }));
    await user.click(within(dialog).getByRole("button", { name: "Änderungen speichern" }));
    await waitFor(() => expect(fake.to("PATCH", `/api/v1/automations/${A1}`)).toHaveLength(1));
    const call = fake.to("PATCH", `/api/v1/automations/${A1}`)[0];
    expect(call?.headers.get("If-Match")).toBe("3");
    expect(call?.body).toMatchObject({ name: "Mail sofort melden", trigger: { type: "event" } });
  });
});

describe("sample data derivation", () => {
  it("turns equality conditions into nested mock data", () => {
    expect(
      sampleFromConditions({
        conditions: [
          { id: "c1", field: "thread.priority", operator: "eq", value: "P1", description: "" },
          { id: "c2", field: "thread.meta.kind", operator: "in", value: ["a", "b"] as never, description: "" },
          { id: "c3", field: "score", operator: "gt", value: 5 as never, description: "" },
        ],
      }),
    ).toEqual({ thread: { priority: "P1", meta: { kind: "a" } } });
  });
});
