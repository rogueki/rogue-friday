import { ScenarioEngine } from "../scenarios/engine";
import { MockEventHub } from "../stream/hub";
import { createMockEventSource, type MockEventSourceHandle } from "../stream/socket";
import { MockWorld, type MockWorldOptions } from "../world/world";
import { createMswHandlers, type MswHandlerOptions } from "./handlers";

export interface MockPlatformOptions extends MockWorldOptions {
  world?: MockWorld;
  handlers?: MswHandlerOptions;
  /** Start `jarvis.system.metrics` / `jarvis.agent.heartbeat` events (default: true in the browser, false in Node). */
  telemetry?: boolean;
}

export interface MockPlatform {
  world: MockWorld;
  engine: ScenarioEngine;
  hub: MockEventHub;
  eventSource: MockEventSourceHandle;
  stop(): void;
}

function createPlatform(options: MockPlatformOptions, defaults: { realTime: boolean; telemetry: boolean }): MockPlatform {
  const { world: given, handlers: _handlers, telemetry, ...worldOptions } = options;
  const world = given ?? new MockWorld({ ...worldOptions, realTime: worldOptions.realTime ?? defaults.realTime });
  if (given && (options.realTime ?? defaults.realTime)) world.clock.startRealTime();
  if (telemetry ?? defaults.telemetry) world.startTelemetry();
  const eventSource = createMockEventSource(world);
  return {
    world,
    engine: ScenarioEngine.for(world),
    hub: eventSource.hub,
    eventSource,
    stop: () => {
      eventSource.dispose();
      if (!given) world.dispose();
    },
  };
}

export interface BrowserMocks extends MockPlatform {
  worker: { stop(): void };
}

/**
 * Starts the mock platform in the browser: msw service worker for REST, fake WebSocket for the event stream, real-time
 * mock clock and telemetry. Dynamic imports keep `msw/browser` out of Node bundles.
 */
export async function setupBrowserMocks(options: MockPlatformOptions & { serviceWorkerUrl?: string; onUnhandledFrame?: "bypass" | "warn" | "error" } = {}): Promise<BrowserMocks> {
  const { serviceWorkerUrl, onUnhandledFrame = "bypass", ...platformOptions } = options;
  const { setupWorker } = await import("msw/browser");
  const platform = createPlatform(platformOptions, { realTime: true, telemetry: true });
  const worker = setupWorker(...createMswHandlers(platform.world, platformOptions.handlers));
  await worker.start({
    onUnhandledFrame,
    ...(serviceWorkerUrl ? { serviceWorker: { url: serviceWorkerUrl } } : {}),
  });
  const uninstall = platform.eventSource.install();
  // Dev console handle: `__JARVIS_MOCK__.engine.play("voice-pipeline")` in the browser console.
  (globalThis as { __JARVIS_MOCK__?: unknown }).__JARVIS_MOCK__ = { world: platform.world, engine: platform.engine, hub: platform.hub };
  return {
    ...platform,
    worker,
    stop: () => {
      uninstall();
      worker.stop();
      platform.stop();
    },
  };
}

export interface NodeMocks extends MockPlatform {
  server: { close(): void; resetHandlers(): void; use(...handlers: ReturnType<typeof createMswHandlers>): void };
}

/** msw/node server for Vitest, Storybook (node-side) and integration tests; the clock stays manual. */
export async function setupNodeMocks(options: MockPlatformOptions & { onUnhandledFrame?: "bypass" | "warn" | "error" } = {}): Promise<NodeMocks> {
  const { onUnhandledFrame = "bypass", ...platformOptions } = options;
  const { setupServer } = await import("msw/node");
  const platform = createPlatform(platformOptions, { realTime: false, telemetry: false });
  const server = setupServer(...createMswHandlers(platform.world, platformOptions.handlers));
  server.listen({ onUnhandledFrame });
  return {
    ...platform,
    server,
    stop: () => {
      server.close();
      platform.stop();
    },
  };
}
