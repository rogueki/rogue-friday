import { runConformanceSuite } from "@jarvis/adapter-testkit";
import { voiceFactory } from "../src";

runConformanceSuite({
  name: "jarvis-voice-http (placeholder)",
  category: "voice",
  profile: "placeholder",
  createAdapter: () => ({
    adapter: voiceFactory.create(),
    configSchema: voiceFactory.configSchema,
    config: {},
  }),
});
