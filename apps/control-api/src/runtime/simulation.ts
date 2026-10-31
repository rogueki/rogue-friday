import type { AdapterFactory } from "@friday/adapter-core";
import type { MockApiError, MockWorld, ScenarioEngine } from "@friday/mock-data";

export type SimulationWorldOptions = NonNullable<ConstructorParameters<typeof MockWorld>[0]>;

/**
 * Mock world, scenario engine and mock adapters for tests and the e2e server. Only test entry points provide it (see
 * `test-support/simulation.ts`); the shipped server has none, so the mock packages never reach `dist/main.js`.
 */
export interface RuntimeSimulation {
  createWorld(options: SimulationWorldOptions): MockWorld;
  mockFactories(world: MockWorld): AdapterFactory[];
  engineFor(world: MockWorld): ScenarioEngine;
  isApiError(error: unknown): error is MockApiError;
}
