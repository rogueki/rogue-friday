import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ start: vi.fn(async () => {}), pushToTalkStart: vi.fn(), pushToTalkRelease: vi.fn(),
  snapshot: vi.fn(() => ({ available: true, active: true })) }));
vi.mock("./browserAudio", () => ({ browserAudio: bridge }));
import { installPushToTalkShortcut } from "./pushToTalkShortcut";

let dispose: () => void = () => undefined;
afterEach(() => { dispose(); vi.clearAllMocks(); });

describe("push-to-talk keyboard path", () => {
  it("sends exactly one start and release for a held configured key", () => {
    dispose = installPushToTalkShortcut("Ctrl+Space");
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "Space", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "Space", ctrlKey: true, repeat: true }));
    expect(bridge.pushToTalkStart).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, code: "Space", ctrlKey: true }));
    expect(bridge.pushToTalkRelease).toHaveBeenCalledTimes(1);
  });

  it("does not capture keystrokes from an editor or when browser transport is unavailable", () => {
    dispose = installPushToTalkShortcut("F13");
    const input = document.createElement("input");
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "F13" }));
    expect(bridge.pushToTalkStart).not.toHaveBeenCalled();
    input.remove();
    bridge.snapshot.mockReturnValueOnce({ available: false, active: false });
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, code: "F13" }));
    expect(bridge.pushToTalkStart).not.toHaveBeenCalled();
  });
});
