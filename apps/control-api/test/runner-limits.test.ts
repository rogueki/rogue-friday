import { expect, it } from "vitest";
import { invokeCodingRunner } from "../src/services/coding-runs";

const target = { script: "/mnt/c/Friday/installer/wsl/hermes_config_bridge.py", distro: "Friday-2", user: "friday" };

it("rejects nonsense runner limits but allows the long timeouts the skills actually need", async () => {
  // The old 35 s ceiling refused 95 s and 195 s calls at the guard, so inspect, audit, browse and every mutation
  // answered 503 in a few milliseconds without the CLI ever running (N-065).
  await expect(invokeCodingRunner(target.script, target.distro, target.user, ["skill-report"], "{}", 195_000))
    .rejects.not.toThrow("runner_limits");
  for (const timeout of [0, -1, 300_001]) {
    await expect(invokeCodingRunner(target.script, target.distro, target.user, [], undefined, timeout))
      .rejects.toThrow("runner_limits");
  }
});
