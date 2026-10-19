import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { StagedWriteConfirmHost } from "@/lib/api/stagedWrite";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { errorResponse, routedFetch, single } from "../memory/kit/testSupport";
import { LocalEventDialog } from "./LocalEventDialog";

vi.mock("@/lib/settings", () => ({ useAppSettings: () => ({ settings: undefined, isLoading: false, locale: "de", timeZone: "Europe/Berlin", hour12: false }) }));

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/calendar",
  useSearchParams: () => new URLSearchParams(),
}));

afterEach(() => setApiClient(null));

/** The staged-write answer of the Control API: 403 APPROVAL_REQUIRED with stage `preview` (P9 slice). */
const previewRequired = (previewText: string, previewId: string) => new Response(JSON.stringify({
  error: { code: "APPROVAL_REQUIRED", message: "Termin zuerst mit unveränderter Vorschau bestätigen.", severity: "warning",
    retryable: false, correlationId: previewId, details: { stage: "preview", previewId, previewText } },
}), { status: 403, headers: { "content-type": "application/json" } });

/** Staged route helper: the first call is only staged, the repeat with `X-Action-Preview-Id` executes. */
const stagedRoute = (previewText: string, previewId: string, done: () => unknown) => (_url: URL, request: Request): unknown =>
  request.headers.get("x-action-preview-id") === previewId ? single(done()) : previewRequired(previewText, previewId);

const EVENT = {
  id: "cal_0000000000000000000000evt1", title: "Planung",
  start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", timeZone: "Europe/Berlin", version: 3,
};

it("stages a create in the dashboard timezone and executes it only after the server preview is confirmed", async () => {
  const user = userEvent.setup();
  const fake = routedFetch({ "POST /api/v1/calendar/local/events": stagedRoute("Termin „Planung“ eintragen?", "corr_0000000000000000000000cr1", () => ({})) });
  const onOpenChange = vi.fn();
  renderWithProviders(<><LocalEventDialog open event={null} onOpenChange={onOpenChange} /><StagedWriteConfirmHost /></>, { fetchImpl: fake.fetch });
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Planung" } });
  fireEvent.change(screen.getByLabelText("Beginn"), { target: { value: "2026-11-02T10:00" } });
  fireEvent.change(screen.getByLabelText("Ende"), { target: { value: "2026-11-02T11:00" } });
  await user.click(screen.getByRole("button", { name: "Termin anlegen" }));
  await waitFor(() => expect(fake.to("POST", "/api/v1/calendar/local/events")).toHaveLength(1));
  const staged = fake.to("POST", "/api/v1/calendar/local/events")[0]!;
  expect(staged.body).toEqual({ title: "Planung", start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", timeZone: "Europe/Berlin" });
  expect(staged.headers.get("idempotency-key")).toBeTruthy();
  expect(staged.headers.get("x-action-preview-id")).toBeNull();
  const confirm = await screen.findByRole("alertdialog");
  expect(within(confirm).getByText("Termin „Planung“ eintragen?")).toBeInTheDocument();
  await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
  await waitFor(() => expect(fake.to("POST", "/api/v1/calendar/local/events")).toHaveLength(2));
  const executed = fake.to("POST", "/api/v1/calendar/local/events")[1]!;
  expect(executed.headers.get("x-action-preview-id")).toBe("corr_0000000000000000000000cr1");
  expect(executed.headers.get("idempotency-key")).toBe(staged.headers.get("idempotency-key"));
  expect(executed.body).toEqual(staged.body);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("stages an update with If-Match and confirms it unchanged", async () => {
  const user = userEvent.setup();
  const path = `PUT /api/v1/calendar/local/events/${EVENT.id}`;
  const fake = routedFetch({ [path]: stagedRoute("Termin „Planung“ aktualisieren?", "corr_0000000000000000000000up1", () => ({ ...EVENT, version: 4 })) });
  const onOpenChange = vi.fn();
  renderWithProviders(<><LocalEventDialog open event={EVENT as never} onOpenChange={onOpenChange} /><StagedWriteConfirmHost /></>, { fetchImpl: fake.fetch });
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Planung 2" } });
  await user.click(screen.getByRole("button", { name: "Änderung speichern" }));
  await waitFor(() => expect(fake.to("PUT", `/api/v1/calendar/local/events/${EVENT.id}`)).toHaveLength(1));
  const staged = fake.to("PUT", `/api/v1/calendar/local/events/${EVENT.id}`)[0]!;
  expect(staged.headers.get("if-match")).toBe("3");
  expect(staged.headers.get("x-action-preview-id")).toBeNull();
  const confirm = await screen.findByRole("alertdialog");
  await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
  await waitFor(() => expect(fake.to("PUT", `/api/v1/calendar/local/events/${EVENT.id}`)).toHaveLength(2));
  const executed = fake.to("PUT", `/api/v1/calendar/local/events/${EVENT.id}`)[1]!;
  expect(executed.headers.get("x-action-preview-id")).toBe("corr_0000000000000000000000up1");
  expect(executed.headers.get("if-match")).toBe("3");
  expect(executed.body).toEqual(staged.body);
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("deletes through the staged server preview instead of an inline confirmation", async () => {
  const user = userEvent.setup();
  const path = `DELETE /api/v1/calendar/local/events/${EVENT.id}`;
  const fake = routedFetch({ [path]: stagedRoute("Termin „Planung“ loeschen?", "corr_0000000000000000000000dl1", () => EVENT) });
  const onOpenChange = vi.fn();
  renderWithProviders(<><LocalEventDialog open event={EVENT as never} onOpenChange={onOpenChange} /><StagedWriteConfirmHost /></>, { fetchImpl: fake.fetch });
  expect(screen.queryByRole("button", { name: "Ja, Termin löschen" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Termin löschen" }));
  const confirm = await screen.findByRole("alertdialog");
  expect(within(confirm).getByText("Termin „Planung“ loeschen?")).toBeInTheDocument();
  await user.click(within(confirm).getByRole("button", { name: "Bestätigen" }));
  await waitFor(() => expect(fake.to("DELETE", `/api/v1/calendar/local/events/${EVENT.id}`)).toHaveLength(2));
  const [staged, executed] = fake.to("DELETE", `/api/v1/calendar/local/events/${EVENT.id}`);
  expect(staged!.headers.get("if-match")).toBe("3");
  expect(staged!.headers.get("x-action-preview-id")).toBeNull();
  expect(executed!.headers.get("x-action-preview-id")).toBe("corr_0000000000000000000000dl1");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("keeps the dialog open with the server message when validation fails before staging", async () => {
  const user = userEvent.setup();
  const fake = routedFetch({
    "POST /api/v1/calendar/local/events": () => errorResponse("VALIDATION_FAILED", "Das Ende muss nach dem Beginn liegen.", 422),
  });
  const onOpenChange = vi.fn();
  renderWithProviders(<><LocalEventDialog open event={null} onOpenChange={onOpenChange} /><StagedWriteConfirmHost /></>, { fetchImpl: fake.fetch });
  fireEvent.change(screen.getByLabelText("Titel"), { target: { value: "Planung" } });
  fireEvent.change(screen.getByLabelText("Beginn"), { target: { value: "2026-11-02T10:00" } });
  fireEvent.change(screen.getByLabelText("Ende"), { target: { value: "2026-11-02T11:00" } });
  await user.click(screen.getByRole("button", { name: "Termin anlegen" }));
  // The inline alert carries the failure; the toast region reuses the alert role, so match the text.
  expect(await screen.findByText("Der Termin konnte nicht gespeichert werden.")).toBeInTheDocument();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(fake.to("POST", "/api/v1/calendar/local/events")).toHaveLength(1);
});
