"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import "./activity.css";

export interface VirtualListProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  rowHeight: number;
  gap?: number;
  overscan?: number;
  /** Accessible name; `role` is `list` for the flat feed and `tree` for the activity tree. */
  label: string;
  role?: "list" | "tree";
  renderRow: (item: T, index: number) => ReactNode;
  /** Newest item first: while on, the view stays pinned to the top as events arrive. */
  autoScroll?: boolean;
  /** Called when the user scrolls away from the top (autoscroll switches itself off). */
  onUserScroll?: () => void;
  /** Called when the last rows come into view (older pages). */
  onEndReached?: () => void;
  className?: string;
}

/**
 * Windowed list for the live feed: only the visible rows plus overscan exist in the DOM, so 10 000 events stay smooth
 * (PLAN §29, §51.6). Fixed row height keeps the virtualizer free of measurements. Arrow keys move the focus by row.
 */
export function VirtualList<T>({
  items,
  getKey,
  rowHeight,
  gap = 6,
  overscan = 10,
  label,
  role = "list",
  renderRow,
  autoScroll = false,
  onUserScroll,
  onEndReached,
  className,
}: VirtualListProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight + gap,
    overscan,
    // jsdom (tests) has no layout: a viewport of 800 px keeps a deterministic window.
    initialRect: { width: 0, height: 800 },
    getItemKey: (index) => {
      const item = items[index];
      return item === undefined ? index : getKey(item);
    },
  });

  const newestKey = items.length > 0 ? getKey(items[0] as T) : null;
  useEffect(() => {
    if (autoScroll && newestKey !== null) virtualizer.scrollToOffset(0);
  }, [autoScroll, newestKey, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.length > 0 ? (virtualItems[virtualItems.length - 1] as { index: number }).index : -1;
  useEffect(() => {
    if (onEndReached && items.length > 0 && lastIndex >= items.length - 3) onEndReached();
  }, [lastIndex, items.length, onEndReached]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const target = event.target as HTMLElement;
    const slot = target.closest<HTMLElement>("[data-index]");
    if (!slot) return;
    const current = Number(slot.dataset.index);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : current + (event.key === "ArrowDown" ? 1 : -1);
    if (next < 0 || next >= items.length) return;
    event.preventDefault();
    virtualizer.scrollToIndex(next, { align: "auto" });
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-index="${next}"] [data-row-focus]`)?.focus();
    });
  };

  return (
    <div
      ref={scrollRef}
      className={className ? `ac-vlist ${className}` : "ac-vlist"}
      role={role}
      aria-label={label}
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        if (autoScroll && event.currentTarget.scrollTop > rowHeight * 2) onUserScroll?.();
      }}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualItems.map((virtualItem) => {
          const item = items[virtualItem.index];
          if (item === undefined) return null;
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              role={role === "list" ? "listitem" : "none"}
              aria-posinset={role === "list" ? virtualItem.index + 1 : undefined}
              aria-setsize={role === "list" ? items.length : undefined}
              className="ac-vlist__slot"
              style={{ position: "absolute", top: 0, left: 0, width: "100%", height: rowHeight, transform: `translateY(${virtualItem.start}px)` }}
            >
              {renderRow(item, virtualItem.index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
