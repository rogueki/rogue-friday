import { WebSocketTransport, type TransportFactory } from "../realtime/transport";
import { setMockRuntime } from "./runtime";

declare global {
  interface Window {
    /** Mock platform handle for the browser console and the Playwright scripts (scenario control, world access). */
    __fridayMock?: unknown;
  }
}

/**
 * Standalone mock mode (`NEXT_PUBLIC_FRIDAY_MSW=1`): msw answers every /api/v1 request from the deterministic MockWorld and
 * the event stream is the in-memory socket of the same world. Imported dynamically so none of it ships in normal builds.
 */
export function startMocks(): Promise<void> {
  // React StrictMode runs effects twice in dev; msw must be started exactly once per page.
  startPromise ??= start();
  return startPromise;
}

let startPromise: Promise<void> | null = null;

async function start(): Promise<void> {
  const { setupBrowserMocks } = await import("@friday/mock-data");
  const platform = await setupBrowserMocks({ serviceWorkerUrl: "/mockServiceWorker.js" });
  const transportFactory: TransportFactory = ({ url }) =>
    new WebSocketTransport(url, (target) => new platform.eventSource.WebSocketImpl(target) as unknown as WebSocket);
  setMockRuntime({ transportFactory });
  window.__fridayMock = platform;
}
