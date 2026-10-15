import { describe, expect, it } from "vitest";
import { routeOrbActivation } from "@/features/orb/useOrbActions";
import { activePageId, NAV_PAGES, orderNavPages } from "@/features/shell/navModel";
import { buildTimeline } from "@/features/overview/WidgetPanels";
import { DEFAULT_OVERVIEW_LAYOUT, resolveOverviewLayout, widgetPlacement } from "@/features/overview/layout";
import { capabilityPathState, capabilityState } from "@/lib/capabilities";
import { capabilitiesOf } from "@/test/render";
import { makeOverview, makeTask } from "@/test/fixtures";
import { translate } from "@/i18n";
import { de } from "@/i18n/de";
import { en } from "@/i18n/en";
import { shouldRetry } from "@/lib/api/queryClient";
import { FridayApiError } from "@friday/sdk";

describe("navigation", () => {
  it("has all 16 pages of PLAN §26 with the specified routes", () => {
    expect(NAV_PAGES.map((p) => p.route)).toEqual([
      "/", "/tasks", "/activity", "/memory", "/agents", "/approvals", "/communication", "/calendar",
      "/automations", "/research", "/files", "/voice", "/alerts", "/system", "/audit", "/settings",
    ]);
  });

  it("applies stored order and visibility but keeps settings reachable and never loses pages", () => {
    const ordered = orderNavPages(["settings", "tasks", "bogus"], ["tasks", "settings", "audit"]);
    expect(ordered[0]?.id).toBe("settings");
    expect(ordered.map((p) => p.id)).not.toContain("tasks");
    expect(ordered.map((p) => p.id)).not.toContain("audit");
    expect(ordered).toHaveLength(14);
  });

  it("resolves the active page from the pathname", () => {
    expect(activePageId("/")).toBe("overview");
    expect(activePageId("/tasks")).toBe("tasks");
    expect(activePageId("/tasks/")).toBe("tasks");
    expect(activePageId("/communication")).toBe("communication");
  });
});

describe("orb interaction routing (PLAN §21)", () => {
  it("routes by activation target", () => {
    expect(routeOrbActivation({ kind: "approval", approvalId: "appr_1" })).toEqual({ kind: "navigate", href: "/approvals?approval=appr_1" });
    expect(routeOrbActivation({ kind: "task", taskId: "task_1" })).toEqual({ kind: "navigate", href: "/tasks?task=task_1" });
    expect(routeOrbActivation({ kind: "error" })).toEqual({ kind: "drawer", drawer: "error" });
    expect(routeOrbActivation({ kind: "activity" })).toEqual({ kind: "drawer", drawer: "activity" });
    expect(routeOrbActivation({ kind: "command" })).toEqual({ kind: "palette" });
  });
});

describe("capabilities", () => {
  const caps = capabilitiesOf({ mail: { read: true, draft: true, send: false }, voice: { read: false, stop: false } });
  it("distinguishes available, read-only and missing", () => {
    expect(capabilityState(caps, "mail", "draft")).toBe("available");
    expect(capabilityState(caps, "mail", "send")).toBe("read-only");
    expect(capabilityState(caps, "voice", "stop")).toBe("missing");
    expect(capabilityState(caps, "telephony", "call")).toBe("missing");
    expect(capabilityState(undefined, "mail", "read")).toBe("missing");
    expect(capabilityPathState(caps, "mail.send")).toBe("read-only");
  });
});

describe("overview layout", () => {
  it("falls back to the default layout and drops unknown widgets", () => {
    const layout = resolveOverviewLayout(
      [{ layoutId: "custom", widgets: [{ id: "voice-status", x: 0, y: 0, w: 0, h: 0, visible: true }, { id: "ai-core-orb", x: 0, y: 0, w: 12, h: 7, visible: true }, { id: "quick-commands", x: 11, y: 0, w: 5, h: 2, visible: false }] }],
      "custom",
    );
    expect(layout.widgets.map((w) => w.id)).toEqual(["ai-core-orb", "quick-commands"]);
    // invalid rectangle (exceeds the grid) falls back to the default placement but keeps the visibility choice
    const quick = layout.widgets.find((w) => w.id === "quick-commands");
    expect(quick).toMatchObject({ x: 9, w: 3, visible: false });
    expect(resolveOverviewLayout(undefined, undefined).widgets).toHaveLength(DEFAULT_OVERVIEW_LAYOUT.widgets.length);
    // a layout with only foreign widget ids falls back to the built-in layout instead of an empty page
    const foreign = resolveOverviewLayout([{ layoutId: "other", widgets: [{ id: "orb", x: 0, y: 0, w: 6, h: 6, visible: true }] }], "other");
    expect(foreign.layoutId).toBe(DEFAULT_OVERVIEW_LAYOUT.layoutId);
  });

  it("converts a widget into grid placement", () => {
    expect(widgetPlacement({ id: "ai-core-orb", x: 3, y: 0, w: 6, h: 7, visible: true }, 12)).toEqual({ "--ov-col": "4 / span 6", "--ov-row": "1 / span 7" });
  });
});

describe("mission timeline", () => {
  const format = { locale: "de-DE", timeZone: "Europe/Berlin", hour12: false };
  const labels = { done: "Erledigt", blocked: "Blockiert", due: "fällig", minutes: "Min.", hours: "Std." };
  it("combines events and tasks in time order with real progress only", () => {
    const now = new Date("2026-10-14T10:00:00Z");
    const overview = makeOverview({
      nextEvents: [
        { id: "cal_1", title: "Standup", start: "2026-10-14T07:30:00Z", end: "2026-10-14T08:00:00Z", status: "confirmed" },
        { id: "cal_2", title: "Review", start: "2026-10-14T13:00:00Z", end: "2026-10-14T14:00:00Z", status: "confirmed" },
      ] as never,
      runningTasks: [makeTask({ id: "task_x", title: "Analyse", dueAt: "2026-10-14T11:00:00Z", progress: { mode: "indeterminate", value: null } })],
    });
    const items = buildTimeline(overview, now, format, labels);
    expect(items.map((i) => i.title)).toEqual(["Standup", "Analyse", "Review"]);
    expect(items[0]).toMatchObject({ status: "done", meta: "Erledigt", time: "09:30" });
    expect(items[1]?.progress).toBeNull();
    expect(items[2]?.status).toBe("upcoming");
  });
});

describe("i18n", () => {
  it("has the same keys in German and English and interpolates variables", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
    expect(translate("de", "palette.goto", { page: "Aufgaben" })).toBe("Gehe zu Aufgaben");
    expect(translate("en", "palette.goto", { page: "Tasks" })).toBe("Go to Tasks");
  });
});

describe("retry policy", () => {
  const error = (status: number, retryable: boolean) =>
    new FridayApiError({ code: "INTERNAL", message: "x", severity: "error", retryable, correlationId: "corr_x" }, status);
  it("retries retryable 5xx and network errors, never 4xx, and stops after three attempts", () => {
    expect(shouldRetry(0, error(503, true))).toBe(true);
    expect(shouldRetry(0, error(0, true))).toBe(true);
    expect(shouldRetry(0, error(500, false))).toBe(false);
    expect(shouldRetry(0, error(404, true))).toBe(false);
    expect(shouldRetry(0, error(429, true))).toBe(false);
    expect(shouldRetry(3, error(503, true))).toBe(false);
  });
});
