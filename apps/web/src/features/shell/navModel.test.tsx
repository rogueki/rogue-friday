import { describe, expect, it } from "vitest";
import { defaultPageRedirect } from "./navModel";

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
