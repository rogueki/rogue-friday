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

  it("parses dashboard refresh only within the settings schema bounds", () => {
    expect(parseSettingsContentMutationIntent("Set dashboard refresh to 30 seconds"))
      .toEqual({ kind: "settings.dashboard.refresh", value: 30 });
    expect(parseSettingsContentMutationIntent("Setze Aktualisierung auf 5 Sekunden"))
      .toEqual({ kind: "settings.dashboard.refresh", value: 5 });
    expect(parseSettingsContentMutationIntent("Set dashboard refresh to 3601 seconds")).toBeNull();
    expect(parseSettingsContentMutationIntent("Set dashboard refresh to 5.5 seconds")).toBeNull();
  });

  it("parses only explicit dashboard booleans and Content Studio enablement", () => {
    expect(parseSettingsContentMutationIntent("Set dashboard background grid to off"))
      .toEqual({ kind: "settings.dashboard.backgroundGrid", value: false });
    expect(parseSettingsContentMutationIntent("Set sound effects to on"))
      .toEqual({ kind: "settings.dashboard.soundEffects", value: true });
    expect(parseSettingsContentMutationIntent("Disable Content Studio"))
      .toEqual({ kind: "settings.dashboard.contentStudioEnabled", value: false });
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

  it("binds quoted Content Studio rename and description fields", () => {
    expect(parseSettingsContentMutationIntent('Rename idea "Q2 report" to "Quarterly report"'))
      .toEqual({ kind: "contentStudio.idea.rename", title: "Q2 report", newTitle: "Quarterly report" });
    expect(parseSettingsContentMutationIntent('Set description of idea "Quarterly report" to "Show recent audit events"'))
      .toEqual({ kind: "contentStudio.idea.description", title: "Quarterly report", description: "Show recent audit events" });
    expect(parseSettingsContentMutationIntent('Set description of idea "Quarterly report" to "Line one\nLine two"'))
      .toEqual({ kind: "contentStudio.idea.description", title: "Quarterly report", description: "Line one\nLine two" });
    expect(parseSettingsContentMutationIntent('Rename idea "Q2 report" to ""')).toBeNull();
  });

  it("accepts only a valid explicit date when scheduling an idea", () => {
    expect(parseSettingsContentMutationIntent('Schedule idea "Quarterly report" for 2026-10-22'))
      .toEqual({ kind: "contentStudio.posting.fromIdea", title: "Quarterly report", date: "2026-10-22" });
    expect(parseSettingsContentMutationIntent('Plane Idee "Quartalsbericht" für 2026-02-30')).toBeNull();
    expect(parseSettingsContentMutationIntent('Schedule idea "Quarterly report"')).toBeNull();
  });

  it("accepts only valid idea date, format, and target field values", () => {
    expect(parseSettingsContentMutationIntent('Set target date of idea "Quarterly report" to 2026-10-22'))
      .toEqual({ kind: "contentStudio.idea.date", title: "Quarterly report", date: "2026-10-22" });
    expect(parseSettingsContentMutationIntent('Set zieldatum von Idee "Quarterly report" auf "clear"'))
      .toEqual({ kind: "contentStudio.idea.date", title: "Quarterly report", date: "" });
    expect(parseSettingsContentMutationIntent('Set format of idea "Quarterly report" to "YouTube-Short"'))
      .toEqual({ kind: "contentStudio.idea.format", title: "Quarterly report", format: "YouTube-Short" });
    expect(parseSettingsContentMutationIntent('Set platforms of idea "Quarterly report" to "Instagram and Facebook"'))
      .toEqual({ kind: "contentStudio.idea.targets", title: "Quarterly report", targets: ["Instagram", "Facebook"] });
    expect(parseSettingsContentMutationIntent('Set format of idea "Quarterly report" to "whatever"')).toBeNull();
    expect(parseSettingsContentMutationIntent('Set platforms of idea "Quarterly report" to "Instagram, Instagram"')).toBeNull();
  });

  it("parses explicit manual posting details and status enum", () => {
    expect(parseSettingsContentMutationIntent('Schedule posting "Release note" for 2026-10-23 at 14:30 on instagram as "Story"'))
      .toEqual({ kind: "contentStudio.posting.create", title: "Release note", date: "2026-10-23", time: "14:30", platform: "Instagram", format: "Story" });
    expect(parseSettingsContentMutationIntent('Set status of posting "Release note" on 2026-10-23 at 14:30 to posted'))
      .toEqual({ kind: "contentStudio.posting.status", title: "Release note", date: "2026-10-23", time: "14:30", status: "gepostet" });
    expect(parseSettingsContentMutationIntent('Schedule posting "Release note" for 2026-10-23 at 25:30 on Instagram as "Story"')).toBeNull();
  });

  it("parses exact removal commands for ideas and scheduled postings", () => {
    expect(parseSettingsContentMutationIntent('Remove idea "Old campaign"'))
      .toEqual({ kind: "contentStudio.idea.remove", title: "Old campaign" });
    expect(parseSettingsContentMutationIntent('Entferne Posting "Release note" am 2026-10-23 um 14:30'))
      .toEqual({ kind: "contentStudio.posting.remove", title: "Release note", date: "2026-10-23", time: "14:30" });
    expect(parseSettingsContentMutationIntent('Remove posting "Release note" on 2026-02-30 at 14:30')).toBeNull();
  });

  it("maps plan import/export to explicit guided file-picker actions", () => {
    expect(parseSettingsContentMutationIntent("Export Content Studio plan")).toEqual({ kind: "contentStudio.plan.exportGuided" });
    expect(parseSettingsContentMutationIntent("Importiere den Redaktionsplan")).toEqual({ kind: "contentStudio.plan.importGuided" });
  });

  it("maps a selected idea pronoun to a typed status action that requires context", () => {
    expect(parseSettingsContentMutationIntent("Mark it as done")).toEqual({ kind: "contentStudio.idea.statusSelected", status: "fertig" });
    expect(parseSettingsContentMutationIntent("Set selected idea status to in progress")).toEqual({ kind: "contentStudio.idea.statusSelected", status: "in-arbeit" });
    expect(parseSettingsContentMutationIntent("Mark this idea done")).toEqual({ kind: "contentStudio.idea.statusSelected", status: "fertig" });
  });

  it("maps profile enum choices and rejects unsupported free-form values", () => {
    expect(parseSettingsContentMutationIntent("Set language to German")).toEqual({ kind: "settings.profile.locale", value: "de" });
    expect(parseSettingsContentMutationIntent("Set Datumsformat auf yyyy-MM-dd")).toEqual({ kind: "settings.profile.dateFormat", value: "yyyy-MM-dd" });
    expect(parseSettingsContentMutationIntent("Change time format to 12h")).toEqual({ kind: "settings.profile.timeFormat", value: "12h" });
    expect(parseSettingsContentMutationIntent("Set first day of the week to Sunday")).toEqual({ kind: "settings.profile.firstDayOfWeek", value: "sunday" });
    expect(parseSettingsContentMutationIntent("Set timezone to Europe/Paris")).toEqual({ kind: "settings.profile.timeZone", value: "Europe/Paris" });
    expect(parseSettingsContentMutationIntent('Set my display name to "Nina Test"')).toEqual({ kind: "settings.profile.displayName", value: "Nina Test" });
    expect(parseSettingsContentMutationIntent('Set assistant name to "Friday Assistant"')).toEqual({ kind: "settings.profile.assistantName", value: "Friday Assistant" });
    expect(parseSettingsContentMutationIntent(`Set assistant name to "${"x".repeat(41)}"`)).toBeNull();
    expect(parseSettingsContentMutationIntent("Set timezone to Mars/Phobos")).toBeNull();
    expect(parseSettingsContentMutationIntent("Set date format to dd/MM/yyyy")).toBeNull();
  });
});
