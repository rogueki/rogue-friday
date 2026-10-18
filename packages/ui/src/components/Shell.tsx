import { Menu, PanelLeftClose, SendHorizontal, TerminalSquare, PanelLeftOpen, Pause, Play, Search, Square, Wifi, WifiOff, Zap, Bell, Settings, LayoutGrid, Focus, Mic } from 'lucide-react';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from '../cx';
import { useControllable, useMediaQuery, useNow } from '../hooks';
import type { Tone } from '../types';
import { Drawer } from './Overlays';
import { HudPanel, PanelLink } from './Panel';
import { Badge, Button, IconButton, StatusChip, StatusDot } from './Primitives';
import { Tooltip } from './Tooltip';
import { VoiceControl, defaultVoiceLabels, type VoiceState } from './Voice';
import { Waveform } from './Waveform';

/* ── BrandMark ──────────────────────────────────────────────────────────── */

export function BrandMark({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <svg className={cx('jv-brandmark', className)} width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="jv-brand-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--friday-text-strong)" />
          <stop offset="45%" stopColor="var(--friday-cyan-bright)" />
          <stop offset="100%" stopColor="var(--friday-cyan)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="none" stroke="var(--friday-cyan)" strokeOpacity="0.55" strokeWidth="1" />
      <circle cx="24" cy="24" r="18" fill="none" stroke="var(--friday-cyan)" strokeOpacity="0.9" strokeWidth="1.5" strokeDasharray="22 6 3 6" strokeLinecap="round" transform="rotate(-30 24 24)" />
      <circle cx="24" cy="24" r="13" fill="none" stroke="var(--friday-cyan-bright)" strokeOpacity="0.85" strokeWidth="1.25" strokeDasharray="30 9" transform="rotate(100 24 24)" />
      <circle cx="24" cy="24" r="8" fill="color-mix(in srgb, var(--friday-cyan) 14%, transparent)" stroke="var(--friday-cyan)" strokeWidth="1" />
      <circle cx="24" cy="24" r="5" fill="url(#jv-brand-core)" />
      <circle cx="24" cy="24" r="2" fill="var(--friday-text-strong)" />
    </svg>
  );
}

/* ── Shell context ──────────────────────────────────────────────────────── */

interface ShellContextValue {
  drawerMode: boolean;
  navCollapsed: boolean;
  setNavCollapsed: (collapsed: boolean) => void;
  navOpen: boolean;
  setNavOpen: (open: boolean) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useFridayShell(): ShellContextValue | null {
  return useContext(ShellContext);
}

/* ── FridayShell ────────────────────────────────────────────────────────── */

export interface FridayShellProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  nav: ReactNode;
  topBar: ReactNode;
  bottomBar?: ReactNode;
  children: ReactNode;
  navCollapsed?: boolean;
  defaultNavCollapsed?: boolean;
  onNavCollapsedChange?: (collapsed: boolean) => void;
  /** Drawer state in narrow viewports. */
  navOpen?: boolean;
  onNavOpenChange?: (open: boolean) => void;
  /** Below this width (px) the navigation becomes a drawer (§27.15). */
  drawerBreakpoint?: number;
  skipLinkLabel?: string;
  mainLabel?: string;
  navDrawerLabel?: string;
  contentClassName?: string;
  /** Hide the dot grid / radial stage (e.g. when the app draws its own). */
  plainBackground?: boolean;
}

export const FridayShell = forwardRef<HTMLDivElement, FridayShellProps>(function FridayShell(
  {
    nav,
    topBar,
    bottomBar,
    children,
    navCollapsed,
    defaultNavCollapsed = false,
    onNavCollapsedChange,
    navOpen,
    onNavOpenChange,
    drawerBreakpoint = 1024,
    skipLinkLabel = 'Zum Inhalt springen',
    mainLabel = 'Hauptinhalt',
    navDrawerLabel = 'Navigation',
    contentClassName,
    plainBackground,
    className,
    ...rest
  },
  ref,
) {
  const drawerMode = useMediaQuery(`(max-width: ${drawerBreakpoint - 1}px)`);
  const [collapsed, setCollapsed] = useControllable(navCollapsed, defaultNavCollapsed, onNavCollapsedChange);
  const [open, setOpen] = useControllable(navOpen, false, onNavOpenChange);
  const setNavOpen = useCallback((v: boolean) => setOpen(v), [setOpen]);
  const ctx = useMemo<ShellContextValue>(
    () => ({ drawerMode, navCollapsed: collapsed, setNavCollapsed: setCollapsed, navOpen: open, setNavOpen }),
    [drawerMode, collapsed, setCollapsed, open, setNavOpen],
  );

  return (
    <ShellContext.Provider value={ctx}>
      <div
        ref={ref}
        className={cx('jv-shell', !plainBackground && 'jv-bg-stage', className)}
        data-nav={drawerMode ? 'drawer' : collapsed ? 'collapsed' : 'expanded'}
        data-has-bottom={bottomBar ? 'true' : undefined}
        {...rest}
      >
        <a className="jv-skip" href="#jv-main">
          {skipLinkLabel}
        </a>
        {drawerMode ? (
          <Drawer open={open} onOpenChange={setOpen} side="left" width={296} bare title={navDrawerLabel}>
            {nav}
          </Drawer>
        ) : (
          <div className="jv-shell__nav">{nav}</div>
        )}
        <div className="jv-shell__top">{topBar}</div>
        <main id="jv-main" className={cx('jv-shell__main', contentClassName)} aria-label={mainLabel} tabIndex={-1}>
          {children}
        </main>
        {bottomBar ? <div className="jv-shell__bottom">{bottomBar}</div> : null}
      </div>
    </ShellContext.Provider>
  );
});

/* ── LeftCommandNav ─────────────────────────────────────────────────────── */

export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  /** Counter (tasks, approvals, alerts). */
  badge?: number;
  /** Screen-reader text for the badge, e.g. "3 offene Aufgaben". */
  badgeLabel?: string;
  badgeTone?: Tone;
  href?: string;
  disabled?: boolean;
  /** Items with the same group are separated by a small heading. */
  group?: string;
}

export interface LeftCommandNavProps extends Omit<HTMLAttributes<HTMLElement>, 'onSelect'> {
  items: readonly NavItem[];
  activeId?: string;
  onNavigate?: (id: string) => void;
  brand?: { title: string; subtitle?: string };
  /** Overrides the shell's collapsed state. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Pinned bottom area: voice-status panel, focus button. */
  footer?: ReactNode;
  navLabel?: string;
  collapseLabel?: string;
  expandLabel?: string;
}

export const LeftCommandNav = forwardRef<HTMLElement, LeftCommandNavProps>(function LeftCommandNav(
  {
    items,
    activeId,
    onNavigate,
    brand = { title: 'F.R.I.D.A.Y.', subtitle: 'COMMAND CENTER' },
    collapsed: collapsedProp,
    onToggleCollapsed,
    footer,
    navLabel = 'Hauptnavigation',
    collapseLabel = 'Navigation einklappen',
    expandLabel = 'Navigation ausklappen',
    className,
    ...rest
  },
  ref,
) {
  const shell = useFridayShell();
  const drawer = shell?.drawerMode ?? false;
  const collapsed = drawer ? false : (collapsedProp ?? shell?.navCollapsed ?? false);
  const toggle = onToggleCollapsed ?? (() => shell?.setNavCollapsed(!collapsed));

  const select = (id: string): void => {
    onNavigate?.(id);
    if (drawer) shell?.setNavOpen(false);
  };

  let lastGroup: string | undefined;
  return (
    <aside ref={ref} className={cx('jv-nav', collapsed && 'jv-nav--collapsed', className)} data-collapsed={collapsed || undefined} {...rest}>
      <HudPanel
        as="div"
        level={1}
        cut="tl-br"
        cutSize="md"
        padding="none"
        brackets={['tr', 'bl']}
        className="jv-nav__panel"
        bodyClassName="jv-nav__panel-body"
      >
        <div className="jv-nav__brand">
          <BrandMark size={collapsed ? 36 : 46} />
          {collapsed ? null : (
            <div className="jv-nav__brandtext">
              <span className="jv-nav__title">{brand.title}</span>
              {brand.subtitle ? <span className="jv-nav__subtitle">{brand.subtitle}</span> : null}
            </div>
          )}
          {drawer ? null : (
            <button type="button" className="jv-nav__toggle" onClick={toggle} aria-label={collapsed ? expandLabel : collapseLabel} aria-expanded={!collapsed}>
              {collapsed ? <PanelLeftOpen size={15} strokeWidth={1.5} /> : <PanelLeftClose size={15} strokeWidth={1.5} />}
            </button>
          )}
        </div>
        <nav className="jv-nav__scroll" aria-label={navLabel}>
          <ul className="jv-nav__list">
            {items.map((item) => {
              const showGroup = item.group && item.group !== lastGroup && !collapsed;
              lastGroup = item.group;
              const active = item.id === activeId;
              const Element = item.href ? 'a' : 'button';
              const link = (
                <Element
                  {...(item.href ? { href: item.href } : { type: 'button' as const })}
                  className={cx('jv-nav__item', active && 'jv-nav__item--active', item.disabled && 'jv-nav__item--disabled')}
                  aria-current={active ? 'page' : undefined}
                  aria-disabled={item.disabled || undefined}
                  onClick={(event: React.MouseEvent) => {
                    if (item.disabled) {
                      event.preventDefault();
                      return;
                    }
                    if (item.href && onNavigate) event.preventDefault();
                    select(item.id);
                  }}
                >
                  <span className="jv-nav__icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {collapsed ? <span className="jv-sr-only">{item.label}</span> : <span className="jv-nav__label">{item.label}</span>}
                  {item.badge ? (
                    <Badge
                      count={item.badge}
                      tone={item.badgeTone}
                      label={item.badgeLabel}
                      className={cx('jv-nav__badge', collapsed && 'jv-nav__badge--dot')}
                    />
                  ) : null}
                </Element>
              );
              return (
                <li key={item.id} className="jv-nav__li">
                  {showGroup ? <div className="jv-nav__group">{item.group}</div> : null}
                  {collapsed ? (
                    <Tooltip placement="right" content={item.badge ? `${item.label} (${item.badge})` : item.label}>
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
        {footer ? <div className="jv-nav__footer">{footer}</div> : null}
      </HudPanel>
    </aside>
  );
});

/* ── VoiceStatusPanel (nav footer) ──────────────────────────────────────── */

export interface VoiceStatusPanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  state?: VoiceState;
  statusText?: string;
  levels?: readonly number[];
  title?: string;
  hint?: string;
  onToggle?: () => void;
  onOpen?: () => void;
  collapsed?: boolean;
  focusMode?: boolean;
  onFocusModeToggle?: () => void;
  focusLabel?: string;
}

export function VoiceStatusPanel({
  state = 'idle',
  statusText,
  levels,
  title = 'VOICE STATUS',
  hint = 'Tippen zum Sprechen',
  onToggle,
  onOpen,
  collapsed: collapsedProp,
  focusMode = false,
  onFocusModeToggle,
  focusLabel = 'Fokus-Modus',
  className,
  ...rest
}: VoiceStatusPanelProps) {
  const shell = useFridayShell();
  const collapsed = collapsedProp ?? (shell && !shell.drawerMode ? shell.navCollapsed : false);
  const active = state === 'listening' || state === 'speaking';
  if (collapsed) {
    return (
      <div className={cx('jv-voicestatus jv-voicestatus--collapsed', className)} {...rest}>
        <Tooltip placement="right" content={statusText ?? defaultVoiceLabels[state]}>
          <IconButton label={`Sprache: ${statusText ?? defaultVoiceLabels[state]}`} icon={<Mic size={18} strokeWidth={1.5} />} onClick={onToggle} pressed={state === 'listening'} />
        </Tooltip>
        {onFocusModeToggle ? (
          <Tooltip placement="right" content={focusLabel}>
            <IconButton label={focusLabel} icon={<Focus size={18} strokeWidth={1.5} />} onClick={onFocusModeToggle} pressed={focusMode} />
          </Tooltip>
        ) : null}
      </div>
    );
  }
  return (
    <div className={cx('jv-voicestatus', className)} {...rest}>
      <HudPanel
        as="div"
        level={1}
        cut="tl-br"
        cutSize="sm"
        padding="sm"
        brackets={false}
        title={title}
        headingLevel={3}
        actions={onOpen ? <PanelLink onClick={onOpen}><span className="jv-sr-only">Sprachsteuerung öffnen</span></PanelLink> : undefined}
        className="jv-voicestatus__panel"
      >
        <div className="jv-voicestatus__body">
          <Waveform levels={levels} live={active} energy={active ? 0.8 : 0.15} height={22} tone={state === 'speaking' ? 'gold' : 'cyan'} fade="edges" />
          <VoiceControl
            state={state}
            size={54}
            showWaveform={false}
            statusText={statusText}
            hint={hint}
            onClick={onToggle}
            label="Push-to-talk"
          />
        </div>
      </HudPanel>
      {onFocusModeToggle ? (
        <Button variant="ghost" block icon={<Focus size={14} />} aria-pressed={focusMode} onClick={onFocusModeToggle} className="jv-voicestatus__focus">
          {focusLabel}
        </Button>
      ) : null}
    </div>
  );
}

/* ── TopStatusBar ───────────────────────────────────────────────────────── */

export type ConnectionState = 'online' | 'degraded' | 'offline' | 'connecting';

export interface TopBarAction {
  id: string;
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  badge?: number;
}

export interface TopStatusBarProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** Frame label, default "SYSTEM STATUS". */
  statusLabel?: string;
  status?: { label: string; tone?: Tone };
  /** Fixed time (stories/tests); omit for a live ticking clock. */
  now?: Date;
  locale?: string;
  timeZone?: string;
  hour12?: boolean;
  showSeconds?: boolean;
  onSearchClick?: () => void;
  searchLabel?: string;
  searchHint?: string;
  actions?: readonly TopBarAction[];
  operator?: { name: string; role?: string };
  connection?: { state: ConnectionState; label?: string };
  menuLabel?: string;
}

const connectionTone: Record<ConnectionState, Tone> = { online: 'green', degraded: 'amber', offline: 'red', connecting: 'blue' };
const connectionLabel: Record<ConnectionState, string> = { online: 'Verbunden', degraded: 'Eingeschränkt', offline: 'Offline', connecting: 'Verbinde …' };

export const defaultTopBarActions: readonly TopBarAction[] = [
  { id: 'layout', label: 'Layout anpassen', icon: <LayoutGrid size={17} strokeWidth={1.5} /> },
  { id: 'notifications', label: 'Benachrichtigungen', icon: <Bell size={17} strokeWidth={1.5} /> },
  { id: 'settings', label: 'Einstellungen', icon: <Settings size={17} strokeWidth={1.5} /> },
];

export const TopStatusBar = forwardRef<HTMLElement, TopStatusBarProps>(function TopStatusBar(
  {
    statusLabel = 'SYSTEM STATUS',
    status = { label: 'OPTIMAL', tone: 'green' },
    now: nowProp,
    locale = 'de-DE',
    timeZone,
    hour12,
    showSeconds = true,
    onSearchClick,
    searchLabel = 'Suchen …',
    searchHint = 'Ctrl K',
    actions = defaultTopBarActions,
    operator,
    connection,
    menuLabel = 'Navigation öffnen',
    className,
    ...rest
  },
  ref,
) {
  const shell = useFridayShell();
  const now = useNow(1000, nowProp);
  const date = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(now),
    [locale, timeZone, now],
  );
  const time = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: showSeconds ? '2-digit' : undefined, hour12, timeZone }).format(now),
    [locale, timeZone, hour12, showSeconds, now],
  );
  const statusTone = status.tone ?? 'green';

  return (
    <header ref={ref} className={cx('jv-topbar', className)} {...rest}>
      <div className="jv-topbar__left">
        {shell?.drawerMode ? (
          <IconButton label={menuLabel} icon={<Menu size={18} strokeWidth={1.5} />} onClick={() => shell.setNavOpen(true)} />
        ) : null}
        <HudPanel as="div" level={1} cut="tl-br" cutSize="sm" padding="none" brackets={false} className="jv-topbar__status" bodyClassName="jv-topbar__status-body">
          <span className="jv-topbar__status-label">{statusLabel}</span>
          <span className={cx('jv-topbar__status-value', `jv-tone-${statusTone}`)}>
            <StatusDot tone={statusTone} pulse />
            {status.label}
          </span>
        </HudPanel>
        {connection ? (
          <StatusChip
            className="jv-topbar__conn"
            tone={connectionTone[connection.state]}
            dot={false}
            icon={connection.state === 'offline' ? <WifiOff size={13} strokeWidth={1.75} /> : <Wifi size={13} strokeWidth={1.75} />}
          >
            {connection.label ?? connectionLabel[connection.state]}
          </StatusChip>
        ) : null}
      </div>

      <div className="jv-topbar__center">
        <span className="jv-topbar__date">{date}</span>
        <time className="jv-topbar__clock" dateTime={now.toISOString()}>
          {time}
        </time>
      </div>

      <div className="jv-topbar__right">
        <button type="button" className="jv-topbar__search" onClick={onSearchClick} aria-keyshortcuts="Control+K" aria-label={`${searchLabel} ${searchHint}`}>
          <Search size={15} strokeWidth={1.5} aria-hidden="true" />
          <span className="jv-topbar__search-label">{searchLabel}</span>
          <kbd className="jv-kbd">{searchHint}</kbd>
        </button>
        {actions.map((a) => (
          <IconButton
            key={a.id}
            label={a.label}
            icon={a.icon}
            onClick={a.onClick}
            badge={a.badge ? <Badge count={a.badge} tone="red" label={`${a.badge}`} /> : undefined}
          />
        ))}
        {operator ? (
          <div className="jv-operator" role="group" aria-label={`Operator: ${operator.name}${operator.role ? `, ${operator.role}` : ''}`}>
            <div className="jv-operator__text">
              <span className="jv-operator__name">{operator.name}</span>
              {operator.role ? <span className="jv-operator__role">{operator.role}</span> : null}
            </div>
            <span className="jv-operator__avatar" aria-hidden="true">
              {operator.name.slice(0, 1).toUpperCase()}
            </span>
          </div>
        ) : null}
      </div>
    </header>
  );
});

/* ── BottomCommandBar ───────────────────────────────────────────────────── */

export interface ContextChip {
  id: string;
  icon: ReactNode;
  label: string;
  value: string;
  /** Why there is no real value ("keine Datenquelle"): shown as tooltip and read by screen readers instead of a bare dash. */
  hint?: string;
  onClick?: () => void;
}

const TEXT_HISTORY_LIMIT = 30;

export interface CommandTextInputProps {
  label: string;
  placeholder?: string;
  submitLabel?: string;
  disabled?: boolean;
  /** Return `false` (or reject) when the command failed so the typed text is kept for a retry. */
  onSubmit: (text: string) => void | boolean | Promise<void | boolean>;
  className?: string;
}

/**
 * Single-line command input of the bottom bar (PLAN §27.13 "Text-/Voice-Eingabe"). Enter submits, Escape clears (a second
 * Escape leaves the field), ArrowUp/ArrowDown walk through the commands typed in this session.
 */
export function CommandTextInput({ label, placeholder, submitLabel = 'Senden', disabled = false, onSubmit, className }: CommandTextInputProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const history = useRef<string[]>([]);
  const cursor = useRef(-1);
  const draft = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = useCallback(async () => {
    const text = value.trim();
    if (!text || busy || disabled) return;
    setBusy(true);
    let keep: boolean;
    try {
      keep = (await onSubmit(text)) === false;
    } catch {
      // The caller reports failures (toast); the text stays so the person can retry.
      keep = true;
    } finally {
      setBusy(false);
    }
    if (keep) return;
    history.current = [text, ...history.current.filter((entry) => entry !== text)].slice(0, TEXT_HISTORY_LIMIT);
    cursor.current = -1;
    draft.current = '';
    setValue('');
    inputRef.current?.focus();
  }, [value, busy, disabled, onSubmit]);

  const step = (direction: 1 | -1): void => {
    const entries = history.current;
    if (entries.length === 0) return;
    if (cursor.current === -1) draft.current = value;
    const next = cursor.current + direction;
    if (next < -1 || next >= entries.length) return;
    cursor.current = next;
    setValue(next === -1 ? draft.current : (entries[next] ?? ''));
  };

  return (
    <form
      className={cx('jv-bottombar__text', busy && 'jv-bottombar__text--busy', className)}
      role="group"
      aria-label={label}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <span className="jv-bottombar__text-icon" aria-hidden="true">
        <TerminalSquare size={15} strokeWidth={1.5} />
      </span>
      <input
        ref={inputRef}
        type="text"
        className="jv-bottombar__input"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        aria-busy={busy || undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="send"
        maxLength={2000}
        disabled={disabled}
        readOnly={busy}
        onChange={(event) => {
          cursor.current = -1;
          setValue(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            if (value) {
              event.preventDefault();
              event.stopPropagation();
              cursor.current = -1;
              setValue('');
            } else {
              event.currentTarget.blur();
            }
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            step(1);
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            step(-1);
          }
        }}
      />
      <IconButton label={submitLabel} icon={<SendHorizontal size={14} strokeWidth={1.75} />} type="submit" size="sm" variant="ghost" disabled={disabled || busy || value.trim() === ''} />
    </form>
  );
}

export interface BottomCommandBarProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  chips?: readonly ContextChip[];
  state?: VoiceState;
  /** Line under the capsule title ("Ich höre zu …"). */
  statusText?: string;
  talkLabel?: string;
  onTalk?: () => void;
  onStop?: () => void;
  onPause?: () => void;
  paused?: boolean;
  levels?: readonly number[];
  quickAction?: { label: string; icon?: ReactNode; onClick?: () => void; disabled?: boolean };
  /** Compact variant for detail pages. */
  compact?: boolean;
  /** Enables the text-command input (left of the voice capsule); typed commands go through this callback on Enter. */
  onSubmitText?: CommandTextInputProps['onSubmit'];
  textLabel?: string;
  textPlaceholder?: string;
  textSubmitLabel?: string;
  textDisabled?: boolean;
  stopLabel?: string;
  pauseLabel?: string;
  resumeLabel?: string;
}

export const BottomCommandBar = forwardRef<HTMLElement, BottomCommandBarProps>(function BottomCommandBar(
  {
    chips,
    state = 'idle',
    statusText,
    talkLabel = 'MIT F.R.I.D.A.Y. SPRECHEN',
    onTalk,
    onStop,
    onPause,
    paused = false,
    levels,
    quickAction,
    compact = false,
    onSubmitText,
    textLabel = 'Befehl eingeben',
    textPlaceholder = 'Befehl eingeben …',
    textSubmitLabel = 'Senden',
    textDisabled = false,
    stopLabel = 'Stopp',
    pauseLabel = 'Pause',
    resumeLabel = 'Fortsetzen',
    className,
    ...rest
  },
  ref,
) {
  const active = state === 'listening' || state === 'speaking';
  const waveTone: Tone = state === 'speaking' ? 'gold' : 'cyan';
  const text = statusText ?? defaultVoiceLabels[state];
  return (
    <HudPanel
      as="section"
      ref={ref}
      level={1}
      cut="tl-br"
      cutSize="sm"
      padding="none"
      brackets={false}
      className={cx('jv-bottombar', compact && 'jv-bottombar--compact', className)}
      aria-label="Sprach- und Befehlsleiste"
      data-state={state}
      {...rest}
    >
      {!compact && chips && chips.length > 0 ? (
        <ul className="jv-bottombar__chips" aria-label="Kontext">
          {chips.map((chip) => {
            const body = (
              <>
                <span className="jv-ctxchip__icon" aria-hidden="true">
                  {chip.icon}
                </span>
                <span className="jv-ctxchip__text">
                  <span className="jv-ctxchip__label">{chip.label}</span>
                  <span className="jv-ctxchip__value" title={chip.hint ? undefined : chip.value}>
                    {chip.value}
                  </span>
                </span>
              </>
            );
            return (
              <li key={chip.id} className={cx('jv-ctxchip', chip.hint && 'jv-ctxchip--unavailable')}>
                {chip.onClick ? (
                  <button type="button" className="jv-ctxchip__inner" onClick={chip.onClick}
                    title={`${chip.value}${chip.hint ? ` · ${chip.hint}` : ""}`} aria-label={`${chip.label}: ${chip.value}${chip.hint ? `. ${chip.hint}` : ""}`}>
                    {body}
                  </button>
                ) : chip.hint ? (
                  <Tooltip content={chip.hint}>
                    <span className="jv-ctxchip__inner" role="group" tabIndex={0}
                      title={`${chip.value} · ${chip.hint}`} aria-label={`${chip.label}: ${chip.value}. ${chip.hint}`}>
                      {body}
                    </span>
                  </Tooltip>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <span />
      )}

      {onSubmitText ? (
        <CommandTextInput label={textLabel} placeholder={textPlaceholder} submitLabel={textSubmitLabel} disabled={textDisabled} onSubmit={onSubmitText} />
      ) : (
        <div className="jv-bottombar__dots jv-bottombar__dots--left" aria-hidden="true" />
      )}

      <div className="jv-bottombar__center">
        <button
          type="button"
          className="jv-capsule"
          data-tone={state === 'speaking' ? 'gold' : state === 'error' ? 'red' : 'cyan'}
          data-active={active || undefined}
          aria-pressed={state === 'listening'}
          onClick={onTalk}
          disabled={state === 'disabled'}
        >
          <span className="jv-capsule__wave jv-capsule__wave--left" aria-hidden="true">
            <Waveform levels={levels} live={active} energy={active ? 0.85 : 0.12} tone={waveTone} height={compact ? 22 : 30} width={compact ? 56 : 84} fade="left" seed={3} />
          </span>
          <span className="jv-capsule__text">
            <span className="jv-capsule__title">{talkLabel}</span>
            {compact ? null : <span className="jv-capsule__status">{text}</span>}
          </span>
          <span className="jv-capsule__wave jv-capsule__wave--right" aria-hidden="true">
            <Waveform levels={levels} live={active} energy={active ? 0.85 : 0.12} tone={waveTone} height={compact ? 22 : 30} width={compact ? 56 : 84} fade="right" seed={9} />
          </span>
        </button>
        <span className="jv-sr-only" role="status" aria-live="polite">
          {text}
        </span>
        <div className="jv-bottombar__controls">
          <IconButton label={paused ? resumeLabel : pauseLabel} icon={paused ? <Play size={15} strokeWidth={1.75} /> : <Pause size={15} strokeWidth={1.75} />} onClick={onPause} pressed={paused} size="sm" />
          <IconButton label={stopLabel} icon={<Square size={14} strokeWidth={1.75} />} onClick={onStop} size="sm" variant="danger" />
        </div>
      </div>

      <div className="jv-bottombar__dots jv-bottombar__dots--right" aria-hidden="true" />

      {quickAction ? (
        <Button variant="ghost" className="jv-bottombar__quick" aria-label={quickAction.label} title={quickAction.label} icon={quickAction.icon ?? <Zap size={14} />} onClick={quickAction.onClick} disabled={quickAction.disabled}>
          {quickAction.label}
        </Button>
      ) : (
        <span />
      )}
    </HudPanel>
  );
});
