import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { routedFetch, single } from "../memory/kit/testSupport";
import { CalDavCreateDialog } from "./CalDavCreateDialog";

// The dashboard zone is intentionally different from the browser's local zone.
vi.mock("@/lib/settings", () => ({ useAppSettings: () => ({ settings: undefined, isLoading: false, locale: "de", timeZone: "America/New_York", hour12: false }) }));
afterEach(() => setApiClient(null));

describe("CalDAV create dialog", () => {
  it("uses the dashboard zone, previews first, and confirms exactly the previewed event", async () => {
    const user = userEvent.setup();
    const preview = { title: "Planung", start: "2026-10-18T14:00:00.000Z", end: "2026-10-18T15:00:00.000Z", confirmationToken: `${Date.now() + 60_000}.` + "a".repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const fake = routedFetch({
      "POST /api/v1/calendar/caldav/preview": single(preview),
      "POST /api/v1/calendar/caldav/events": single({ state: "created", replayed: false }),
    });
    renderWithProviders(<CalDavCreateDialog open onOpenChange={() => {}} />, { fetchImpl: fake.fetch });
    fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Planung" } });
    fireEvent.change(screen.getByLabelText("Beginn"), { target: { value: "2026-10-18T10:00" } });
    fireEvent.change(screen.getByLabelText("Ende"), { target: { value: "2026-10-18T11:00" } });
    expect(screen.getByText(/America\/New_York/)).toBeInTheDocument();
    expect(fake.to("POST", "/api/v1/calendar/caldav/events")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Termin prüfen" }));
    await waitFor(() => expect(fake.to("POST", "/api/v1/calendar/caldav/preview")).toHaveLength(1));
    expect(fake.to("POST", "/api/v1/calendar/caldav/preview")[0]?.body).toEqual({ title: "Planung", start: preview.start, end: preview.end });
    expect(fake.to("POST", "/api/v1/calendar/caldav/events")).toHaveLength(0);
    expect(await screen.findByText(/18\.10\.2026, 10:00.*18\.10\.2026, 11:00/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Genau diesen Termin anlegen" }));
    await waitFor(() => expect(fake.to("POST", "/api/v1/calendar/caldav/events")).toHaveLength(1));
    const previewCall = fake.to("POST", "/api/v1/calendar/caldav/preview")[0]!;
    const createCall = fake.to("POST", "/api/v1/calendar/caldav/events")[0]!;
    expect(createCall.body).toEqual({ title: preview.title, start: preview.start, end: preview.end, confirmationToken: preview.confirmationToken });
    expect(createCall.headers.get("idempotency-key")).toBe(previewCall.headers.get("idempotency-key"));
    expect(await screen.findByRole("status")).toHaveTextContent("bestätigt");
  });
});
