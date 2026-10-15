import { runConformanceSuite } from "@friday/adapter-testkit";
import { hermesFactories } from "../src";

// One adapter per Hermes category; every one of them must pass the reduced "not configured" profile.
for (const factory of hermesFactories) {
  runConformanceSuite({
    name: `${factory.providerId} (placeholder)`,
    category: factory.category,
    profile: "placeholder",
    createAdapter: () => ({ adapter: factory.create(), configSchema: factory.configSchema, config: {} }),
  });
}
