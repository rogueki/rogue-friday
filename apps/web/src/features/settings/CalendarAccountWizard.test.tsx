import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { errorResponse, routedFetch, single } from "../memory/kit/testSupport";
import { CalendarAccountWizard } from "./CalendarAccountWizard";

afterEach(() => setApiClient(null));

const ACTIONS = "POST /api/v1/integrations/calendar/accounts/actions";
const LIST = "GET /api/v1/integrations/calendar/accounts";

const account = (patch: Record<string, unknown> = {}) => ({
  id: "cal-1", kind: "caldav", displayName: "Arbeit", baseUrl: "https://cal.example.test/", username: "alice",
  syncMinutes: 15, revision: 1, defaultCalendarId: null, calendars: [], secretState: { password: true }, ...patch,
});

const work = { id: "work", name: "Arbeit", color: null, timeZone: "Europe/Berlin", canRead: true, canWrite: true, selected: false };
const shared = { id: "shared", name: "Geteilt", color: null, timeZone: null, canRead: true, canWrite: false, selected: false };

function harness(options: { accounts?: unknown[]; discover?: unknown; existing?: boolean } = {}) {
  const paths: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = routedFetch({
    [LIST]: () => single({ revision: 1, defaultAccountId: options.existing ? "vorher" : null,
      accounts: options.existing ? [account({ id: "vorher", displayName: "Bestehend" })] : [] }),
    ...(options.discover ? {} : {}),
    [ACTIONS]: (_url: URL, request: Request, body?: unknown) => {
      const payload = (body ?? {}) as Record<string, unknown>;
      bodies.push(payload);
      if (payload.action === "discover" && options.discover) return options.discover as Response;
      const calendars = payload.action === "discover" ? [work, shared]
        : (bodies.at(-2)?.action === "discover" || bodies.some((entry) => entry.action === "discover")) && payload.action === "select" ? [work, shared] : [];
      if (payload.action === "write-test") return single({ ok: true, calendarId: "work", uid: "friday-selftest-abc", cleaned: true });
      return single(account({
        calendars: calendars as typeof work[],
        revision: 1 + bodies.length,
        defaultCalendarId: payload.action === "select" ? payload.defaultCalendarId ?? null : null,
        ...(payload.action === "upsert" ? { displayName: "Arbeit" } : {}),
      }));
    },
  });
  return { ...fetchImpl, paths, bodies };
}

function wrap(fetchImpl: ReturnType<typeof harness>) {
  const routes = fetchImpl;
  const original = routes.fetch;
  return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const method = input instanceof Request ? input.method : (init?.method ?? "GET");
    routes.paths.push(`${method} ${path}`);
    return original(input, init);
  }, to: routes.to, bodies: routes.bodies };
}

async function fillAccess(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText("Kontoname"), { target: { value: "Arbeit" } });
  fireEvent.change(screen.getByLabelText(/CalDAV-HTTPS-Adresse/), { target: { value: "https://cal.example.test/" } });
  fireEvent.change(screen.getByLabelText("Benutzername"), { target: { value: "alice" } });
  fireEvent.change(screen.getByLabelText(/Passwort oder App-Passwort/), { target: { value: "synthetisch" } });
  await user.click(screen.getByRole("button", { name: "Zugang speichern" }));
}

it("walks type, access, discovery, rights and defaults and only writes on apply", async () => {
  const user = userEvent.setup();
  const fake = harness();
  renderWithProviders(<CalendarAccountWizard />, { fetchImpl: wrap(fake).fetch });

  expect(screen.getByText("Schritt 1 von 6: Typ")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Weiter" }));
  await fillAccess(user);
  expect(await screen.findByText("Schritt 3 von 6: Kalender suchen")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Kalender suchen" }));
  expect(await screen.findByText(/2 Kalender gefunden/)).toBeInTheDocument();
  expect(screen.getByText("Schritt 4 von 6: Kalender & Rechte")).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Arbeit/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Geteilt/ })).toBeChecked();
  expect(screen.getByText(/lesbar · nur lesen/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Weiter" }));
  expect(screen.getByText("Schritt 5 von 6: Standard & Abgleich")).toBeInTheDocument();
  const target = screen.getByLabelText(/Standardkalender/);
  expect(within(target).getAllByRole("option").map((option) => option.textContent)).toEqual(["Kein Schreibziel (nur lesen)", "Arbeit"]);
  await user.selectOptions(target, "work");
  await user.click(screen.getByRole("button", { name: "Weiter" }));
  expect(screen.getByText("Schritt 6 von 6: Prüfen & übernehmen")).toBeInTheDocument();
  expect(fake.bodies.filter((body) => body.action === "select")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Kalender übernehmen" }));
  expect(await screen.findByText(/Kalenderkonto eingerichtet: 2 Kalender übernommen, Schreibziel Arbeit/)).toBeInTheDocument();
  const select = fake.bodies.find((body) => body.action === "select");
  expect(select).toMatchObject({ action: "select", selectedIds: ["work", "shared"], defaultCalendarId: "work" });
  expect(fake.bodies.filter((body) => body.action === "select")).toHaveLength(1);
});

it("keeps an ICS feed read-only without discovery, write target or write test", async () => {
  const user = userEvent.setup();
  const fake = harness();
  renderWithProviders(<CalendarAccountWizard />, { fetchImpl: wrap(fake).fetch });
  fireEvent.change(screen.getByLabelText("Typ"), { target: { value: "ics" } });
  await user.click(screen.getByRole("button", { name: "Weiter" }));
  fireEvent.change(screen.getByLabelText("Kontoname"), { target: { value: "Feed" } });
  fireEvent.change(screen.getByLabelText("Private HTTPS-ICS-URL"), { target: { value: "https://feed.example.test/private.ics" } });
  await user.click(screen.getByRole("button", { name: "Zugang speichern" }));
  expect(await screen.findByText("Schritt 5 von 6: Standard & Abgleich")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Kalender suchen" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Weiter" }));
  expect(screen.getByText(/ICS: nur lesen. Ein Schreibtest ist nicht möglich/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Schreibtest/ })).toBeNull();
  expect(fake.bodies.filter((body) => body.action === "discover")).toHaveLength(0);
});

it("runs the write test only on explicit click and reports the cleanup", async () => {
  const user = userEvent.setup();
  const fake = harness();
  renderWithProviders(<CalendarAccountWizard />, { fetchImpl: wrap(fake).fetch });
  await user.click(screen.getByRole("button", { name: "Weiter" }));
  await fillAccess(user);
  await user.click(await screen.findByRole("button", { name: "Kalender suchen" }));
  await user.click(await screen.findByRole("button", { name: "Weiter" }));
  await user.selectOptions(screen.getByLabelText(/Standardkalender/), "work");
  await user.click(screen.getByRole("button", { name: "Weiter" }));
  expect(fake.bodies.filter((body) => body.action === "write-test")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Schreibtest im Testkalender ausführen" }));
  expect(await screen.findByText(/Schreibtest bestätigt \(UID friday-selftest-abc\), danach aufgeräumt/)).toBeInTheDocument();
  expect(fake.bodies.filter((body) => body.action === "write-test")).toHaveLength(1);
  expect(fake.bodies.find((body) => body.action === "write-test")).toMatchObject({ calendarId: "work" });
});

it("keeps the previous account when discovery fails and removes the draft on abort", async () => {
  const user = userEvent.setup();
  const fake = harness({ existing: true, discover: errorResponse("VALIDATION_FAILED", "Kalender-Anmeldung oder Berechtigung abgelaufen.", 422) });
  renderWithProviders(<CalendarAccountWizard />, { fetchImpl: wrap(fake).fetch });
  await user.click(screen.getByRole("button", { name: "Weiter" }));
  await fillAccess(user);
  await user.click(await screen.findByRole("button", { name: "Kalender suchen" }));
  expect(await screen.findByText(/Kalender-Anmeldung oder Berechtigung abgelaufen|Kalender gespeichert/)).toBeInTheDocument();
  expect(screen.getByText("Schritt 3 von 6: Kalender suchen")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Einrichtung verwerfen" }));
  expect(await screen.findByText("Einrichtungsentwurf entfernt. Nichts wurde aktiviert.")).toBeInTheDocument();
  expect(fake.bodies.find((body) => body.action === "delete")).toMatchObject({ action: "delete" });
  expect(fake.bodies.filter((body) => body.action === "select")).toHaveLength(0);
});

it("states that nothing was stored when aborting before the access step", async () => {
  const user = userEvent.setup();
  const fake = harness();
  renderWithProviders(<CalendarAccountWizard />, { fetchImpl: wrap(fake).fetch });
  await user.click(screen.getByRole("button", { name: "Einrichtung verwerfen" }));
  expect(await screen.findByText("Einrichtung verworfen. Es wurde nichts gespeichert.")).toBeInTheDocument();
  expect(fake.bodies).toHaveLength(0);
  await waitFor(() => expect(screen.getByText("Schritt 1 von 6: Typ")).toBeInTheDocument());
});