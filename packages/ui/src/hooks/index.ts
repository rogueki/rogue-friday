import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export type MotionMode = 'full' | 'reduced' | 'off';

function readMotionMode(): MotionMode {
  if (typeof document === 'undefined') return 'full';
  const attr = document.documentElement.getAttribute('data-motion');
  if (attr === 'off' || attr === 'reduced' || attr === 'full') return attr;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced';
  }
  return 'full';
}

/**
 * Effective motion mode: in-app setting (`data-motion` on <html>) wins; otherwise the OS preference.
 * Components animate continuously only when `animate` is true (mode === 'full').
 */
export function useMotionMode(): { mode: MotionMode; animate: boolean; reduced: boolean } {
  const [mode, setMode] = useState<MotionMode>(readMotionMode);
  useEffect(() => {
    setMode(readMotionMode());
    const observer = new MutationObserver(() => setMode(readMotionMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const onChange = (): void => setMode(readMotionMode());
    mq?.addEventListener('change', onChange);
    return () => {
      observer.disconnect();
      mq?.removeEventListener('change', onChange);
    };
  }, []);
  return { mode, animate: mode === 'full', reduced: mode !== 'full' };
}

export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = useState(defaultValue);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = (): void => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Controlled/uncontrolled state helper. */
export function useControllable<T>(
  controlled: T | undefined,
  defaultValue: T,
  onChange?: (value: T) => void,
): [T, (value: T) => void] {
  const [inner, setInner] = useState(defaultValue);
  const isControlled = controlled !== undefined;
  const value = isControlled ? controlled : inner;
  const set = useCallback(
    (next: T) => {
      if (!isControlled) setInner(next);
      onChange?.(next);
    },
    [isControlled, onChange],
  );
  return [value, set];
}

/** Observes element width via ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(ref: RefObject<T | null>, initial = 0): number {
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Focus trap while `active`: moves focus inside, loops Tab / Shift+Tab, restores focus to the
 * previously focused element on deactivation, and calls `onEscape` on Esc.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  options: { onEscape?: () => void; initialFocus?: RefObject<HTMLElement | null> } = {},
): void {
  const { onEscape, initialFocus } = options;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = initialFocus?.current ?? getFocusable(root)[0] ?? root;
    target.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        escapeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = getFocusable(root);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !root.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !root.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus?.({ preventScroll: true });
    };
  }, [active, ref, initialFocus]);
}

let lockCount = 0;
let previousOverflow = '';

/** Locks body scroll while `active` (reference counted for stacked overlays). */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (lockCount === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) document.body.style.overflow = previousOverflow;
    };
  }, [active]);
}

export function useStableId(prefix = 'jv'): string {
  return `${prefix}-${useId().replace(/:/g, '')}`;
}

/** Ticking clock; pass `fixed` to freeze (stories, tests). */
export function useNow(intervalMs = 1000, fixed?: Date): Date {
  const [now, setNow] = useState<Date>(() => fixed ?? new Date());
  useEffect(() => {
    if (fixed) {
      setNow(fixed);
      return;
    }
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [fixed, intervalMs]);
  return fixed ?? now;
}
