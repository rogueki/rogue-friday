import { expect, it } from "vitest";
import { HermesConfigService } from "../src/services/hermes-config";
import type { RunnerInvoker } from "../src/services/coding-runs";

/** A real service with a wired target and an invoker that answers like the bridge does. */
const service = (bridgeOutput: string) => {
  const instance = new HermesConfigService({} as never, {} as RunnerInvoker);
  const wired = instance as unknown as { target: () => { script: string; distro: string; user: string };
    invoke: () => Promise<never> };
  wired.target = () => ({ script: "/nonexistent/bridge.py", distro: "d", user: "u" });
  wired.invoke = async () => { throw new Error(bridgeOutput); };
  return instance;
};

it("warns about the requested change before it runs", async () => {
  const failure = JSON.stringify({ error: "skill_diff_failed", detail: "Error: skill 'arxiv' is not tracked" });
  const error = await service(failure).skillReport("diff", "arxiv").catch((caught) => caught as {
    code?: string; message?: string; status?: number; details?: Record<string, unknown> });

  expect(error.status).toBe(409);
  expect(error.message).toContain("is not tracked");
  expect(error.details).toMatchObject({ action: "diff", name: "arxiv" });
});

it("still reports a broken adapter as unavailable, not as a conflict", async () => {
  const error = await service("hermes adapter crashed").skillReport("diff", "arxiv")
    .catch((caught) => caught as { code?: string; status?: number });
  expect(error.status).toBe(503);
  expect(error.code).toBe("ADAPTER_UNAVAILABLE");
});