import { afterEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HermesConfigService } from "../src/services/hermes-config";
import type { RunnerInvoker } from "../src/services/coding-runs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(invoke: RunnerInvoker) {
  const root = mkdtempSync(join(tmpdir(), "friday-gateway-pairing-"));
  roots.push(root);
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config", "install-state.json"),
    JSON.stringify({ distro_name: "Friday-Ubuntu", linux_user: "friday" }));
  mkdirSync(join(root, "installer", "wsl"), { recursive: true });
  writeFileSync(join(root, "installer", "wsl", "hermes_config_bridge.py"), "# bundled fixture\n");
  return new HermesConfigService(join(root, "data"), invoke);
}

const LIST_ANSWER = {
  platforms: [
    { platform: "telegram", pending: [{ requestId: "0123456789abcdef", userId: "424242", userName: "Alex", ageMinutes: 3 }],
      approved: [] },
    { platform: "discord", pending: [], approved: [] },
    { platform: "whatsapp", pending: [], approved: [] },
  ],
};

it("lists pending and approved pairings without any code", async () => {
  const seen: { args: string[]; input: unknown }[] = [];
  const invoke: RunnerInvoker = async (_script, _distro, _user, args, input) => {
    seen.push({ args, input: JSON.parse(String(input)) as unknown });
    return LIST_ANSWER as never;
  };
  const result = await fixture(invoke).gatewayPairing({ action: "list" });
  expect(result).toEqual(LIST_ANSWER);
  expect(seen).toEqual([{ args: ["pairing"], input: { action: "list" } }]);
});

it("maps an expired request to 409 and an unknown user to 404", async () => {
  const expired: RunnerInvoker = async () => {
    throw new Error("runner_4:pairing_request_not_found");
  };
  await expect(fixture(expired).gatewayPairing({ action: "approve", platform: "telegram",
    requestId: "0123456789abcdef" })).rejects.toMatchObject({ code: "CONFLICT" });

  const unknownUser: RunnerInvoker = async () => {
    throw new Error("runner_4:pairing_user_not_found");
  };
  await expect(fixture(unknownUser).gatewayPairing({ action: "revoke", platform: "telegram", userId: "424242" }))
    .rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("rejects malformed requests before calling Hermes and malformed answers after", async () => {
  let called = 0;
  const invoke: RunnerInvoker = async () => {
    called += 1;
    return { platforms: [{ platform: "signal", pending: [], approved: [] }] } as never;
  };
  const service = fixture(invoke);
  await expect(service.gatewayPairing({ action: "approve", platform: "telegram", requestId: "123" }))
    .rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  expect(called).toBe(0);
  await expect(service.gatewayPairing({ action: "list" }))
    .rejects.toMatchObject({ code: "ADAPTER_UNAVAILABLE" });
  expect(called).toBe(1);
});
