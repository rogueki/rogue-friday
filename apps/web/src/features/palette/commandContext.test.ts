import { afterEach, describe, expect, it } from "vitest";
import { commandContextForRoute, needsCommandClarification, registerCommandSelection } from "./commandContext";

afterEach(() => { registerCommandSelection("/content-studio", [])(); });

describe("global command selection context", () => {
  it("only sends a current selection for its owning route", () => {
    const clear = registerCommandSelection("/content-studio", ["idea-1"]);
    expect(commandContextForRoute("/content-studio")).toEqual({ route: "/content-studio", selectedIds: ["idea-1"] });
    expect(commandContextForRoute("/tasks")).toEqual({ route: "/tasks" });
    clear();
    expect(commandContextForRoute("/content-studio")).toEqual({ route: "/content-studio" });
  });

  it("uses the latest selection and ignores stale cleanup from the previous selection", () => {
    const clearFirst = registerCommandSelection("/content-studio", ["idea-1"]);
    registerCommandSelection("/content-studio", ["idea-2"]);
    clearFirst();
    expect(commandContextForRoute("/content-studio")).toEqual({ route: "/content-studio", selectedIds: ["idea-2"] });
  });

  it("marks only structured ambiguity errors as clarification prompts", () => {
    expect(needsCommandClarification({ clarificationRequired: true })).toBe(true);
    expect(needsCommandClarification({ fieldErrors: [], currentVersion: 4 })).toBe(false);
  });
});
