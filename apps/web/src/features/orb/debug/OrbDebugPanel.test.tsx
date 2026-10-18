import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { renderWithProviders } from "@/test/render";
import { getOrbRuntime, resetOrbRuntimeForTests } from "../orbRuntime";
import OrbDebugPanel from "./OrbDebugPanel";
import { orbSettingsFromDebugVisuals, resetOrbDebugVisuals } from "./orbDebugStore";

afterEach(() => {
  resetOrbRuntimeForTests();
  resetOrbDebugVisuals();
});

describe("OrbDebugPanel", () => {
  it("has a button for every mode and drives the controller directly", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrbDebugPanel />);
    const { controller } = getOrbRuntime();
    const modes = screen.getAllByRole("button").filter((button) => button.hasAttribute("data-mode")).map((button) => button.getAttribute("data-mode"));
    expect(modes).toEqual(["booting", "idle", "listening", "transcribing", "thinking", "syncing", "working", "speaking", "waiting_approval", "success", "warning", "error", "offline", "paused"]);
    await user.click(screen.getByRole("button", { name: "Modus: Hört zu" }));
    expect(controller.getState().status.mode).toBe("listening");
    expect(controller.getState().overrideMode).toBe("listening");
    expect(screen.getByTestId("orb-lab-state")).toHaveTextContent("listening");
  });

  it("offers the demo scripts and a reset that releases the override", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrbDebugPanel />);
    const { controller, demo } = getOrbRuntime();
    await user.click(screen.getByRole("button", { name: "Auto-Demo" }));
    expect(demo.running).toBe(true);
    await user.click(screen.getByRole("button", { name: "Fehler-Recovery-Demo" }));
    await user.click(screen.getByRole("button", { name: "Zurücksetzen" }));
    expect(demo.running).toBe(false);
    expect(controller.getState().overrideMode).toBeNull();
  });

  it("renders sliders for levels, progress, agents, bloom, particle density and speed", () => {
    renderWithProviders(<OrbDebugPanel />);
    for (const label of ["Eingangspegel", "Ausgangspegel", "Fortschritt", "Agentenanzahl", "Bloom", "Partikeldichte", "Animationsgeschwindigkeit"]) {
      expect(screen.getByRole("slider", { name: label }), label).toBeInTheDocument();
    }
    expect(screen.getByRole("switch", { name: "Fortschritt unbekannt" })).toBeInTheDocument();
  });
});

describe("orbSettingsFromDebugVisuals", () => {
  it("maps the visual sliders onto orb settings and leaves untouched values out", () => {
    expect(orbSettingsFromDebugVisuals({})).toEqual({});
    expect(orbSettingsFromDebugVisuals({ bloom: 0, speed: 1.5, particleDensity: 20 })).toEqual({ bloom: false, intensity: 0, speed: 1.5, particleDensity: 20 });
    expect(orbSettingsFromDebugVisuals({ bloom: 80 })).toEqual({ bloom: true, intensity: 80 });
  });
});
