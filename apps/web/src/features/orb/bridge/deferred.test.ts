import { describe, expect, it } from "vitest";
import { createDeferred } from "./deferred";

interface Target {
  ping(value: number): void;
}

describe("createDeferred", () => {
  it("queues calls until a target attaches and replays them in order", () => {
    const deferred = createDeferred<Target>();
    deferred.proxy.ping(1);
    deferred.proxy.ping(2);
    expect(deferred.pending).toBe(2);
    const seen: number[] = [];
    deferred.attach({ ping: (value) => seen.push(value) });
    expect(seen).toEqual([1, 2]);
    deferred.proxy.ping(3);
    expect(seen).toEqual([1, 2, 3]);
    expect(deferred.pending).toBe(0);
  });

  it("drops the oldest calls beyond the queue bound", () => {
    const deferred = createDeferred<Target>(3);
    for (let i = 1; i <= 5; i += 1) deferred.proxy.ping(i);
    const seen: number[] = [];
    deferred.attach({ ping: (value) => seen.push(value) });
    expect(seen).toEqual([3, 4, 5]);
  });

  it("queues again after detach and is not mistaken for a thenable", () => {
    const deferred = createDeferred<Target>();
    const seen: number[] = [];
    deferred.attach({ ping: (value) => seen.push(value) });
    deferred.detach();
    deferred.proxy.ping(9);
    expect(seen).toEqual([]);
    expect((deferred.proxy as unknown as { then?: unknown }).then).toBeUndefined();
  });
});
