import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { PanelFrame } from "./PanelFrame";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("PanelFrame not-configured", () => {
  it("puts retry and configure side by side in the footer instead of overlapping the body", async () => {
    // Live report 2026-11-02: in short dashboard tiles the body's retry button was drawn over the footer's configure button.
    const retry = vi.fn();
    const { container } = renderWithProviders(
      <PanelFrame title="Kommunikation" state={{ kind: "not-configured", moduleName: "Kommunikation", onRetry: retry }} />,
    );
    const footer = container.querySelector(".jv-panel__footer");
    const body = container.querySelector(".jv-panel__body");
    expect(footer).not.toBeNull();
    expect(within(body as HTMLElement).queryByRole("button")).toBeNull();
    const actions = within(footer as HTMLElement).getAllByRole("button").map((button) => button.textContent);
    expect(actions).toEqual(["Erneut versuchen", "Adapter konfigurieren"]);
    await userEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(retry).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Adapter konfigurieren" }));
    expect(push).toHaveBeenCalledWith("/settings");
  });

  it("shows only the configure action when there is nothing to retry", () => {
    const { container } = renderWithProviders(<PanelFrame title="Kalender" state={{ kind: "not-configured", moduleName: "Kalender" }} />);
    const footer = container.querySelector(".jv-panel__footer") as HTMLElement;
    expect(within(footer).getAllByRole("button").map((button) => button.textContent)).toEqual(["Adapter konfigurieren"]);
  });
});
