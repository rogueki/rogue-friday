import { createSchemaValidator, type SchemaName } from "@friday/sdk";
import { describe, expect, it } from "vitest";
import { IdFactory } from "../src/core/ids";
import { buildWorldState, createContextFor, ID_EPOCH_MS } from "../src/seed/profiles";
import type { ProfileName, WorldState } from "../src/world/state";

const validator = createSchemaValidator();

const COLLECTIONS: [keyof WorldState, SchemaName][] = [
  ["tasks", "Task"],
  ["activity", "ActivityEvent"],
  ["memory", "Memory"],
  ["agents", "Agent"],
  ["approvals", "Approval"],
  ["channels", "Channel"],
  ["threads", "Thread"],
  ["messages", "Message"],
  ["drafts", "Draft"],
  ["calendarEvents", "CalendarEvent"],
  ["calendarConflicts", "CalendarConflict"],
  ["calendarBriefings", "CalendarBriefing"],
  ["calendarProposals", "CalendarProposal"],
  ["automations", "Automation"],
  ["automationRuns", "AutomationRun"],
  ["researchProjects", "ResearchProject"],
  ["researchSources", "ResearchSource"],
  ["researchFindings", "ResearchFinding"],
  ["researchArtifacts", "ResearchArtifact"],
  ["files", "FileItem"],
  ["notifications", "Notification"],
  ["audit", "AuditEvent"],
  ["commandHistory", "CommandHistoryEntry"],
  ["quickCommands", "QuickCommand"],
  ["themes", "Theme"],
  ["layouts", "Layout"],
];

function build(profile: ProfileName, seed = 42): WorldState {
  const ids = new IdFactory(seed, ID_EPOCH_MS);
  const ctx = createContextFor(seed, ids, Date.parse("2026-10-14T08:15:00.000Z"), profile);
  return buildWorldState(ctx, profile);
}

describe.each<ProfileName>(["default", "empty", "longGerman"])("seed profile %s", (profile) => {
  const state = build(profile);
  for (const [key, schema] of COLLECTIONS) {
    it(`${String(key)} validates against ${schema}`, () => {
      const items = state[key] as unknown[];
      const failures: string[] = [];
      for (const item of items) {
        const result = validator.validate(schema, item);
        if (!result.valid) failures.push(`${JSON.stringify(result.errors.slice(0, 3))} <- ${JSON.stringify(item).slice(0, 200)}`);
      }
      expect(failures.slice(0, 3)).toEqual([]);
    });
  }
  it("singletons validate", () => {
    const failures: string[] = [];
    const single: [string, unknown][] = [
      ["VoiceStatus", state.voice.status],
      ["VoiceMetrics", state.voice.metrics],
      ["SystemMetrics", state.system.metrics],
      ["Settings", state.settings],
      ["Capabilities", state.capabilities],
      ...state.voice.devices.map((x): [string, unknown] => ["VoiceDevice", x]),
      ...state.voice.profiles.map((x): [string, unknown] => ["VoiceProfile", x]),
      ...state.system.services.map((x): [string, unknown] => ["Service", x]),
      ...state.system.storage.map((x): [string, unknown] => ["StorageVolume", x]),
      ...state.system.models.map((x): [string, unknown] => ["ModelProvider", x]),
      ...state.adapters.map((x): [string, unknown] => ["AdapterManifest", x.manifest]),
    ];
    for (const [schema, item] of single) {
      const result = validator.validate(schema, item);
      if (!result.valid) failures.push(`${schema}: ${JSON.stringify(result.errors.slice(0, 3))}`);
    }
    expect(failures).toEqual([]);
  });
});
