import { describe, expect, it } from "vitest";
import { defaultPageRedirect, NAV_PAGES, orderNavPages } from "./navModel";

describe("configured start page", () => {
  it("redirects only the overview root and preserves direct links", () => {
    expect(defaultPageRedirect("/", "tasks")).toBe("/tasks");
    expect(defaultPageRedirect("/", "overview")).toBeNull();
    expect(defaultPageRedirect("/calendar", "tasks")).toBeNull();
    expect(defaultPageRedirect("/", "content-studio", false)).toBeNull();
    expect(defaultPageRedirect("/", "content-studio", true)).toBe("/content-studio");
    expect(defaultPageRedirect("/", "unknown-page")).toBeNull();
  });
});

// DASH-14.03: the studio ships by default, an existing nav preference survives an upgrade, and a hidden page stays hidden.
describe("navigation preference across an upgrade", () => {
  it("keeps a stored order and appends pages the stored order does not know yet", () => {
    const pages = orderNavPages(["tasks", "overview"], undefined, true);
    expect(pages.slice(0, 2).map((page) => page.id)).toEqual(["tasks", "overview"]);
    expect(pages).toHaveLength(NAV_PAGES.length);
    expect(pages.map((page) => page.id)).toContain("content-studio");
  });
  it("hides what the operator hid but keeps the settings page reachable", () => {
    const pages = orderNavPages(undefined, ["calendar", "settings"], true).map((page) => page.id);
    expect(pages).not.toContain("calendar");
    expect(pages).toContain("settings");
  });
  it("shows the studio only while the feature switch is on", () => {
    expect(orderNavPages(undefined, undefined, true).map((page) => page.id)).toContain("content-studio");
    expect(orderNavPages(undefined, undefined, false).map((page) => page.id)).not.toContain("content-studio");
  });
});
