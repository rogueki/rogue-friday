import type { AdapterLifecycle as ContractLifecycle, HealthStatus } from "@jarvis/sdk";
import { AdapterError } from "./errors";

/** PLAN §10.6 plus RECOVERING (PLAN §10.7 "Health Recovery", §45.9), which the contract carries on the wire. */
export type AdapterLifecycleState = ContractLifecycle;

const TRANSITIONS: Readonly<Record<AdapterLifecycleState, readonly AdapterLifecycleState[]>> = {
  UNREGISTERED: ["INITIALIZING"],
  INITIALIZING: ["ONLINE", "DEGRADED", "OFFLINE", "STOPPING"],
  ONLINE: ["DEGRADED", "OFFLINE", "STOPPING"],
  DEGRADED: ["ONLINE", "OFFLINE", "STOPPING"],
  OFFLINE: ["RECOVERING", "INITIALIZING", "STOPPING"],
  RECOVERING: ["ONLINE", "DEGRADED", "OFFLINE", "STOPPING"],
  STOPPING: ["STOPPED"],
  STOPPED: ["INITIALIZING"],
};

export interface LifecycleChange {
  from: AdapterLifecycleState;
  to: AdapterLifecycleState;
  reason: string;
}

export const toContractLifecycle = (state: AdapterLifecycleState): ContractLifecycle => state;

export function toHealthStatus(state: AdapterLifecycleState): HealthStatus {
  switch (state) {
    case "ONLINE":
      return "online";
    case "DEGRADED":
      return "degraded";
    case "OFFLINE":
    case "RECOVERING":
    case "STOPPING":
    case "STOPPED":
      return "offline";
    default:
      return "unknown";
  }
}

/** Ports may be called in these states. DEGRADED still serves; OFFLINE/STOPPED fail fast. */
export const isServing = (state: AdapterLifecycleState): boolean =>
  state === "ONLINE" || state === "DEGRADED";

export class AdapterLifecycleMachine {
  private current: AdapterLifecycleState = "UNREGISTERED";
  private readonly listeners = new Set<(change: LifecycleChange) => void>();

  get state(): AdapterLifecycleState {
    return this.current;
  }

  canTransition(to: AdapterLifecycleState): boolean {
    return TRANSITIONS[this.current].includes(to);
  }

  /** Throws on an illegal transition: that is a programming error, not a runtime condition. */
  transition(to: AdapterLifecycleState, reason: string): LifecycleChange | undefined {
    if (to === this.current) return undefined;
    if (!this.canTransition(to)) {
      throw new AdapterError({
        code: "INTERNAL",
        message: `Ungültiger Lifecycle-Übergang ${this.current} -> ${to}.`,
        retryable: false,
        details: { from: this.current, to },
      });
    }
    const change: LifecycleChange = { from: this.current, to, reason };
    this.current = to;
    for (const listener of this.listeners) listener(change);
    return change;
  }

  onChange(listener: (change: LifecycleChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
