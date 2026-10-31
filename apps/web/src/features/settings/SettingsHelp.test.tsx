// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SETTINGS_AREAS } from "./settingsLogic";
import { SettingsHelp, settingsHelpFor } from "./SettingsHelp";

it("has help for every settings area", () => {
  for (const area of SETTINGS_AREAS) {
    expect(settingsHelpFor(area).length, area).toBeGreaterThan(0);
  }
});

it("explains the wake word in the voice area and links the conversation how-to", () => {
  const entries = settingsHelpFor("voice");
  expect(entries.some((entry) => entry.text.includes("Wake Word"))).toBe(true);
  expect(entries.some((entry) => entry.title === "Sprachbetrieb wechseln")).toBe(true);
});

it("renders each entry as a heading with its text", () => {
  const view = render(<SettingsHelp area="voice" id="help" />);
  const [first] = settingsHelpFor("voice");
  expect(screen.getByRole("heading", { name: first?.title })).not.toBeNull();
  expect(screen.getByRole("region", { name: "Hilfe" }).id).toBe("help");
  view.unmount();
});

it("renders nothing for an unknown area", () => {
  const view = render(<SettingsHelp area="toString" id="help" />);
  expect(view.container.innerHTML).toBe("");
  view.unmount();
});
