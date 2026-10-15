import { runConformanceSuite } from "@friday/adapter-testkit";
import { voiceFactory } from "../src";

runConformanceSuite({
  name: "friday-voice-http (placeholder)",
  category: "voice",
  profile: "placeholder",
  createAdapter: () => ({
    adapter: voiceFactory.create(),
    configSchema: voiceFactory.configSchema,
    config: {},
  }),
});
