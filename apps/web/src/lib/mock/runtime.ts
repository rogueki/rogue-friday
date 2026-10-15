import type { TransportFactory } from "../realtime/transport";

/** True when the build/dev server was started for the standalone mock mode (`NEXT_PUBLIC_FRIDAY_MSW=1`). */
export const isStandaloneMock = (): boolean => process.env.NEXT_PUBLIC_FRIDAY_MSW === "1";

interface MockRuntime {
  transportFactory: TransportFactory;
}

let runtime: MockRuntime | null = null;

export function setMockRuntime(next: MockRuntime | null): void {
  runtime = next;
}

/** Event transport of the in-browser mock world; `null` outside of the standalone mock mode. */
export function getMockTransportFactory(): TransportFactory | null {
  return runtime?.transportFactory ?? null;
}
