import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SkillCatalogEntry } from "@friday/sdk";
import { afterEach, expect, it, vi } from "vitest";
import { SelectedSkillActivation } from "./SelectedSkillActivation";

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), refetch: vi.fn(), skills: [] as SkillCatalogEntry[] }));
vi.mock("@/lib/api/domains/skills", () => ({
  useSkillsCatalog: () => ({ data: { data: mocks.skills }, isPending: false, isError: false, refetch: mocks.refetch }),
  useSetSkillActivation: () => ({ mutateAsync: mocks.mutateAsync }),
}));

const skill = (id: string, discovered: boolean | null, enabled: boolean | null) => ({
  id, name: id, discovered, enabled,
}) as SkillCatalogEntry;

afterEach(() => { mocks.skills = []; mocks.mutateAsync.mockReset(); mocks.refetch.mockReset(); });

it("changes only the explicitly selected skill and reports Hermes confirmation after refresh", async () => {
  mocks.skills = [skill("friday:notes", true, false), skill("hermes:other", true, false)];
  mocks.mutateAsync.mockResolvedValue({});
  mocks.refetch.mockResolvedValue({ data: { data: [skill("friday:notes", true, true), skill("hermes:other", true, false)] }, isError: false });
  render(<SelectedSkillActivation selectedIds={["friday:notes"]} />);
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "friday:notes aktivieren" }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Aktivierung von Hermes bestätigt"));
  expect(mocks.mutateAsync).toHaveBeenCalledOnce();
  expect(mocks.mutateAsync).toHaveBeenCalledWith({ id: "friday:notes", enabled: true });
  expect(mocks.refetch).toHaveBeenCalledOnce();
});

it("does not offer activation for unknown, missing, or undiscovered skills", () => {
  mocks.skills = [skill("friday:unknown", true, null), skill("friday:missing", false, false)];
  render(<SelectedSkillActivation selectedIds={["friday:unknown", "friday:missing", "friday:absent"]} />);
  expect(screen.queryByRole("button", { name: /aktivieren|deaktivieren/i })).toBeNull();
  expect(screen.getByText("Nicht im Katalog")).toBeTruthy();
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
});
