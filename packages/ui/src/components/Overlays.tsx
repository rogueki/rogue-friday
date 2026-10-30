import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CornerDownLeft, Search, ShieldAlert, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../cx';
import { useFocusTrap, useMotionMode, useScrollLock, useStableId } from '../hooks';
import type { Tone } from '../types';
import { Button, IconButton, IconTile } from './Primitives';
import { HudPanel, HudPanelHeader } from './Panel';

const EASE = [0.2, 0.8, 0.2, 1] as const;

/* ── Overlay base ───────────────────────────────────────────────────────── */

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  /** Esc handler; defaults to onClose. Lets nested flows step back first. */
  onEscape?: () => void;
  placement?: 'center' | 'right' | 'left' | 'top';
  role?: 'dialog' | 'alertdialog';
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  closeOnScrim?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}

function OverlayLayer({ onClose, onEscape, placement = 'center', role = 'dialog', label, labelledBy, describedBy, closeOnScrim = true, initialFocusRef, returnFocusRef, className, children }: Omit<OverlayProps, 'open'>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { animate } = useMotionMode();
  useFocusTrap(panelRef, true, { onEscape: onEscape ?? onClose, initialFocus: initialFocusRef, returnFocus: returnFocusRef });
  useScrollLock(true);

  const dur = animate ? 0.26 : 0;
  const offset = placement === 'right' ? { x: 48 } : placement === 'left' ? { x: -48 } : placement === 'top' ? { y: -24 } : { y: 10, scale: 0.985 };

  return (
    <div className={cx('jv-overlay', `jv-overlay--${placement}`)}>
      <motion.div
        className="jv-overlay__scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: animate ? 0.2 : 0 }}
        onMouseDown={closeOnScrim ? onClose : undefined}
        aria-hidden="true"
      />
      <motion.div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cx('jv-overlay__panel', className)}
        initial={{ opacity: 0, ...offset }}
        animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
        exit={{ opacity: 0, ...offset }}
        transition={{ duration: dur, ease: EASE }}
      >
        {children}
      </motion.div>
    </div>
  );
}

function Overlay({ open, ...rest }: OverlayProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(<AnimatePresence>{open ? <OverlayLayer key="layer" {...rest} /> : null}</AnimatePresence>, document.body);
}

/* ── Dialog ─────────────────────────────────────────────────────────────── */

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: 'cyan' | 'amber' | 'red' | 'gold';
  size?: 'sm' | 'md' | 'lg';
  children?: ReactNode;
  footer?: ReactNode;
  /** Set false for flows that must be answered (no scrim click / Esc / close button). */
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  closeLabel?: string;
  role?: 'dialog' | 'alertdialog';
  className?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  icon,
  tone = 'cyan',
  size = 'md',
  children,
  footer,
  dismissible = true,
  initialFocusRef,
  returnFocusRef,
  closeLabel = 'Schließen',
  role = 'dialog',
  className,
}: DialogProps) {
  const id = useStableId('jv-dialog');
  const close = useCallback(() => {
    if (dismissible) onOpenChange(false);
  }, [dismissible, onOpenChange]);
  return (
    <Overlay
      open={open}
      onClose={close}
      role={role}
      labelledBy={`${id}-title`}
      describedBy={description ? `${id}-desc` : undefined}
      initialFocusRef={initialFocusRef}
      returnFocusRef={returnFocusRef}
      closeOnScrim={dismissible}
      className={cx('jv-dialog', `jv-dialog--${size}`, className)}
    >
      <HudPanel
        as="div"
        level={tone === 'amber' || tone === 'red' ? 3 : 2}
        tone={tone}
        glow
        cut="all"
        padding="none"
        brackets={false}
        className="jv-dialog__panel"
        header={
          <HudPanelHeader
            titleId={`${id}-title`}
            title={title}
            icon={icon}
            actions={dismissible ? <IconButton label={closeLabel} icon={<X size={16} strokeWidth={1.5} />} size="sm" onClick={() => onOpenChange(false)} /> : null}
          />
        }
        footer={footer ? <div className="jv-dialog__footer">{footer}</div> : null}
      >
        {description ? (
          <p id={`${id}-desc`} className="jv-dialog__desc">
            {description}
          </p>
        ) : null}
        {children ? <div className="jv-dialog__body">{children}</div> : null}
      </HudPanel>
    </Overlay>
  );
}

/* ── ConfirmDialog ──────────────────────────────────────────────────────── */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What exactly will happen ("Du bist dabei: …"). */
  description: ReactNode;
  /** Optional list of affected objects/impact lines. */
  details?: readonly string[];
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  loading?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  details,
  confirmLabel = 'Bestätigen',
  cancelLabel = 'Abbrechen',
  tone = 'default',
  loading = false,
  returnFocusRef,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      role="alertdialog"
      size="sm"
      tone={tone === 'danger' ? 'red' : 'amber'}
      icon={tone === 'danger' ? <ShieldAlert size={16} strokeWidth={1.5} /> : <AlertTriangle size={16} strokeWidth={1.5} />}
      description={description}
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {details && details.length > 0 ? (
        <ul className="jv-dialog__details">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
    </Dialog>
  );
}

/* ── Drawer ─────────────────────────────────────────────────────────────── */

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  side?: 'right' | 'left';
  width?: number | string;
  children?: ReactNode;
  footer?: ReactNode;
  /** Unstyled mode: render children directly without header (used for the mobile nav). */
  bare?: boolean;
  closeLabel?: string;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function Drawer({ open, onOpenChange, title, subtitle, icon, side = 'right', width = 440, children, footer, bare = false, closeLabel = 'Schließen', className, initialFocusRef }: DrawerProps) {
  const id = useStableId('jv-drawer');
  return (
    <Overlay
      open={open}
      onClose={() => onOpenChange(false)}
      placement={side}
      labelledBy={bare ? undefined : `${id}-title`}
      label={bare ? title : undefined}
      initialFocusRef={initialFocusRef}
      className={cx('jv-drawer', `jv-drawer--${side}`, bare && 'jv-drawer--bare', className)}
    >
      <div className="jv-drawer__surface" style={{ width: typeof width === 'number' ? `${width}px` : width }}>
        {bare ? (
          children
        ) : (
          <>
            <HudPanelHeader
              className="jv-drawer__header"
              titleId={`${id}-title`}
              title={title}
              subtitle={subtitle}
              icon={icon}
              actions={<IconButton label={closeLabel} icon={<X size={16} strokeWidth={1.5} />} size="sm" onClick={() => onOpenChange(false)} />}
            />
            <div className="jv-drawer__body">{children}</div>
            {footer ? <div className="jv-drawer__footer">{footer}</div> : null}
          </>
        )}
      </div>
    </Overlay>
  );
}

/* ── CommandPalette ─────────────────────────────────────────────────────── */

export interface CommandPreview {
  /** Plain-language impact ("E-Mail an Max Muster senden"). */
  title: string;
  lines?: readonly string[];
  warning?: string;
}

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  group?: string;
  keywords?: readonly string[];
  shortcut?: string;
  disabled?: boolean;
  /** Shown when disabled (missing capability, read-only …). */
  disabledReason?: string;
  /** Writes / critical: needs an explicit second confirmation with preview (§43.4). */
  critical?: boolean;
  preview?: CommandPreview;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly CommandItem[];
  onSelect: (item: CommandItem) => void;
  placeholder?: string;
  label?: string;
  emptyLabel?: string;
  /** Group display order; groups not listed follow in first-seen order. */
  groupOrder?: readonly string[];
  /** Controlled query (optional). */
  query?: string;
  onQueryChange?: (query: string) => void;
  labels?: {
    navigate?: string;
    select?: string;
    close?: string;
    confirmTitle?: string;
    confirm?: string;
    back?: string;
    results?: (n: number) => string;
    previewEmpty?: string;
  };
}

function normalise(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Subsequence fuzzy score: prefix and word-start hits rank highest; -1 = no match. */
export function fuzzyScore(query: string, text: string): number {
  const q = normalise(query).trim();
  if (!q) return 0;
  const t = normalise(text);
  const idx = t.indexOf(q);
  if (idx === 0) return 1000 - t.length;
  if (idx > 0) return (t[idx - 1] === ' ' ? 800 : 600) - idx;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    streak = found === ti ? streak + 1 : 0;
    score += 10 + streak * 4 - Math.min(8, found - ti);
    ti = found + 1;
  }
  return score;
}

function scoreItem(query: string, item: CommandItem): number {
  if (!query.trim()) return 0;
  const parts = [fuzzyScore(query, item.label), ...(item.keywords ?? []).map((k) => fuzzyScore(query, k) - 50), item.description ? fuzzyScore(query, item.description) - 200 : -1];
  return Math.max(...parts);
}

const defaultPaletteLabels = {
  navigate: 'Navigieren',
  select: 'Auswählen',
  close: 'Schließen',
  confirmTitle: 'Du bist dabei:',
  confirm: 'Bestätigen',
  back: 'Zurück',
  results: (n: number) => (n === 1 ? '1 Ergebnis' : `${n} Ergebnisse`),
  previewEmpty: 'Wähle einen Befehl, um die Vorschau zu sehen.',
};

export function CommandPalette({
  open,
  onOpenChange,
  items,
  onSelect,
  placeholder = 'Befehl oder Suchbegriff eingeben …',
  label = 'Befehlspalette',
  emptyLabel = 'Keine Treffer',
  groupOrder,
  query: queryProp,
  onQueryChange,
  labels: labelsProp,
}: CommandPaletteProps) {
  const labels = { ...defaultPaletteLabels, ...labelsProp };
  const [innerQuery, setInnerQuery] = useState('');
  const query = queryProp ?? innerQuery;
  const setQuery = (value: string): void => {
    if (queryProp === undefined) setInnerQuery(value);
    onQueryChange?.(value);
  };
  // The cursor follows the command, not its position: results that arrive later may be inserted above it, and Enter
  // must still run what was shown as selected. null means "the first item".
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pending, setPending] = useState<CommandItem | null>(null);
  const baseId = useStableId('jv-cmd');
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setInnerQuery('');
      setActiveKey(null);
      setPending(null);
    }
  }, [open]);

  const groups = useMemo(() => {
    const scored = items
      .map((item, index) => ({ item, index, score: scoreItem(query, item) }))
      .filter((s) => !query.trim() || s.score >= 0);
    const byGroup = new Map<string, typeof scored>();
    for (const entry of scored) {
      const key = entry.item.group ?? '';
      const list = byGroup.get(key);
      if (list) list.push(entry);
      else byGroup.set(key, [entry]);
    }
    const keys = [...byGroup.keys()];
    keys.sort((a, b) => {
      const ia = groupOrder?.indexOf(a) ?? -1;
      const ib = groupOrder?.indexOf(b) ?? -1;
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      if (!query.trim()) return 0;
      const best = (k: string): number => Math.max(...(byGroup.get(k) ?? []).map((e) => e.score));
      return best(b) - best(a);
    });
    return keys.map((key) => ({
      key,
      entries: (byGroup.get(key) ?? []).slice().sort((a, b) => (query.trim() ? b.score - a.score : 0) || a.index - b.index),
    }));
  }, [items, query, groupOrder]);

  const flat = useMemo(() => groups.flatMap((g) => g.entries.map((e) => e.item)), [groups]);
  const keyIndex = activeKey === null ? -1 : flat.findIndex((item) => item.id === activeKey);
  const active = keyIndex >= 0 ? keyIndex : 0;
  const activeItem = flat[active];
  const activeId = activeItem ? `${baseId}-opt-${activeItem.id}` : undefined;
  const setActive = (next: number | ((current: number) => number)): void => {
    const index = typeof next === 'function' ? next(active) : next;
    setActiveKey(flat[index]?.id ?? null);
  };

  useEffect(() => {
    // Pin the item shown as selected (the first one, or the fallback for a vanished one) so later inserts keep it.
    if (activeItem && activeItem.id !== activeKey) setActiveKey(activeItem.id);
  }, [activeItem, activeKey]);

  useEffect(() => {
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const choose = (item: CommandItem): void => {
    if (item.disabled) return;
    if (item.critical && !pending) {
      setPending(item);
      return;
    }
    setPending(null);
    onSelect(item);
    onOpenChange(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (pending) {
      if (event.key === 'Enter') {
        event.preventDefault();
        choose(pending);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        setPending(null);
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((a) => (flat.length === 0 ? 0 : (a + 1) % flat.length));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((a) => (flat.length === 0 ? 0 : (a - 1 + flat.length) % flat.length));
        break;
      case 'Home':
        if (event.ctrlKey) {
          event.preventDefault();
          setActive(0);
        }
        break;
      case 'End':
        if (event.ctrlKey) {
          event.preventDefault();
          setActive(Math.max(0, flat.length - 1));
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (activeItem) choose(activeItem);
        break;
      default:
    }
  };

  const previewItem = pending ?? activeItem;
  let optionIndex = -1;
  const listId = `${baseId}-list`;

  return (
    <Overlay
      open={open}
      onClose={() => onOpenChange(false)}
      onEscape={() => (pending ? setPending(null) : onOpenChange(false))}
      placement="top"
      label={label}
      initialFocusRef={inputRef}
      className="jv-palette"
    >
      <HudPanel as="div" level={2} glow cut="all" padding="none" brackets={false} className="jv-palette__panel">
        <div className="jv-palette__search">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={label}
            autoComplete="off"
            spellCheck={false}
            className="jv-palette__input"
            placeholder={placeholder}
            value={query}
            readOnly={Boolean(pending)}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveKey(null);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="jv-kbd">Esc</kbd>
        </div>
        <div className="jv-palette__main">
          <div ref={listRef} id={listId} role="listbox" aria-label={label} className="jv-palette__list">
            {flat.length === 0 ? (
              <div className="jv-palette__empty" role="presentation">
                {emptyLabel}
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.key} role="group" aria-label={group.key || undefined} className="jv-palette__group">
                  {group.key ? (
                    <div className="jv-palette__group-title" aria-hidden="true">
                      {group.key}
                    </div>
                  ) : null}
                  {group.entries.map(({ item }) => {
                    optionIndex += 1;
                    const index = optionIndex;
                    const selected = index === active;
                    return (
                      <div
                        key={item.id}
                        id={`${baseId}-opt-${item.id}`}
                        role="option"
                        aria-selected={selected}
                        aria-disabled={item.disabled || undefined}
                        className={cx('jv-palette__option', selected && 'jv-palette__option--active', item.disabled && 'jv-palette__option--disabled', item.critical && 'jv-palette__option--critical')}
                        onMouseMove={() => !pending && setActive(index)}
                        onClick={() => choose(item)}
                      >
                        {item.icon ? <IconTile icon={item.icon} tone={item.critical ? 'amber' : 'cyan'} size="sm" /> : null}
                        <span className="jv-palette__label">
                          <span className="jv-palette__title">{item.label}</span>
                          {item.disabled && item.disabledReason ? <span className="jv-palette__reason">{item.disabledReason}</span> : item.description ? <span className="jv-palette__sub">{item.description}</span> : null}
                        </span>
                        {item.critical ? <span className="jv-palette__crit">Schreibend</span> : null}
                        {item.shortcut ? <kbd className="jv-kbd">{item.shortcut}</kbd> : null}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <aside className="jv-palette__preview" aria-label="Vorschau">
            {pending ? (
              <div className="jv-palette__confirm" role="group" aria-label={labels.confirmTitle}>
                <span className="jv-palette__confirm-kicker">{labels.confirmTitle}</span>
                <strong className="jv-palette__confirm-title">{pending.preview?.title ?? pending.label}</strong>
                {pending.preview?.lines?.map((line) => (
                  <span key={line} className="jv-palette__confirm-line">
                    {line}
                  </span>
                ))}
                {pending.preview?.warning ? (
                  <span className="jv-palette__confirm-warn">
                    <AlertTriangle size={13} strokeWidth={1.75} aria-hidden="true" /> {pending.preview.warning}
                  </span>
                ) : null}
                <div className="jv-palette__confirm-actions">
                  <Button size="sm" variant="primary" onClick={() => choose(pending)}>
                    {labels.confirm}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
                    {labels.back}
                  </Button>
                </div>
              </div>
            ) : previewItem ? (
              <div className="jv-palette__previewbody">
                <strong>{previewItem.preview?.title ?? previewItem.label}</strong>
                {previewItem.description ? <span>{previewItem.description}</span> : null}
                {previewItem.preview?.lines?.map((l) => (
                  <span key={l}>{l}</span>
                ))}
                {previewItem.critical ? <span className="jv-palette__confirm-warn">Erfordert Bestätigung vor der Ausführung.</span> : null}
              </div>
            ) : (
              <span className="jv-palette__previewempty">{labels.previewEmpty}</span>
            )}
          </aside>
        </div>
        <div className="jv-palette__foot">
          <span>
            <kbd className="jv-kbd">↑</kbd>
            <kbd className="jv-kbd">↓</kbd> {labels.navigate}
          </span>
          <span>
            <kbd className="jv-kbd">
              <CornerDownLeft size={10} aria-hidden="true" />
            </kbd>{' '}
            {pending ? labels.confirm : labels.select}
          </span>
          <span>
            <kbd className="jv-kbd">Esc</kbd> {pending ? labels.back : labels.close}
          </span>
        </div>
        <div className="jv-sr-only" role="status" aria-live="polite">
          {labels.results(flat.length)}
        </div>
      </HudPanel>
    </Overlay>
  );
}

/* ── Toast / Toaster ────────────────────────────────────────────────────── */

export interface ToastData {
  id: string;
  title: string;
  description?: string;
  tone?: Tone;
  /** ms; 0 = stays until dismissed. Default 6000. */
  duration?: number;
  action?: { label: string; onClick: () => void };
  icon?: ReactNode;
}

function ToastItem({ toast, onDismiss }: { toast: ToastData; onDismiss: (id: string) => void }) {
  const tone = toast.tone ?? 'cyan';
  const duration = toast.duration ?? 6000;
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (duration <= 0 || paused) return;
    const t = window.setTimeout(() => onDismiss(toast.id), duration);
    return () => window.clearTimeout(t);
  }, [duration, paused, toast.id, onDismiss]);
  const urgent = tone === 'red' || tone === 'amber';
  return (
    <motion.li
      layout
      className={cx('jv-toast', `jv-tone-${tone}`)}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.2, ease: EASE }}
      role={urgent ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {toast.icon ? <IconTile icon={toast.icon} tone={tone} size="sm" /> : <span className="jv-toast__bar" aria-hidden="true" />}
      <div className="jv-toast__text">
        <span className="jv-toast__title">{toast.title}</span>
        {toast.description ? <span className="jv-toast__desc">{toast.description}</span> : null}
      </div>
      {toast.action ? (
        <Button size="sm" variant="ghost" onClick={toast.action.onClick}>
          {toast.action.label}
        </Button>
      ) : null}
      <IconButton label="Hinweis schließen" icon={<X size={14} strokeWidth={1.75} />} size="sm" onClick={() => onDismiss(toast.id)} />
    </motion.li>
  );
}

export interface ToasterProps {
  toasts: readonly ToastData[];
  onDismiss: (id: string) => void;
  label?: string;
  position?: 'bottom-right' | 'top-right';
}

export function Toaster({ toasts, onDismiss, label = 'Benachrichtigungen', position = 'bottom-right' }: ToasterProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <section aria-label={label} className={cx('jv-toaster', `jv-toaster--${position}`)}>
      <ul className="jv-toaster__list">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
          ))}
        </AnimatePresence>
      </ul>
    </section>,
    document.body,
  );
}

interface ToastContextValue {
  toast: (data: Omit<ToastData, 'id'> & { id?: string }) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children, max = 4, position }: { children: ReactNode; max?: number; position?: ToasterProps['position'] }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const counter = useRef(0);
  const dismiss = useCallback((id: string) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const toast = useCallback(
    (data: Omit<ToastData, 'id'> & { id?: string }) => {
      counter.current += 1;
      const id = data.id ?? `toast-${counter.current}`;
      setToasts((list) => [...list.filter((t) => t.id !== id), { ...data, id }].slice(-max));
      return id;
    },
    [max],
  );
  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} position={position} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

