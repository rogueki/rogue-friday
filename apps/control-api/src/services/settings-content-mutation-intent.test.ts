import { describe, expect, it } from "vitest";
import { parseSettingsContentMutationIntent } from "./settings-content-mutation-intent";

describe("settings and Content Studio mutation intents", () => {
  it.each([
    ["Set dashboard compact to on", true],
    ["Change compact mode to off", false],
    ["Stelle Dashboard kompakt auf ein", true],
    ["Aendere compact auf aus", false],
  ])("parses only an explicit compact setting value: %s", (text, value) => {
    expect(parseSettingsContentMutationIntent(text)).toEqual({ kind: "settings.dashboard.compact", value });
  });

  it("binds a free-text idea title only in the exact add-to-plan grammar", () => {
    expect(parseSettingsContentMutationIntent("Add idea Show recent audit events to Content Studio plan"))
      .toEqual({ kind: "contentStudio.idea.add", title: "Show recent audit events" });
    expect(parseSettingsContentMutationIntent("Add idea to plan" )).toBeNull();
    expect(parseSettingsContentMutationIntent(`Add idea ${"x".repeat(201)} to plan`)).toBeNull();
    expect(parseSettingsContentMutationIntent("Show Activity and turn compact off")).toBeNull();
    expect(parseSettingsContentMutationIntent("Set voice wakeword to private phrase")).toBeNull();
  });

  it("parses only explicit Content Studio status changes into an allowed enum", () => {
    expect(parseSettingsContentMutationIntent("Set status of idea Quarterly report to in progress"))
      .toEqual({ kind: "contentStudio.idea.status", title: "Quarterly report", status: "in-arbeit" });
    expect(parseSettingsContentMutationIntent("Setze Status von Idee Quartalsbericht auf Fertig"))
      .toEqual({ kind: "contentStudio.idea.status", title: "Quartalsbericht", status: "fertig" });
    expect(parseSettingsContentMutationIntent("Set idea Quarterly report to published")).toBeNull();
  });
});
