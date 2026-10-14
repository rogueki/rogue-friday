import { runConformanceSuite } from "@jarvis/adapter-testkit";
import { calendarFactory } from "../src";

runConformanceSuite({
  name: "caldav-calendar (placeholder)",
  category: "calendar",
  profile: "placeholder",
  createAdapter: () => ({
    adapter: calendarFactory.create(),
    configSchema: calendarFactory.configSchema,
    config: {},
  }),
});
