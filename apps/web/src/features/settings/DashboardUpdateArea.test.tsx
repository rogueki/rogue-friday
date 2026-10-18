// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DashboardUpdateArea } from "./DashboardUpdateArea";

const mocks = vi.hoisted(() => ({
  install: vi.fn(),
  refetch: vi.fn(),
  status: {
    data: { installed: "a".repeat(40), latest: "b".repeat(40), available: true,
      installing: false, error: null, progress: null, lastResult: null } as Record<string, unknown> | undefined,
    isFetching: false, isError: false, error: null as Error | null,
  },
}));
vi.mock("@/i18n", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("./SettingsDrafts", () => ({ useSettingsDrafts: () => ({ role: "owner" }) }));
vi.mock("@/lib/api/dashboardUpdate", () => ({
  installDashboardUpdate: mocks.install,
  useDashboardUpdateStatus: () => ({ ...mocks.status, refetch: mocks.refetch }),
}));

it("opens confirmation and shows a failed POST visibly", async () => {
  sessionStorage.clear();
  mocks.status.data = { installed: "a".repeat(40), latest: "b".repeat(40), available: true,
    installing: false, error: null, progress: null, lastResult: null };
  mocks.status.isError = false;
  mocks.refetch.mockResolvedValue({ data: { installing: false } });
  mocks.install.mockRejectedValue(new Error("Start des Updates fehlgeschlagen"));
  render(<DashboardUpdateArea />);
  fireEvent.click(screen.getByRole("button", { name: "settings.update.install" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "settings.update.install" }));
  await waitFor(() => expect(mocks.install).toHaveBeenCalledWith("b".repeat(40)));
  await waitFor(() => expect(screen.getByText("Start des Updates fehlgeschlagen")).toBeTruthy());
});

it("closes confirmation immediately while the POST is still pending", async () => {
  sessionStorage.clear();
  mocks.install.mockImplementation(() => new Promise(() => {}));
  render(<DashboardUpdateArea />);
  fireEvent.click(screen.getByRole("button", { name: "settings.update.install" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "settings.update.install" }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  expect(screen.getByText("settings.update.starting")).toBeTruthy();
});

it("shows reconnect state after reload during an API outage", async () => {
  sessionStorage.setItem("friday-dashboard-update-run", "pending");
  mocks.status.data = undefined;
  mocks.status.isError = true;
  mocks.status.error = new Error("offline");
  render(<DashboardUpdateArea />);
  await waitFor(() => expect(screen.getByText("settings.update.reconnecting")).toBeTruthy());
  expect(screen.queryByText("settings.update.current")).toBeNull();
});
