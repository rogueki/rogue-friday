import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { SkillRegistryPanel } from "./SkillRegistryPanel";

const state: {
  query: string;
  diffName?: string | null;
  search: { isPending: boolean; isError: boolean; isFetching: boolean; error?: Error;
    data?: { data: { query: string; source: string; observedAt: string;
      results: Array<{ identifier: string; name: string; source: string; trustLevel: string; description: string }> } } };
  modified: { isPending: boolean; isError: boolean; data?: { data: { names: string[]; observedAt: string } } };
  diff: { isPending: boolean; isError: boolean; error?: Error;
    data?: { data: { action: string; name: string; text: string; bytes: number; truncated: boolean } } };
} = { query: "", search: { isPending: false, isError: false, isFetching: false },
  modified: { isPending: false, isError: false }, diff: { isPending: false, isError: false } };

vi.mock("@/lib/api/domains/skills", () => ({
  useSkillHubSearch: (query: string) => {
    state.query = query;
    return state.search;
  },
  useModifiedSkills: () => state.modified,
  useSkillDiff: (name: string | null) => { state.diffName = name; return state.diff; },
}));

beforeEach(() => {
  state.query = "";
  state.search = { isPending: false, isError: false, isFetching: false };
  state.modified = { isPending: false, isError: false };
  state.diff = { isPending: false, isError: false };
  state.diffName = null;
});

it("shows registry hits with source, trust and identifier and offers no install button", async () => {
  const user = userEvent.setup();
  state.search = { isPending: false, isError: false, isFetching: false, data: { data: { query: "calendar",
    source: "all", observedAt: "2026-10-23T03:00:00.000Z", results: [{
      identifier: "official/productivity/calendar-sync", name: "calendar-sync", source: "official",
      trustLevel: "builtin", description: "Sync calendars." }] } } };
  render(<SkillRegistryPanel />);
  await user.type(screen.getByLabelText("Suchbegriff"), "calendar");
  await user.click(screen.getByRole("button", { name: "Suchen" }));
  expect(state.query).toBe("calendar");
  expect(screen.getByText("calendar-sync")).toBeTruthy();
  expect(screen.getByText(/official · Trust builtin/)).toBeTruthy();
  expect(screen.getByText("official/productivity/calendar-sync")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  expect(screen.getByText(/DASH-10.07/)).toBeTruthy();
});

it("names a search without hits instead of leaving the panel empty", async () => {
  const user = userEvent.setup();
  state.search = { isPending: false, isError: false, isFetching: false,
    data: { data: { query: "gibtsnicht", source: "all", observedAt: "2026-10-23T03:00:00.000Z", results: [] } } };
  render(<SkillRegistryPanel />);
  await user.type(screen.getByLabelText("Suchbegriff"), "gibtsnicht");
  await user.click(screen.getByRole("button", { name: "Suchen" }));
  expect(screen.getByText(/Keine Treffer für/)).toBeTruthy();
});

it("warns about locally modified bundled skills that updates skip", () => {
  state.modified = { isPending: false, isError: false,
    data: { data: { names: ["google-workspace", "arxiv"], observedAt: "2026-10-23T03:00:00.000Z" } } };
  render(<SkillRegistryPanel />);
  expect(screen.getByText(/2 mitgelieferte Skills weichen lokal ab/)).toBeTruthy();
  expect(screen.getByText("google-workspace")).toBeTruthy();
  state.modified = { isPending: false, isError: false,
    data: { data: { names: [], observedAt: "2026-10-23T03:00:00.000Z" } } };
  render(<SkillRegistryPanel />);
  expect(screen.getAllByText(/Keine mitgelieferten Skills wurden lokal geändert/).length).toBeGreaterThan(0);
});

it("shows the CLI diff of a modified skill on demand and hides it again", async () => {
  const user = userEvent.setup();
  state.modified = { isPending: false, isError: false,
    data: { data: { names: ["arxiv"], observedAt: "2026-10-23T03:00:00.000Z" } } };
  state.diff = { isPending: false, isError: false, data: { data: { action: "diff", name: "arxiv",
    text: "--- a/arxiv/SKILL.md\n+++ b/arxiv/SKILL.md\n@@ -1 +1 @@\n-alt\n+neu", bytes: 64, truncated: false } } };
  render(<SkillRegistryPanel />);
  expect(screen.queryByLabelText("Diff f\u00fcr arxiv")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Diff anzeigen" }));
  expect(state.diffName).toBe("arxiv");
  expect(screen.getByLabelText("Diff f\u00fcr arxiv").textContent).toContain("+neu");
  expect(screen.getByText("64 Byte")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Diff schlie\u00dfen" }));
  expect(screen.queryByLabelText("Diff f\u00fcr arxiv")).toBeNull();
});

it("shows the CLI's own reason when it refuses a diff", async () => {
  const user = userEvent.setup();
  state.modified = { isPending: false, isError: false,
    data: { data: { names: ["arxiv"], observedAt: "2026-10-23T03:00:00.000Z" } } };
  state.diff = { isPending: false, isError: true,
    error: new Error("Die CLI hat den Bericht abgelehnt: Error: skill 'arxiv' is not tracked") };
  render(<SkillRegistryPanel />);
  await user.click(screen.getByRole("button", { name: "Diff anzeigen" }));
  expect(screen.getByRole("alert").textContent).toContain("is not tracked");
});
