// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrbSnapshot, OrbStatus } from "./contract-types";
import { createOrbController } from "./controller/createOrbController";
import { FridayOrb } from "./FridayOrb";

const status = (extra: Partial<OrbStatus> = {}): OrbStatus => ({ mode: "idle", since: "2026-06-15T10:00:00Z", ...extra });

beforeEach(() => {
  // jsdom has no canvas; silence its "not implemented" notice so the fallback path stays quiet.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("<FridayOrb> without WebGL (2D fallback path)", () => {
  it("renders German state labels and falls back to 2d", async () => {
    render(<FridayOrb status={status()} settings={{ renderer: "2d" }} />);
    expect(await screen.findByTestId("orb-state-label")).toHaveTextContent("BEREIT");
    expect(document.querySelector("[data-orb-renderer]")?.getAttribute("data-orb-renderer")).toBe("2d");
    expect(screen.getByTestId("orb-fallback-2d")).toBeInTheDocument();
  });

  it("falls back to 2d when animations are off and when WebGL is unavailable", async () => {
    render(<FridayOrb status={status({ mode: "working", activityText: "RECHERCHE LÄUFT" })} settings={{ animations: "off" }} />);
    expect(await screen.findByTestId("orb-fallback-2d")).toBeInTheDocument();
    expect(screen.getByTestId("orb-activity")).toHaveTextContent("RECHERCHE LÄUFT");
  });

  it("accepts a wire snapshot and shows parallel agents", async () => {
    const snapshot: OrbSnapshot = {
      status: status({ mode: "speaking", activityText: "3 AGENTEN AKTIV" }),
      layers: { voice: "speaking", work: "working", attention: "none", health: "online", activeAgentIds: ["a", "b", "c"] },
    };
    render(<FridayOrb snapshot={snapshot} settings={{ renderer: "2d" }} />);
    expect(await screen.findByTestId("orb-state-label")).toHaveTextContent("F.R.I.D.A.Y. SPRICHT");
    expect(screen.getByTestId("orb-aria-live")).toHaveTextContent("F.R.I.D.A.Y. spricht. 3 AGENTEN AKTIV. Drei Agenten aktiv.");
  });

  it("Enter/click activates with the target of the current mode, Space toggles voice", () => {
    const onActivate = vi.fn();
    const onVoiceToggle = vi.fn();
    const { rerender } = render(<FridayOrb status={status({ mode: "waiting_approval", approvalId: "appr_1" })} settings={{ renderer: "2d" }} onActivate={onActivate} onVoiceToggle={onVoiceToggle} />);
    const target = screen.getByRole("button");
    fireEvent.click(target);
    expect(onActivate).toHaveBeenLastCalledWith({ kind: "approval", approvalId: "appr_1" });
    fireEvent.keyDown(target, { key: " ", code: "Space" });
    expect(onVoiceToggle).toHaveBeenCalledTimes(1);

    rerender(<FridayOrb status={status({ mode: "working", taskId: "task_9" })} settings={{ renderer: "2d" }} onActivate={onActivate} onVoiceToggle={onVoiceToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onActivate).toHaveBeenLastCalledWith({ kind: "task", taskId: "task_9" });

    rerender(<FridayOrb status={status({ mode: "error" })} settings={{ renderer: "2d" }} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onActivate).toHaveBeenLastCalledWith({ kind: "error" });
  });

  it("exposes a focusable button and a tooltip with state, action, runtime, agent, task and source", () => {
    render(
      <FridayOrb
        status={status({ mode: "working", activityText: "RECHERCHE", currentAgentId: "agent_research", taskId: "task_1", sourceEventId: "evt_9" })}
        settings={{ renderer: "2d" }}
      />,
    );
    const button = screen.getByRole("button");
    fireEvent.focus(button);
    const tip = screen.getByRole("tooltip");
    for (const text of ["Zustand", "Aktion", "Laufzeit", "Agent", "Task-ID", "Quelle", "RECHERCHE", "agent_research", "task_1", "evt_9"]) {
      expect(tip).toHaveTextContent(text);
    }
    fireEvent.blur(button);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows a pause glyph label for paused and the approval label for approvals", () => {
    const { rerender } = render(<FridayOrb status={status({ mode: "paused" })} settings={{ renderer: "2d" }} />);
    expect(screen.getByTestId("orb-state-label")).toHaveTextContent("PAUSIERT");
    rerender(<FridayOrb status={status({ mode: "waiting_approval" })} settings={{ renderer: "2d" }} />);
    expect(screen.getByTestId("orb-state-label")).toHaveTextContent("FREIGABE ERFORDERLICH");
  });
});

describe("<FridayOrb> audio input", () => {
  it("polls getAudioLevel from the 2D animation loop (no React update needed)", async () => {
    // jsdom has no canvas: a recording context lets the fallback loop run so the poll can be observed.
    const noop = (): unknown => new Proxy(() => undefined, { get: (_t, key) => (key === "addColorStop" ? noop : undefined), apply: () => noop() });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(new Proxy({}, { get: () => noop(), set: () => true }) as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} unobserve(): void {} });
    let level = 0.1;
    const reader = vi.fn(() => level);
    const snapshot: OrbSnapshot = {
      status: status({ mode: "listening" }),
      layers: { voice: "listening", work: "idle", attention: "none", health: "online", activeAgentIds: [] },
    };
    render(<FridayOrb snapshot={snapshot} settings={{ renderer: "2d", audioReactive: true }} getAudioLevel={reader} />);
    await screen.findByTestId("orb-fallback-2d");
    await vi.waitFor(() => expect(reader).toHaveBeenCalled());
    const before = reader.mock.calls.length;
    level = 0.8;
    await vi.waitFor(() => expect(reader.mock.calls.length).toBeGreaterThan(before + 1), { timeout: 2000 });
    expect(reader.mock.results.at(-1)?.value).toBe(0.8);
    vi.unstubAllGlobals();
  });
});

describe("<FridayOrb controller> (2D fallback path)", () => {
  it("renders the controller's mode, activity and parallel agents without a snapshot", async () => {
    const controller = createOrbController({ seed: 1 });
    render(<FridayOrb controller={controller} settings={{ renderer: "2d" }} />);
    expect(await screen.findByTestId("orb-state-label")).toHaveTextContent("BEREIT");
    act(() => {
      controller.bridge.onAgentActivity(3, ["A", "B", "C"]);
      controller.bridge.onTtsStarted({ hasAudioAnalysis: false });
    });
    expect(screen.getByTestId("orb-state-label")).toHaveTextContent("F.R.I.D.A.Y. SPRICHT");
    expect(screen.getByTestId("orb-activity")).toHaveTextContent("ANTWORT WIRD GESPROCHEN · 3 AGENTEN");
    act(() => controller.bridge.onApprovalRequired("appr_77"));
    expect(screen.getByTestId("orb-state-label")).toHaveTextContent("FREIGABE ERFORDERLICH");
    expect(document.querySelector("[data-orb-mode]")?.getAttribute("data-orb-mode")).toBe("waiting_approval");
  });

  it("clicking the orb activates the concrete approval of the controller", async () => {
    const controller = createOrbController({ seed: 1 });
    const onActivate = vi.fn();
    render(<FridayOrb controller={controller} settings={{ renderer: "2d" }} onActivate={onActivate} />);
    act(() => controller.bridge.onApprovalRequired("appr_77"));
    fireEvent.click(screen.getByRole("button"));
    expect(onActivate).toHaveBeenCalledWith({ kind: "approval", approvalId: "appr_77" });
  });

  it("unsubscribes from the controller on unmount", () => {
    const controller = createOrbController({ seed: 1 });
    const { unmount } = render(<FridayOrb controller={controller} settings={{ renderer: "2d" }} />);
    unmount();
    expect(() => act(() => controller.bridge.onWarning("x"))).not.toThrow();
  });

  it("host layout follows the order: grid, centred, padded, canvas wrapper without negative offsets", async () => {
    const controller = createOrbController({ seed: 1 });
    render(<FridayOrb controller={controller} settings={{ renderer: "2d" }} />);
    const css = document.querySelector("style")?.textContent ?? "";
    expect(css).toMatch(/\.friday-orb\{[^}]*display:grid[^}]*place-items:center[^}]*overflow:hidden[^}]*padding:clamp\(24px,4vh,52px\)/);
    expect(css).toMatch(/\.friday-orb__canvas\{[^}]*position:absolute;inset:0;display:grid;place-items:center;pointer-events:none/);
    expect(css).not.toMatch(/top:46%/);
    expect(css).not.toMatch(/translate\(-50%,-50%\)/);
  });
});
