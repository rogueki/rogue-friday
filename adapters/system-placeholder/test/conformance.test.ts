import { runConformanceSuite } from "@jarvis/adapter-testkit";
import { systemFactory } from "../src";

runConformanceSuite({
  name: "windows-wsl-system (placeholder)",
  category: "system",
  profile: "placeholder",
  createAdapter: () => ({
    adapter: systemFactory.create(),
    configSchema: systemFactory.configSchema,
    config: {},
  }),
});
