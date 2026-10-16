import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { OnboardingPage } from "./OnboardingPage";

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/session", () => ({ useSession: () => ({ role: "owner", offline: false, displayName: "Erik" }) }));
vi.mock("@/lib/api/domains/skills", () => ({
  useOnboarding: () => ({ data: { data: { revision: 0, preferredName: null, goals: [], selectedSkillIds: [], completedAt: null,
    steps: { intro: "pending", profile: "pending", skills: "pending", accounts: "pending", finish: "pending" } } }, isPending: false, isError: false }),
  useSkillsCatalog: () => ({ data: { data: [] }, isPending: false, isError: false }),
  useUpdateOnboarding: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));

afterEach(() => { mocks.mutateAsync.mockReset(); mocks.replace.mockReset(); sessionStorage.clear(); });

it("lets the owner postpone the popup without changing onboarding state", async () => {
  const close = vi.fn();
  render(<OnboardingPage popup onClose={close} />);
  await userEvent.click(screen.getByRole("button", { name: "Später" }));
  expect(close).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem("friday-onboarding-later")).toBe("1");
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
});

it("finishes early by saving unfinished steps as skipped", async () => {
  mocks.mutateAsync.mockResolvedValue({});
  const close = vi.fn();
  render(<OnboardingPage popup onClose={close} />);
  await userEvent.click(screen.getByRole("button", { name: "Einführung abschließen" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mocks.mutateAsync).toHaveBeenCalledWith({ revision: 0, update: {
    steps: { intro: "skipped", profile: "skipped", skills: "skipped", accounts: "skipped", finish: "skipped" },
    goals: [], selectedSkillIds: [], preferredName: "Erik",
  } });
  expect(mocks.replace).not.toHaveBeenCalled();
});
