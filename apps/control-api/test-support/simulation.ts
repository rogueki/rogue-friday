import { createMockFactories } from "@friday/adapter-mock";
import { isMockApiError, MockWorld, ScenarioEngine } from "@friday/mock-data";
import type { RuntimeSimulation } from "../src/runtime/simulation";

export const simulation: RuntimeSimulation = {
  createWorld: (options) => new MockWorld(options),
  mockFactories: (world) => createMockFactories({ world }),
  engineFor: (world) => ScenarioEngine.for(world),
  isApiError: isMockApiError,
};
