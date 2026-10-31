import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakeApi, type FakeApiOptions } from "@/features/settings/testApi";
import { setApiClient } from "@/lib/api/client";
import { AppSettingsProvider } from "@/lib/settings";
import { capabilitiesOf, renderWithProviders } from "@/test/render";
import { push, resetRouter } from "../memory/kit/testRouter";
import { TourProvider, useTour } from "./DashboardTour";
import { emitNavigationRequest } from "./navigationRequests";
import tourSteps from "./tourSteps.generated.json";

vi.mock("next/navigation", async () => (await import("../memory/kit/testRouter")).navigationMock);

const titleOf = (knowledgeId: string): string => tourSteps.steps.find((step) => step.id === knowledgeId)?.title ?? "";
const speakCalls = (api: ReturnType<typeof createFakeApi>) => api.find("POST", "/voice/tour/speak");

function TourProbe() {
  const tour = useTour();
  return (
    <>
      <button type="button" onClick={() => tour.start()}>Tour starten</button>
      <output data-testid="tour-state">{tour.active ? "aktiv" : "inaktiv"}</output>
    </>
  );
}

function setup(options: FakeApiOptions = {}) {
  const api = createFakeApi({
    role: "owner",
    extra: ({ method, path }) =>
      method === "POST" && path === "/voice/tour/speak" ? Response.json({ contractVersion: "2.0.0", ok: true }) : undefined,
    ...options,
  });
  const view = renderWithProviders(
    <AppSettingsProvider enabled>
      <TourProvider>
        <TourProbe />
      </TourProvider>
    </AppSettingsProvider>,
    { fetchImpl: api.fetchImpl, capabilities: capabilitiesOf({ system: { read: true } }) },
  );
  return { api, ...view };
}

beforeEach(() => {
  resetRouter();
});
afterEach(() => {
  setApiClient(null);
  vi.unstubAllGlobals();
});

it("opens the first visible page, speaks its step and continues to the second page", async () => {
  const user = userEvent.setup();
  const { api } = setup();
  await user.click(screen.getByRole("button", { name: "Tour starten" }));

  expect(await screen.findByText(/^Schritt 1 von \d+$/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: titleOf("seiten#uebersicht") })).toBeInTheDocument();
  expect(push).toHaveBeenCalledWith("/");
  await waitFor(() => expect(speakCalls(api)).toHaveLength(1));
  expect(speakCalls(api)[0]?.body).toEqual({ area: "overview" });

  await user.click(screen.getByRole("button", { name: "Weiter" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/tasks"));
  await waitFor(() => expect(speakCalls(api)).toHaveLength(2));
  expect(speakCalls(api)[1]?.body).toEqual({ area: "tasks" });
});

it("posts nothing while Vorlesen is switched off", async () => {
  const user = userEvent.setup();
  const { api } = setup();
  await user.click(screen.getByRole("button", { name: "Tour starten" }));
  await screen.findByText(/^Schritt 1 von \d+$/);
  await waitFor(() => expect(speakCalls(api)).toHaveLength(1));

  await user.click(screen.getByRole("switch", { name: "Vorlesen" }));
  await user.click(screen.getByRole("button", { name: "Weiter" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/tasks"));
  expect(speakCalls(api)).toHaveLength(1);
});

it("opens a requested page without tour and starts the tour at a requested area", async () => {
  setup();
  // The owner session loads asynchronously; requests before that are ignored on purpose.
  await waitFor(() => {
    act(() => emitNavigationRequest({ area: "calendar", tour: false }));
    expect(push).toHaveBeenCalledWith("/calendar");
  });
  expect(screen.queryByRole("dialog")).toBeNull();

  act(() => emitNavigationRequest({ area: "settings", tour: true }));
  expect(await screen.findByRole("heading", { level: 2, name: titleOf("seiten#einstellungen") })).toBeInTheDocument();
});

it("shows the message of a busy voice service and keeps the card usable", async () => {
  const user = userEvent.setup();
  setup({
    extra: ({ method, path }) =>
      method === "POST" && path === "/voice/tour/speak"
        ? Response.json({ error: { code: "VOICE_BUSY", message: "Der Sprachdienst ist gerade belegt." } }, { status: 409 })
        : undefined,
  });
  await user.click(screen.getByRole("button", { name: "Tour starten" }));
  expect(await screen.findByText("Der Sprachdienst ist gerade belegt.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Weiter" }));
  expect(await screen.findByText(/^Schritt 2 von \d+$/)).toBeInTheDocument();
});

it("retries an explanation once when the voice is still speaking", async () => {
  const user = userEvent.setup();
  const { api } = setup({
    extra: ({ method, path }) =>
      method === "POST" && path === "/voice/tour/speak"
        ? Response.json({ error: { code: "CONFLICT", message: "F.R.I.D.A.Y. spricht gerade." } }, { status: 409 })
        : undefined,
  });
  await user.click(screen.getByRole("button", { name: "Tour starten" }));
  await waitFor(() => expect(speakCalls(api)).toHaveLength(1));
  expect(screen.queryByText("F.R.I.D.A.Y. spricht gerade.")).toBeNull();

  await waitFor(() => expect(speakCalls(api)).toHaveLength(2), { timeout: 6_000 });
  expect(speakCalls(api)[1]?.body).toEqual({ area: "overview" });
  expect(await screen.findByText("F.R.I.D.A.Y. spricht gerade.")).toBeInTheDocument();
  expect(speakCalls(api)).toHaveLength(2);
}, 10_000);
it("closes the card on Escape", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(screen.getByRole("button", { name: "Tour starten" }));
  const card = await screen.findByRole("dialog");
  fireEvent.keyDown(card, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByTestId("tour-state")).toHaveTextContent("inaktiv");
});
