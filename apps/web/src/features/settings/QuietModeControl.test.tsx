// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QuietModeControl } from "./QuietModeControl";

const { mockSetMutation, mockClearMutation, mockQuietMode, mockQuietModeSummary } = vi.hoisted(() => ({
  mockSetMutation: { mutate: vi.fn(), isPending: false, error: null as Error | null },
  mockClearMutation: { mutate: vi.fn(), isPending: false, error: null as Error | null },
  mockQuietMode: { data: undefined as unknown },
  mockQuietModeSummary: { data: undefined as unknown },
}));

vi.mock("@/lib/api/domains/notifications", () => ({
  useQuietMode: () => mockQuietMode,
  useQuietModeSummary: () => mockQuietModeSummary,
  useSetQuietMode: () => mockSetMutation,
  useClearQuietMode: () => mockClearMutation,
}));

vi.mock("@/lib/settings", () => ({ useAppSettings: () => ({ timeZone: "Europe/Berlin" }) }));

vi.mock("@/i18n", async () => {
  const { de } = await import("@/i18n/de");
  return { useT: () => ({ t: (key: keyof typeof de) => de[key], locale: "de" }) };
});

/** `data` of GET /api/v1/quiet-mode with the given quiet-mode state. */
const quietMode = (patch: Record<string, unknown>) => ({
  data: { active: false, source: null, until: null, temporaryUntil: null, ...patch },
});

beforeEach(() => {
  mockSetMutation.mutate.mockReset();
  mockClearMutation.mutate.mockReset();
  mockSetMutation.isPending = false;
  mockClearMutation.isPending = false;
  mockSetMutation.error = null;
  mockClearMutation.error = null;
  mockQuietMode.data = undefined;
  mockQuietModeSummary.data = undefined;
});

it("startet den Ruhemodus mit der Standarddauer von 60 Minuten", () => {
  mockQuietMode.data = quietMode({});
  const view = render(<QuietModeControl readOnly={false} />);
  expect(screen.getByRole("status").textContent).toContain("sofort an");
  const before = Date.now();
  fireEvent.click(screen.getByRole("button", { name: "Ruhemodus starten" }));
  const until = (mockSetMutation.mutate.mock.calls[0]?.[0] as { until: string }).until;
  const expected = before + 60 * 60_000;
  expect(Math.abs(new Date(until).getTime() - expected)).toBeLessThan(5_000);
  view.unmount();
});

it("zeigt einen laufenden Ruhemodus und beendet ihn wieder", () => {
  mockQuietMode.data = quietMode({ active: true, source: "temporary", until: "2025-01-15T14:40:00.000Z", temporaryUntil: "2025-01-15T14:40:00.000Z" });
  const view = render(<QuietModeControl readOnly={false} />);
  const status = screen.getByRole("status").textContent ?? "";
  expect(status).toContain("Ruhemodus bis");
  expect(status).toContain("15:40");
  fireEvent.click(screen.getByRole("button", { name: "Ruhemodus beenden" }));
  expect(mockClearMutation.mutate).toHaveBeenCalledWith({});
  view.unmount();
});

it("nennt die Nachtruhe ohne Beenden-Schaltfläche", () => {
  mockQuietMode.data = quietMode({ active: true, source: "schedule", until: "2025-01-16T06:00:00.000Z", temporaryUntil: null });
  const view = render(<QuietModeControl readOnly={false} />);
  expect(screen.getByRole("status").textContent).toContain("Nachtruhe bis 07:00");
  expect(screen.queryByRole("button", { name: "Ruhemodus beenden" })).toBeNull();
  view.unmount();
});

it("zeigt in der Nur-Lese-Ansicht nur die Statuszeile", () => {
  mockQuietMode.data = quietMode({ active: true, source: "temporary", until: "2025-01-15T14:40:00.000Z", temporaryUntil: "2025-01-15T14:40:00.000Z" });
  const view = render(<QuietModeControl readOnly />);
  expect(screen.getByRole("status").textContent).toContain("Ruhemodus bis 15:40");
  expect(screen.queryByRole("button", { name: "Ruhemodus starten" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Ruhemodus beenden" })).toBeNull();
  view.unmount();
});

it("startet den Ruhemodus mit der gewählten Stufe Nur Stimme aus", () => {
  mockQuietMode.data = quietMode({});
  const view = render(<QuietModeControl readOnly={false} />);
  fireEvent.change(screen.getByLabelText("Stufe"), { target: { value: "voice_off" } });
  fireEvent.click(screen.getByRole("button", { name: "Ruhemodus starten" }));
  expect(mockSetMutation.mutate).toHaveBeenCalledWith(expect.objectContaining({ level: "voice_off" }));
  view.unmount();
});

it("listet während der Ruhe eingegangene Einträge mit Zustellung", () => {
  mockQuietMode.data = quietMode({ active: true, source: "temporary", until: "2025-01-15T14:40:00.000Z", temporaryUntil: "2025-01-15T14:40:00.000Z" });
  mockQuietModeSummary.data = {
    data: {
      active: true,
      periodStart: "2025-01-15T13:40:00.000Z",
      periodEnd: "2025-01-15T14:40:00.000Z",
      items: [{ class: "task_results", title: "Bericht", at: "2025-01-15T14:35:00.000Z", delivery: "sent" }],
    },
  };
  const view = render(<QuietModeControl readOnly={false} />);
  expect(screen.getByRole("heading", { name: "Während der Ruhe" })).toBeTruthy();
  expect(screen.getByText(/Bericht/)).toBeTruthy();
  expect(screen.getByText(/per Text gesendet/)).toBeTruthy();
  view.unmount();
});

it("zeigt ohne Einträge keine Überschrift Während der Ruhe", () => {
  mockQuietModeSummary.data = { data: { active: false, periodStart: null, periodEnd: null, items: [] } };
  const view = render(<QuietModeControl readOnly={false} />);
  expect(screen.queryByRole("heading", { name: "Während der Ruhe" })).toBeNull();
  view.unmount();
});
