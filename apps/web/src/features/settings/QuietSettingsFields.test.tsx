// @vitest-environment jsdom
import type { NotificationSettings } from "@friday/sdk";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QuietSettingsFields } from "./QuietSettingsFields";

const { mockUpdate, mockTargets } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockTargets: { data: undefined as unknown },
}));

vi.mock("@/lib/api/domains/notifications", () => ({
  useMessengerTargets: () => mockTargets,
}));

vi.mock("@/i18n", async () => {
  const { de } = await import("@/i18n/de");
  return { useT: () => ({ t: (key: keyof typeof de) => de[key], locale: "de" }) };
});

const targets = {
  data: {
    items: [
      { id: "target-telegram", platform: "telegram", recipient: "@erik_brandt_test" },
      { id: "target-whatsapp", platform: "whatsapp", recipient: "erik-brandt-test" },
    ],
  },
};

const settings = (patch: Partial<NotificationSettings> = {}): NotificationSettings =>
  ({
    quietHours: {},
    ...patch,
  }) as unknown as NotificationSettings;

beforeEach(() => {
  mockUpdate.mockReset();
  mockTargets.data = targets;
});

it("zeigt Standardwerte bei fehlenden Feldern", () => {
  const view = render(<QuietSettingsFields value={settings()} readOnly={false} update={mockUpdate} />);
  expect(screen.getByLabelText("Stufe der Nachtruhe")).toHaveValue("silent");
  expect(screen.getByLabelText("Zusammenfassung nach der Nachtruhe")).toHaveValue("first_interaction");
  expect(screen.getByLabelText("Stufe für den befristeten Ruhemodus")).toHaveValue("silent");
  expect(screen.getByRole("switch", { name: "Rückfragen von Agenten" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "Ergebnisse von Aufträgen" })).not.toBeChecked();
  expect(screen.getByRole("switch", { name: "Freigaben" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "Termine" })).not.toBeChecked();
  view.unmount();
});

it("ergänzt Termine in der Reihenfolge der Enum", () => {
  const view = render(<QuietSettingsFields value={settings()} readOnly={false} update={mockUpdate} />);
  fireEvent.click(screen.getByRole("switch", { name: "Termine" }));
  expect(mockUpdate).toHaveBeenCalledWith({ importantClasses: ["agent_questions", "approvals", "appointments"] });
  view.unmount();
});

it("wählt einen Textempfänger und erlaubt Kein Textversand", () => {
  const view = render(<QuietSettingsFields value={settings()} readOnly={false} update={mockUpdate} />);
  fireEvent.change(screen.getByLabelText("Textempfänger"), { target: { value: "target-telegram" } });
  expect(mockUpdate).toHaveBeenLastCalledWith({ quietTextTargetId: "target-telegram" });
  fireEvent.change(screen.getByLabelText("Textempfänger"), { target: { value: "" } });
  expect(mockUpdate).toHaveBeenLastCalledWith({ quietTextTargetId: null });
  view.unmount();
});

it("deaktiviert die Auswahlfelder in der Nur-Lese-Ansicht", () => {
  const view = render(<QuietSettingsFields value={settings()} readOnly update={mockUpdate} />);
  expect(screen.getByLabelText("Stufe der Nachtruhe")).toBeDisabled();
  expect(screen.getByLabelText("Zusammenfassung nach der Nachtruhe")).toBeDisabled();
  expect(screen.getByLabelText("Stufe für den befristeten Ruhemodus")).toBeDisabled();
  expect(screen.getByLabelText("Textempfänger")).toBeDisabled();
  view.unmount();
});