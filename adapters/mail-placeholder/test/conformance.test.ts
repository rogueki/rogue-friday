import { runConformanceSuite } from "@jarvis/adapter-testkit";
import { mailFactory } from "../src";

runConformanceSuite({
  name: "gmx-mail (placeholder)",
  category: "communication",
  profile: "placeholder",
  createAdapter: () => ({
    adapter: mailFactory.create(),
    configSchema: mailFactory.configSchema,
    config: {},
  }),
});
