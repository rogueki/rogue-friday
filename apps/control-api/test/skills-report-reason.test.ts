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

interface ApiFailure { code?: string; message?: string; status?: number; details?: Record<string, unknown> }

const failure = async (promise: Promise<unknown>): Promise<ApiFailure> => {
  try {
    await promise;
  } catch (error) {
    return error as ApiFailure;
  }
  throw new Error("the call was expected to fail");
};

it("passes the CLI's own reason on when it refuses a report", async () => {
  const bridgeOutput = JSON.stringify({ error: "skill_diff_failed", detail: "Error: skill 'arxiv' is not tracked" });
  const error = await failure(service(bridgeOutput).skillReport("diff", "arxiv"));

  expect(error.status).toBe(409);
  expect(error.message).toContain("is not tracked");
  expect(error.details).toMatchObject({ action: "diff", name: "arxiv" });
});

it("still reports a broken adapter as unavailable, not as a conflict", async () => {
  const error = await failure(service("hermes adapter crashed").skillReport("diff", "arxiv"));
  expect(error.status).toBe(503);
  expect(error.code).toBe("ADAPTER_UNAVAILABLE");
});

it("accepts a full registry identifier and refuses anything longer", async () => {
  // The identifier form is what the CLI resolves unambiguously; the adapter call is stubbed, so a 503 proves the
  // value passed validation and reached the CLI step.
  expect((await failure(service("adapter_unavailable")
    .skillReport("inspect", "official/devops/hermes-s6-container-supervision"))).status).toBe(503);
  expect((await failure(service("adapter_unavailable")
    .skillReport("audit", "skills-sh/nousresearch/hermes-agent"))).status).toBe(503);

  for (const bad of ["a/b/c/d", "/leading", "trailing/", "with space/name", "../etc"]) {
    const error = await failure(service("adapter_unavailable").skillReport("inspect", bad));
    expect(error.code, bad).toBe("VALIDATION_FAILED");
  }
});