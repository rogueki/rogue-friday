import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { routedFetch, single } from "../memory/kit/testSupport";
import { LocalEventDialog } from "./LocalEventDialog";

vi.mock("@/lib/settings", () => ({ useAppSettings: () => ({ settings: undefined, isLoading: false, locale: "de", timeZone: "Europe/Berlin", hour12: false }) }));
afterEach(() => setApiClient(null));

it("creates a local event in the dashboard timezone", async () => {
  const user = userEvent.setup();
  const fake = routedFetch({ "POST /api/v1/calendar/local/events": single({}) });
  renderWithProviders(<LocalEventDialog open event={null} onOpenChange={() => {}} />, { fetchImpl: fake.fetch });
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Planung" } });
  fireEvent.change(screen.getByLabelText("Beginn"), { target: { value: "2026-11-02T10:00" } });
  fireEvent.change(screen.getByLabelText("Ende"), { target: { value: "2026-11-02T11:00" } });
  await user.click(screen.getByRole("button", { name: "Termin anlegen" }));
  await waitFor(() => expect(fake.to("POST", "/api/v1/calendar/local/events")).toHaveLength(1));
  const request = fake.to("POST", "/api/v1/calendar/local/events")[0]!;
  expect(request.body).toEqual({ title: "Planung", start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", timeZone: "Europe/Berlin" });
  expect(request.headers.get("idempotency-key")).toBeTruthy();
});
