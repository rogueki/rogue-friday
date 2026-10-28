import type { SkillCatalogEntry } from "@friday/sdk";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SkillAccountWorkbench } from "./SkillAccountWorkbench";

const detail = (id: string, options: { required?: boolean; configured?: boolean | null } = {}) => ({
  id,
  account: "required" as const,
  required: options.required ?? true,
  setupDe: `Setup für ${id}`,
  reference: "",
  settingsTarget: "Hermes-Einstellungen in Friday",
  configured: options.configured === undefined ? false : options.configured,
  connectionChecked: null,
});

const skill = (overrides: Partial<SkillCatalogEntry> & { id: string; name: string }): SkillCatalogEntry => ({
  source: "friday",
  origin: "friday",
  trust: "unknown",
  category: "office",
  description: "Beschreibung",
  version: null,
  packaged: true,
  discovered: true,
  enabled: true,
  observedAt: null,
  observationSource: "friday",
  observationError: null,
  accounts: [],
  setupRefs: [],
  integrationRefs: [],
  requiredCapabilities: [],
  conditionalCapabilities: [],
  integrationDetails: [],
  ...overrides,
});

const skills: SkillCatalogEntry[] = [
  skill({ id: "kalender", name: "Kalender", integrationDetails: [detail("caldav", { configured: true }), detail("gmx", { configured: false })] }),
  skill({ id: "termine", name: "Termine", integrationDetails: [detail("caldav", { configured: true })] }),
  skill({ id: "gif", name: "GIF Suche", source: "hermes", category: "media", integrationDetails: [detail("tenor", { configured: true })] }),
];

describe("skill account workbench", () => {
  it("lists skills with source and state and shows only the selected skill's accounts", async () => {
    render(<SkillAccountWorkbench skills={skills} role="owner" />);
    const list = screen.getByRole("list", { name: "Skills mit Kontenbedarf" });
    expect(within(list).getAllByRole("button")).toHaveLength(3);
    expect(within(list).getByText("GIF Suche")).toBeDefined();
    expect(within(list).getByText("Hermes")).toBeDefined();
    expect(within(list).getByText(/Pflichtkonto fehlt/)).toBeDefined();

    // Vor der Auswahl steht rechts nur der Hinweis, keine fremden Konten.
    expect(screen.getByText(/Wähle links einen Skill/)).toBeDefined();
    expect(screen.queryByText(/Setup für tenor/)).toBeNull();

    await userEvent.click(within(list).getByRole("button", { name: /GIF Suche/ }));
    expect(screen.getByText(/Setup für tenor/)).toBeDefined();
    expect(screen.queryByText(/Setup für caldav/)).toBeNull();
    expect(screen.getByText(/Einrichtungsort: Hermes-Einstellungen in Friday/)).toBeDefined();
  });

  it("marks a credential that another skill needs as shared instead of asking for it twice", async () => {
    render(<SkillAccountWorkbench skills={skills} role="owner" selectedId="kalender" />);
    expect(screen.getByText(/Geteilt mit Termine/)).toBeDefined();
    expect(screen.getByText(/nicht erneut abgefragt/)).toBeDefined();
    // Kein Eingabefeld fuer den geteilten Schluessel in der Detailansicht.
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByLabelText(/caldav/i)).toBeNull();
  });

  it("filters by text and state and offers a way back when nothing matches", async () => {
    render(<SkillAccountWorkbench skills={skills} role="owner" />);
    const search = screen.getByLabelText(/Skill suchen/);
    await userEvent.type(search, "hermes");
    expect(screen.getByRole("status", { name: "" })).toBeDefined();
    expect(screen.getAllByText(/1 von 3 Skills/).length).toBeGreaterThan(0);
    const filtered = screen.getByRole("list", { name: "Skills mit Kontenbedarf" });
    expect(within(filtered).getAllByRole("button")).toHaveLength(1);

    await userEvent.clear(search);
    fireEvent.change(screen.getByLabelText("Zustand"), { target: { value: "unvollstaendig" } });
    expect(within(screen.getByRole("list", { name: "Skills mit Kontenbedarf" })).getAllByRole("button")).toHaveLength(1);

    await userEvent.type(search, "gibtesnicht");
    expect(screen.getByText(/Kein Skill passt zur Suche/)).toBeDefined();
  });

  it("is operable by keyboard: arrow keys change the selection without leaving the list", async () => {
    const onSelect = vi.fn();
    render(<SkillAccountWorkbench skills={skills} role="owner" onSelect={onSelect} />);
    const list = screen.getByRole("list", { name: "Skills mit Kontenbedarf" });
    const first = within(list).getAllByRole("button")[0]!;
    first.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    const selectedAfterEnter = onSelect.mock.calls[0]![0] as string;

    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls[1]![0]).not.toBe(selectedAfterEnter);
    expect(document.activeElement?.getAttribute("data-skill-id")).toBe(onSelect.mock.calls[1]![0]);
  });

  it("shows read-only wording for non-owner roles and explains an empty catalog", () => {
    const { rerender } = render(<SkillAccountWorkbench skills={skills} role="viewer" selectedId="gif" />);
    expect(screen.getByText(/Nur der Owner kann Schlüssel hinterlegen/)).toBeDefined();
    rerender(<SkillAccountWorkbench skills={[]} role="owner" />);
    expect(screen.getByText(/Der Skillkatalog ist leer/)).toBeDefined();
  });
});