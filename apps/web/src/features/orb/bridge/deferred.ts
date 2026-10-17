/**
 * A call-forwarding proxy that queues calls until its target exists. The realtime layer lives in the main bundle while
 * `@friday/orb` (three.js) is only loaded with the orb chunk; events that arrive before that are replayed in order
 * once the runtime attaches. The queue is bounded so a page that never mounts the orb cannot grow it without limit.
 */
export interface Deferred<T extends object> {
  readonly proxy: T;
  attach(target: T): void;
  detach(): void;
  readonly pending: number;
}

type Call = readonly [method: string, args: unknown[]];

export function createDeferred<T extends object>(maxQueue = 256): Deferred<T> {
  let target: T | null = null;
  let queue: Call[] = [];
  const proxy = new Proxy({} as T, {
    get(_object, property) {
      if (typeof property !== "string" || property === "then") return undefined;
      return (...args: unknown[]): unknown => {
        if (target) return (target as Record<string, (...a: unknown[]) => unknown>)[property]?.(...args);
        queue.push([property, args]);
        if (queue.length > maxQueue) queue = queue.slice(queue.length - maxQueue);
        return undefined;
      };
    },
  });
  return {
    proxy,
    attach(next) {
      target = next;
      const replay = queue;
      queue = [];
      for (const [method, args] of replay) (next as Record<string, (...a: unknown[]) => unknown>)[method]?.(...args);
    },
    detach() {
      target = null;
    },
    get pending() {
      return queue.length;
    },
  };
}
