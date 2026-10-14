import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown, X } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from '../cx';
import { useControllable, useElementWidth } from '../hooks';
import type { Severity, Tone } from '../types';
import { severityTone } from '../types';
import { IconTile, Skeleton, TagPill } from './Primitives';
import { SearchField, Select } from './Forms';

/* ── ActivityRow ────────────────────────────────────────────────────────── */

export interface ActivityRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'onClick'> {
  icon: ReactNode;
  tone?: Tone;
  title: string;
  /** Sub-line, coloured in the row's semantic tone (reference: "Meeting", "Overdue"). */
  meta?: string;
  severity?: Severity;
  /** Tag text; defaults to the severity label. */
  tag?: string;
  time?: string;
  /** Right-aligned inline action (e.g. a small button). */
  action?: ReactNode;
  onClick?: () => void;
  selected?: boolean;
}

const tagLabels: Record<Severity, string> = { info: 'INFO', tip: 'TIPP', warn: 'WARN', critical: 'KRIT', live: 'LIVE', ok: 'OK' };

export const ActivityRow = forwardRef<HTMLDivElement, ActivityRowProps>(function ActivityRow(
  { icon, tone, title, meta, severity, tag, time, action, onClick, selected, className, ...rest },
  ref,
) {
  const rowTone: Tone = tone ?? (severity ? severityTone[severity] : 'cyan');
  const tagText = tag ?? (severity ? tagLabels[severity] : undefined);
  return (
    <div
      ref={ref}
      className={cx('jv-row', `jv-tone-${rowTone}`, selected && 'jv-row--selected', onClick && 'jv-row--clickable', className)}
      data-severity={severity}
      {...(onClick
        ? {
            role: 'button',
            tabIndex: 0,
            onClick,
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            },
          }
        : {})}
      {...rest}
    >
      <IconTile icon={icon} tone={rowTone} size="md" />
      <div className="jv-row__main">
        <span className="jv-row__title" title={title}>
          {title}
        </span>
        {meta ? (
          <span className="jv-row__meta" title={meta}>
            {meta}
          </span>
        ) : null}
      </div>
      <div className="jv-row__side">
        {action ?? (tagText ? <TagPill tone={rowTone}>{tagText}</TagPill> : null)}
        {time ? <span className="jv-row__time">{time}</span> : null}
      </div>
    </div>
  );
});

/* ── ActivityFeed (virtualized) ─────────────────────────────────────────── */

export interface ActivityItem extends ActivityRowProps {
  id: string;
}

export interface ActivityFeedProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect'> {
  items: readonly ActivityItem[];
  /** Accessible name of the list. */
  label: string;
  /** Scroll viewport height in px; default fills the parent (needs a bounded parent). */
  height?: number | string;
  rowHeight?: number;
  gap?: number;
  overscan?: number;
  onSelect?: (id: string) => void;
  selectedId?: string;
  loading?: boolean;
  /** Shown when `items` is empty. */
  empty?: ReactNode;
  /** Number of rows in total on the server, if more than loaded. */
  totalCount?: number;
}

/** Windowed list: 10 000 rows render only the visible subset plus overscan. */
export const ActivityFeed = forwardRef<HTMLDivElement, ActivityFeedProps>(function ActivityFeed(
  { items, label, height = '100%', rowHeight = 54, gap = 6, overscan = 8, onSelect, selectedId, loading, empty, totalCount, className, style, ...rest },
  forwardedRef,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight + gap,
    overscan,
    initialRect: { width: 0, height: typeof height === 'number' ? height : 600 },
    getItemKey: (index) => items[index]?.id ?? index,
  });

  if (loading) {
    return (
      <div className={cx('jv-feed', className)} style={{ height, ...style }} aria-busy="true">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} variant="row" height={rowHeight} label="Aktivität wird geladen" />
        ))}
      </div>
    );
  }
  if (items.length === 0) return <div className={cx('jv-feed jv-feed--empty', className)} style={{ height, ...style }}>{empty}</div>;

  return (
    <div
      ref={setRefs}
      className={cx('jv-feed', className)}
      style={{ height, ...style }}
      role="list"
      aria-label={label}
      aria-rowcount={totalCount ?? items.length}
      tabIndex={0}
      {...rest}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const item = items[v.index];
          if (!item) return null;
          const { id, ...row } = item;
          return (
            <div
              key={v.key}
              role="listitem"
              aria-posinset={v.index + 1}
              aria-setsize={totalCount ?? items.length}
              className="jv-feed__slot"
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: rowHeight, transform: `translateY(${v.start}px)` }}
            >
              <ActivityRow {...row} selected={selectedId === id} onClick={onSelect ? () => onSelect(id) : row.onClick} />
            </div>
          );
        })}
      </div>
    </div>
  );
});

/* ── Timeline ───────────────────────────────────────────────────────────── */

export type TimelineStatus = 'done' | 'now' | 'upcoming' | 'blocked';

export interface TimelineItem {
  id: string;
  /** Pre-formatted time label, e.g. "09:30". */
  time: string;
  title: string;
  status: TimelineStatus;
  /** Right-aligned status text, e.g. "Erledigt", "in 42 Min.". */
  meta?: string;
  /** 0..100 progress under the title, null = unknown (hidden). */
  progress?: number | null;
  tone?: Tone;
}

export interface TimelineProps extends Omit<HTMLAttributes<HTMLOListElement>, 'onSelect'> {
  items: readonly TimelineItem[];
  label: string;
  onSelect?: (id: string) => void;
}

const timelineTone: Record<TimelineStatus, Tone> = { done: 'green', now: 'cyan', upcoming: 'amber', blocked: 'red' };
const timelineStatusText: Record<TimelineStatus, string> = { done: 'Erledigt', now: 'Läuft', upcoming: 'Geplant', blocked: 'Blockiert' };

export function Timeline({ items, label, onSelect, className, ...rest }: TimelineProps) {
  return (
    <ol className={cx('jv-timeline', className)} aria-label={label} {...rest}>
      {items.map((item) => {
        const tone = item.tone ?? timelineTone[item.status];
        const content = (
          <>
            <time className="jv-timeline__time">{item.time}</time>
            <span className={cx('jv-timeline__node', `jv-tone-${tone}`)} aria-hidden="true" />
            <div className="jv-timeline__main">
              <span className="jv-timeline__title" title={item.title}>
                {item.title}
              </span>
              {item.progress !== null && item.progress !== undefined ? (
                <span className={cx('jv-timeline__bar', `jv-tone-${tone}`)} aria-hidden="true">
                  <span style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }} />
                </span>
              ) : null}
            </div>
            <span className={cx('jv-timeline__meta', `jv-tone-${tone}`)}>
              <span className="jv-sr-only">{timelineStatusText[item.status]}: </span>
              {item.meta ?? timelineStatusText[item.status]}
            </span>
          </>
        );
        return (
          <li key={item.id} className={cx('jv-timeline__item', `jv-timeline__item--${item.status}`)} aria-current={item.status === 'now' ? 'step' : undefined}>
            {onSelect ? (
              <button type="button" className="jv-timeline__btn" onClick={() => onSelect(item.id)}>
                {content}
              </button>
            ) : (
              <div className="jv-timeline__btn">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ── DataTable ──────────────────────────────────────────────────────────── */

export type SortDirection = 'asc' | 'desc';
export interface SortState {
  columnId: string;
  direction: SortDirection;
}

export interface DataTableColumn<T> {
  id: string;
  header: string;
  /** Renders the cell; defaults to the stringified `sortValue`. */
  cell?: (row: T) => ReactNode;
  /** Value used for sorting (and default rendering). */
  sortValue?: (row: T) => string | number | null | undefined;
  sortable?: boolean;
  /** CSS grid track, e.g. "120px" or "minmax(0,2fr)". Default minmax(0,1fr). */
  width?: string;
  align?: 'left' | 'right' | 'center';
  mono?: boolean;
  /** Hide this column in card mode. */
  hideInCards?: boolean;
}

export interface DataTableProps<T> extends Omit<HTMLAttributes<HTMLDivElement>, 'onSelect' | 'children'> {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  getRowId: (row: T) => string;
  /** Accessible table name. */
  label: string;
  height?: number;
  rowHeight?: number;
  overscan?: number;
  sort?: SortState | null;
  defaultSort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  /** Rows are already sorted by the server; the table does not re-sort. */
  manualSort?: boolean;
  onRowActivate?: (row: T) => void;
  selectedId?: string;
  loading?: boolean;
  empty?: ReactNode;
  error?: ReactNode;
  /** Total rows on the server when `rows` is only a loaded subset. */
  totalCount?: number;
  mode?: 'auto' | 'table' | 'cards';
  cardBreakpoint?: number;
  /** Footer text builder, default "n von m Zeilen". */
  countLabel?: (shown: number, total: number) => string;
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

function compareValues(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const an = a === null || a === undefined || a === '';
  const bn = b === null || b === undefined || b === '';
  if (an && bn) return 0;
  if (an) return 1; // nulls last, regardless of direction
  if (bn) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  label,
  height = 420,
  rowHeight = 38,
  overscan = 8,
  sort: sortProp,
  defaultSort = null,
  onSortChange,
  manualSort = false,
  onRowActivate,
  selectedId,
  loading,
  empty,
  error,
  totalCount,
  mode = 'auto',
  cardBreakpoint = 560,
  countLabel = (shown, total) => (shown === total ? `${total.toLocaleString('de-DE')} Zeilen` : `${shown.toLocaleString('de-DE')} von ${total.toLocaleString('de-DE')} Zeilen`),
  className,
  style,
  ...rest
}: DataTableProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const baseId = useId().replace(/:/g, '');
  const width = useElementWidth(rootRef);
  const cards = mode === 'cards' || (mode === 'auto' && width > 0 && width < cardBreakpoint);
  const [sort, setSort] = useControllable<SortState | null>(sortProp, defaultSort, onSortChange);
  const [activeIndex, setActiveIndex] = useState(0);

  const sorted = useMemo(() => {
    if (manualSort || !sort) return rows;
    const col = columns.find((c) => c.id === sort.columnId);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const dir = sort.direction === 'asc' ? 1 : -1;
    // index tie-breaker keeps the order deterministic (no duplicated/missing rows between renders)
    return rows
      .map((row, index) => ({ row, index, value: get(row) }))
      .sort((x, y) => {
        const aNull = x.value === null || x.value === undefined || x.value === '';
        const bNull = y.value === null || y.value === undefined || y.value === '';
        if (aNull || bNull) return compareValues(x.value, y.value) || x.index - y.index;
        return dir * compareValues(x.value, y.value) || x.index - y.index;
      })
      .map((entry) => entry.row);
  }, [rows, columns, sort, manualSort]);

  const visibleColumns = cards ? columns.filter((c) => !c.hideInCards) : columns;
  const effectiveRowHeight = cards ? Math.max(rowHeight, visibleColumns.length * 22 + 18) : rowHeight;

  const virtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => effectiveRowHeight,
    overscan,
    initialRect: { width: 0, height },
    getItemKey: (index) => {
      const row = sorted[index];
      return row === undefined ? index : getRowId(row);
    },
  });

  useEffect(() => {
    virtualizer.measure();
  }, [effectiveRowHeight, virtualizer]);

  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, sorted.length - 1)));
  }, [sorted.length]);

  const template = visibleColumns.map((c) => c.width ?? 'minmax(0, 1fr)').join(' ');

  const toggleSort = (col: DataTableColumn<T>): void => {
    if (!col.sortable) return;
    if (!sort || sort.columnId !== col.id) setSort({ columnId: col.id, direction: 'asc' });
    else if (sort.direction === 'asc') setSort({ columnId: col.id, direction: 'desc' });
    else setSort(null);
  };

  const move = (next: number): void => {
    const clamped = Math.max(0, Math.min(sorted.length - 1, next));
    setActiveIndex(clamped);
    virtualizer.scrollToIndex(clamped, { align: 'auto' });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) return;
    const page = Math.max(1, Math.floor(height / effectiveRowHeight) - 1);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(activeIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(activeIndex - 1);
        break;
      case 'PageDown':
        event.preventDefault();
        move(activeIndex + page);
        break;
      case 'PageUp':
        event.preventDefault();
        move(activeIndex - page);
        break;
      case 'Home':
        event.preventDefault();
        move(0);
        break;
      case 'End':
        event.preventDefault();
        move(sorted.length - 1);
        break;
      case 'Enter':
      case ' ': {
        const row = sorted[activeIndex];
        if (row !== undefined && onRowActivate) {
          event.preventDefault();
          onRowActivate(row);
        }
        break;
      }
      default:
    }
  };

  if (error) return <div className={cx('jv-table jv-table--state', className)}>{error}</div>;
  if (loading) {
    return (
      <div className={cx('jv-table jv-table--state', className)} aria-busy="true" style={{ minHeight: Math.min(height, 200), ...style }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} variant="row" height={rowHeight - 6} label="Tabelle wird geladen" />
        ))}
      </div>
    );
  }
  if (sorted.length === 0) return <div className={cx('jv-table jv-table--state', className)}>{empty}</div>;

  const sortableColumns = columns.filter((c) => c.sortable);
  const total = totalCount ?? sorted.length;
  const activeRow = sorted[activeIndex];
  const activeId = activeRow === undefined ? undefined : `${baseId}-row-${getRowId(activeRow)}`;

  return (
    <div ref={rootRef} className={cx('jv-table', cards && 'jv-table--cards', className)} style={style} {...rest}>
      {cards && sortableColumns.length > 0 ? (
        <div className="jv-table__cardsort">
          <Select
            label="Sortieren nach"
            value={sort?.columnId ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              setSort(value ? { columnId: value, direction: sort?.direction ?? 'asc' } : null);
            }}
            options={[{ value: '', label: 'Standard' }, ...sortableColumns.map((c) => ({ value: c.id, label: c.header }))]}
          />
        </div>
      ) : null}
      <div
        ref={scrollRef}
        className="jv-table__scroll"
        style={{ height }}
        role="grid"
        aria-label={label}
        aria-rowcount={total + 1}
        aria-colcount={visibleColumns.length}
        aria-activedescendant={activeId}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {cards ? null : (
          <div role="row" aria-rowindex={1} className="jv-table__head" style={{ gridTemplateColumns: template }}>
            {visibleColumns.map((col) => {
              const dir = sort?.columnId === col.id ? sort.direction : null;
              return (
                <div
                  key={col.id}
                  role="columnheader"
                  aria-sort={dir ? (dir === 'asc' ? 'ascending' : 'descending') : col.sortable ? 'none' : undefined}
                  className={cx('jv-table__th', col.align && `jv-align-${col.align}`)}
                >
                  {col.sortable ? (
                    <button type="button" className="jv-table__sort" onClick={() => toggleSort(col)}>
                      <span>{col.header}</span>
                      {dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : dir === 'desc' ? <ArrowDown size={12} aria-hidden="true" /> : <ChevronsUpDown size={12} aria-hidden="true" />}
                    </button>
                  ) : (
                    <span>{col.header}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="jv-table__body" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((v) => {
            const row = sorted[v.index];
            if (row === undefined) return null;
            const id = getRowId(row);
            const isActive = v.index === activeIndex;
            return (
              <div
                key={v.key}
                id={`${baseId}-row-${id}`}
                role="row"
                aria-rowindex={v.index + 2}
                aria-selected={selectedId === undefined ? undefined : selectedId === id}
                data-active={isActive || undefined}
                className={cx('jv-table__row', onRowActivate && 'jv-table__row--clickable', selectedId === id && 'jv-table__row--selected', isActive && 'jv-table__row--active')}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: effectiveRowHeight, transform: `translateY(${v.start}px)`, gridTemplateColumns: cards ? undefined : template }}
                onClick={() => {
                  setActiveIndex(v.index);
                  onRowActivate?.(row);
                }}
              >
                {visibleColumns.map((col) => (
                  <div key={col.id} role="gridcell" className={cx('jv-table__td', col.align && `jv-align-${col.align}`, col.mono && 'jv-mono')}>
                    {cards ? <span className="jv-table__cell-label">{col.header}</span> : null}
                    <span className="jv-table__cell-value">{col.cell ? col.cell(row) : (col.sortValue?.(row) ?? '—')}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div className="jv-table__foot" aria-live="polite">
        {countLabel(sorted.length, total)}
      </div>
    </div>
  );
}

/* ── FilterBar ──────────────────────────────────────────────────────────── */

export interface FilterDef {
  id: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}

export interface FilterChip {
  id: string;
  label: string;
  onRemove: () => void;
}

export interface FilterBarProps extends HTMLAttributes<HTMLDivElement> {
  search?: { value: string; onChange: (value: string) => void; placeholder?: string; label?: string };
  filters?: readonly FilterDef[];
  chips?: readonly FilterChip[];
  onReset?: () => void;
  resultCount?: number;
  totalCount?: number;
  actions?: ReactNode;
  resetLabel?: string;
}

export function FilterBar({ search, filters, chips, onReset, resultCount, totalCount, actions, resetLabel = 'Zurücksetzen', className, ...rest }: FilterBarProps) {
  return (
    <div className={cx('jv-filterbar', className)} role="search" {...rest}>
      <div className="jv-filterbar__row">
        {search ? (
          <SearchField
            className="jv-filterbar__search"
            value={search.value}
            onValueChange={search.onChange}
            placeholder={search.placeholder ?? 'Suchen …'}
            label={search.label ?? 'Suche'}
            shortcutHint={null}
          />
        ) : null}
        {filters?.map((f) => (
          <Select
            key={f.id}
            label={f.label}
            hideLabel
            value={f.value}
            options={f.options}
            onChange={(e) => f.onChange(e.target.value)}
            className="jv-filterbar__select"
          />
        ))}
        {actions}
        {onReset && (chips?.length ?? 0) > 0 ? (
          <button type="button" className="jv-filterbar__reset" onClick={onReset}>
            {resetLabel}
          </button>
        ) : null}
        {resultCount !== undefined ? (
          <span className="jv-filterbar__count" aria-live="polite">
            {totalCount !== undefined && totalCount !== resultCount ? `${resultCount} von ${totalCount}` : `${resultCount}`} Treffer
          </span>
        ) : null}
      </div>
      {chips && chips.length > 0 ? (
        <ul className="jv-filterbar__chips" aria-label="Aktive Filter">
          {chips.map((c) => (
            <li key={c.id}>
              <span className="jv-filterbar__chip">
                {c.label}
                <button type="button" aria-label={`Filter entfernen: ${c.label}`} onClick={c.onRemove}>
                  <X size={11} strokeWidth={2} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
