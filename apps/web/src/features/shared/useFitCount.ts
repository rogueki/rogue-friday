"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * How many rows of `rowHeight` (+ `gap`) fit into the element, so lists in fixed-height dashboard panels show whole rows
 * instead of a clipped half row. Returns a callback ref (the element only exists in the panel's `ready` state, after
 * loading) and the count. Before the first measurement (and in jsdom, which has no layout) everything is shown.
 */
export function useFitCount<T extends HTMLElement>(rowHeight: number, gap = 0): [(node: T | null) => void, number] {
  const [element, setElement] = useState<T | null>(null);
  const [count, setCount] = useState(Number.POSITIVE_INFINITY);
  const ref = useCallback((node: T | null) => setElement(node), []);
  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = (): void => {
      const height = element.clientHeight;
      if (height > 0) setCount(Math.max(1, Math.floor((height + gap) / (rowHeight + gap))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, rowHeight, gap]);
  return [ref, count];
}
