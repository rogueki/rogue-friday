import { describe, expect, it, vi } from "vitest";
import { withLegacyEnv } from "../../scripts/lib/legacy-env.mjs";

describe("withLegacyEnv (dev scripts)", () => {
  it("maps legacy JARVIS_* and NEXT_PUBLIC_JARVIS_* variables when the FRIDAY_* variant is unset and warns once", () => {
    const warn = vi.fn();
    const env = withLegacyEnv({ JARVIS_API_ORIGIN: "http://127.0.0.1:3100", NEXT_PUBLIC_JARVIS_MSW: "1", PATH: "/bin" }, warn);
    expect(env.FRIDAY_API_ORIGIN).toBe("http://127.0.0.1:3100");
    expect(env.NEXT_PUBLIC_FRIDAY_MSW).toBe("1");
    expect(env.PATH).toBe("/bin");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("JARVIS_API_ORIGIN");
    expect(warn.mock.calls[0]?.[0]).toContain("NEXT_PUBLIC_JARVIS_MSW");
  });

  it("prefers FRIDAY_* and stays silent without legacy variables", () => {
    const warn = vi.fn();
    const env = withLegacyEnv({ FRIDAY_PORT: "1", JARVIS_PORT: "2" }, warn);
    expect(env.FRIDAY_PORT).toBe("1");
    expect(warn).not.toHaveBeenCalled();
  });
});
