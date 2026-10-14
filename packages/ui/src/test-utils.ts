import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-motion');
});

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

// jsdom lacks these browser APIs; components degrade gracefully, tests just need them to exist.
vi.stubGlobal('ResizeObserver', NoopObserver);
vi.stubGlobal('IntersectionObserver', NoopObserver);

if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

Element.prototype.scrollIntoView = function scrollIntoView(): void {};
// jsdom prints "not implemented" noise for canvas; Waveform handles a null context.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

/** Gives scroll containers a viewport height so TanStack Virtual renders rows in jsdom. */
export function mockElementSize(width: number, height: number): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: height });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: width });
  Element.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) } as DOMRect;
  };
}
