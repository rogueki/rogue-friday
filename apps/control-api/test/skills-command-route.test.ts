import { expect, it } from "vitest";
import { HermesConfigService } from "../src/services/hermes-config";
import type { RunnerInvoker } from "../src/services/coding-runs";
import { startTestApi } from "./helpers";

const BROWSE = "Browsing skills.sh\n1. skill-creator  anthropics/skills  1200 installs";
const CHECKS = "Checking all skills\nOK";
const TAPS = "Configured taps\n  github  anthropics/skills";

const stub = (calls: unknown[] = []) => ({
  skillCommand: async (command: string, params: Record<string, unknown>) => {
    calls.push({ command, params });
    const text = command === "browse" ? BROWSE : command === "check" ? CHECKS : TAPS;
    return { command, name: (params.name as string | undefined) ?? null, text,
      bytes: Buffer.byteLength(text, "utf8"), truncated: false, observedAt: "2026-10-23T04:00:00.000Z" };
  },
});

it("serves browse, check and tap list as unchanged CLI text", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const calls: unknown[] = [];
    api.runtime.hermesConfig = stub(calls) as never;
    const owner = api.client();
    await owner.loginDev("owner");

    const browse = await owner.get("/api/v1/skills/reports?command=browse&page=2&size=10&source=skills-sh");
    expect(browse.statusCode).toBe(200);
    expect(browse.json().data).toMatchObject({ command: "browse", name: null, text: BROWSE, truncated: false });
    expect(calls[0]).toEqual({ command: "browse", params: { name: undefined, page: 2, size: 10, source: "skills-sh" } });

    const check = await owner.get("/api/v1/skills/reports?command=check");
    expect(check.json().data).toMatchObject({ command: "check", text: CHECKS });
    expect(calls[1]).toEqual({ command: "check", params: { name: undefined, page: undefined, size: undefined,
      source: undefined } });

    const taps = await owner.get("/api/v1/skills/reports?command=tap-list");
    expect(taps.json().data).toMatchObject({ command: "tap-list", text: TAPS });
  } finally {
    await api.close();
  }
});

it("refuses parameters that do not belong to the command", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    // A real service with a dead invoker: it refuses wrong parameter sets itself (422) and fails only when it would
    // actually reach the CLI (503), which is exactly the split this route has to keep.
    const service = new HermesConfigService({} as never, {} as RunnerInvoker);
    const wired = service as unknown as { target: () => { script: string; distro: string; user: string };
      invoke: () => Promise<never> };
    wired.target = () => ({ script: "/nonexistent/bridge.py", distro: "d", user: "u" });
    wired.invoke = async () => { throw new Error("adapter_unavailable"); };
    api.runtime.hermesConfig = service as never;
    const owner = api.client();
    await owner.loginDev("owner");

    // Schema violations are refused by the query validator with 400 (its documented contract, ledger N-052), while a
    // parameter that is legal in general but wrong for this command is refused by the handler with 422.
    expect((await owner.get("/api/v1/skills/reports")).statusCode).toBe(400);
    expect((await owner.get("/api/v1/skills/reports?command=publish")).statusCode).toBe(400);
    expect((await owner.get("/api/v1/skills/reports?command=browse&page=0&size=10")).statusCode).toBe(400);
    expect((await owner.get("/api/v1/skills/reports?command=browse&page=1&size=51")).statusCode).toBe(400);
    expect((await owner.get("/api/v1/skills/reports?command=browse&page=1&size=10&source=bad%20source")).statusCode).toBe(400);
    expect((await owner.get("/api/v1/skills/reports?command=check&page=1")).statusCode).toBe(422);
    expect((await owner.get("/api/v1/skills/reports?command=tap-list&name=demo")).statusCode).toBe(422);
    expect((await owner.get("/api/v1/skills/reports?command=tap-list")).statusCode).toBe(503);
  } finally {
    await api.close();
  }
});

it("keeps the service honest about which command takes which parameter", async () => {
  const service = new HermesConfigService({} as never, {} as RunnerInvoker);
  await expect(service.skillCommand("tap-list", { name: "demo" })).rejects.toThrow("nimmt keine Parameter");
  await expect(service.skillCommand("browse", { page: 1 })).rejects.toThrow("braucht page und size");
  await expect(service.skillCommand("check", { source: "skills-sh" })).rejects.toThrow("nur einen optionalen Skill-Namen");
  await expect(service.skillCommand("check", { name: "../etc" })).rejects.toThrow("Ungueltiger Skill-Name");
});