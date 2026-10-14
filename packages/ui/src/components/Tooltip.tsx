import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../cx';
import { useStableId } from '../hooks';

export interface TooltipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'content'> {
  content: ReactNode;
  children: ReactElement<{ 'aria-describedby'?: string }>;
  placement?: 'top' | 'right' | 'bottom' | 'left';
  /** Delay in ms before showing on hover (focus shows immediately). */
  delay?: number;
  disabled?: boolean;
}

interface Pos {
  top: number;
  left: number;
}

/** Portal tooltip positioned with fixed coordinates, so it is never clipped by scroll containers. */
export function Tooltip({ content, children, placement = 'top', delay = 220, disabled = false, className, ...rest }: TooltipProps) {
  const id = useStableId('jv-tip');
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);

  const show = useCallback(
    (immediate: boolean) => {
      if (disabled) return;
      window.clearTimeout(timer.current);
      if (immediate) setOpen(true);
      else timer.current = window.setTimeout(() => setOpen(true), delay);
    },
    [delay, disabled],
  );
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const gap = 8;
    let top = a.top - t.height - gap;
    let left = a.left + a.width / 2 - t.width / 2;
    if (placement === 'bottom') top = a.bottom + gap;
    if (placement === 'right') {
      top = a.top + a.height / 2 - t.height / 2;
      left = a.right + gap;
    }
    if (placement === 'left') {
      top = a.top + a.height / 2 - t.height / 2;
      left = a.left - t.width - gap;
    }
    left = Math.max(6, Math.min(left, window.innerWidth - t.width - 6));
    top = Math.max(6, Math.min(top, window.innerHeight - t.height - 6));
    setPos({ top, left });
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, placement, hide, content]);

  const child = isValidElement(children)
    ? cloneElement(children, { 'aria-describedby': open ? id : children.props['aria-describedby'] })
    : children;

  return (
    <>
      <span
        ref={anchorRef}
        className={cx('jv-tooltip-anchor', className)}
        onMouseEnter={() => show(false)}
        onMouseLeave={hide}
        onFocus={() => show(true)}
        onBlur={hide}
        {...rest}
      >
        {child}
      </span>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={tipRef}
              id={id}
              role="tooltip"
              className="jv-tooltip"
              style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
