import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/features/voice/useVoiceUi", () => ({ useVoiceUi: () => ({ toggle: vi.fn() }) }));

const { routeOrbActivation } = await import("./useOrbActions");

describe("orb click routing (PLAN §21, owner order 22.8)", () => {
  it("approval -> that approval, error -> error detail, working -> the current task, idle -> command bar", () => {
    expect(routeOrbActivation({ kind: "approval", approvalId: "ap 1" })).toEqual({ kind: "navigate", href: "/approvals?approval=ap%201" });
    expect(routeOrbActivation({ kind: "approval" })).toEqual({ kind: "navigate", href: "/approvals" });
    expect(routeOrbActivation({ kind: "error" })).toEqual({ kind: "drawer", drawer: "error" });
    expect(routeOrbActivation({ kind: "task", taskId: "t-1" })).toEqual({ kind: "navigate", href: "/tasks?task=t-1" });
    expect(routeOrbActivation({ kind: "command" })).toEqual({ kind: "palette" });
    expect(routeOrbActivation({ kind: "activity" })).toEqual({ kind: "drawer", drawer: "activity" });
  });
});
