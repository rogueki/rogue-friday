import { ChevronRight } from 'lucide-react';
import { forwardRef, useId, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from '../cx';
import type { Corner, PanelCut, PanelCutSize, PanelLevel, PanelTone } from '../types';

/* ── CornerBrackets ─────────────────────────────────────────────────────── */

export interface CornerBracketsProps extends HTMLAttributes<HTMLSpanElement> {
  corners?: readonly Corner[];
  /** Arm length in px. */
  size?: number;
  tone?: 'cyan' | 'gold' | 'amber' | 'red';
}

/** Short bright L-shaped marks in panel corners. Decorative (aria-hidden). */
export function CornerBrackets({ corners = ['tr', 'bl'], size = 9, tone = 'cyan', className, style, ...rest }: CornerBracketsProps) {
  return (
    <span
      aria-hidden="true"
      className={cx('jv-brackets', `jv-brackets--${tone}`, className)}
      style={{ ['--jv-bracket' as string]: `${size}px`, ...style }}
      {...rest}
    >
      {corners.map((corner) => (
        <span key={corner} className={cx('jv-brackets__c', `jv-brackets__c--${corner}`)} />
      ))}
    </span>
  );
}

/* ── LivePill ───────────────────────────────────────────────────────────── */

export function LivePill({ label = 'LIVE', className }: { label?: string; className?: string }) {
  return (
    <span className={cx('jv-live-pill', className)}>
      <span className="jv-live-pill__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/* ── HudPanelHeader ─────────────────────────────────────────────────────── */

export interface HudPanelHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  /** id applied to the heading, used by the panel for aria-labelledby */
  titleId?: string;
  icon?: ReactNode;
  /** right-aligned actions, e.g. <PanelLink>Alle anzeigen</PanelLink> */
  actions?: ReactNode;
  live?: boolean | string;
  headingLevel?: 2 | 3 | 4;
  subtitle?: ReactNode;
}

export function HudPanelHeader({
  title,
  titleId,
  icon,
  actions,
  live,
  headingLevel = 2,
  subtitle,
  className,
  ...rest
}: HudPanelHeaderProps) {
  // Intrinsic tag names only: `ElementType` collapses to `never` once react-three-fiber augments the global JSX namespace.
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <div className={cx('jv-panel-header', className)} {...rest}>
      {icon ? (
        <span className="jv-panel-header__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="jv-panel-header__text">
        <Heading id={titleId} className="jv-panel-header__title">
          {title}
        </Heading>
        {subtitle ? <span className="jv-panel-header__subtitle">{subtitle}</span> : null}
      </div>
      {live || actions ? (
        <div className="jv-panel-header__actions">
          {live ? <LivePill label={typeof live === 'string' ? live : 'LIVE'} /> : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** "Alle anzeigen ›" style link used in panel headers and footers. */
export const PanelLink = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function PanelLink(
  { className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cx('jv-panel-link', className)} {...rest}>
      {children}
      <ChevronRight size={13} strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
});

/* ── HudPanel ───────────────────────────────────────────────────────────── */

export interface HudPanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** 1 normal, 2 active/selected, 3 attention/approval/critical (PLAN §24.5). */
  level?: PanelLevel;
  /** Line colour family. Gold is reserved for the AI-core context. */
  tone?: PanelTone;
  cut?: PanelCut;
  cutSize?: PanelCutSize;
  /** Force the outer glow on/off (default: on for level 2/3). */
  glow?: boolean;
  /** true = default corner brackets for the non-cut corners, false = none, array = explicit. */
  brackets?: boolean | readonly Corner[];
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  live?: boolean | string;
  /** Fully custom header (replaces the title/icon/actions header). */
  header?: ReactNode;
  footer?: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  as?: 'section' | 'div' | 'article' | 'aside';
  headingLevel?: 2 | 3 | 4;
  bodyClassName?: string;
  /** Scroll the body when content overflows (panel needs a bounded height). */
  scroll?: boolean;
  /** Makes the whole panel focusable and clickable (`onClick`), with a visible focus ring. */
  interactive?: boolean;
}

const defaultBrackets: Record<PanelCut, readonly Corner[]> = {
  'tl-br': ['tr', 'bl'],
  'tr-bl': ['tl', 'br'],
  all: [],
  tl: ['tr', 'br', 'bl'],
  br: ['tl', 'tr', 'bl'],
  none: ['tl', 'br'],
};

export const HudPanel = forwardRef<HTMLElement, HudPanelProps>(function HudPanel(
  {
    level = 1,
    tone = 'cyan',
    cut = 'tl-br',
    cutSize = 'md',
    glow,
    brackets = true,
    title,
    subtitle,
    icon,
    actions,
    live,
    header,
    footer,
    padding = 'md',
    as = 'section',
    headingLevel = 2,
    bodyClassName,
    scroll = false,
    interactive = false,
    className,
    children,
    onKeyDown,
    ...rest
  },
  ref,
) {
  // Narrowed to one intrinsic element type so props/ref (HTMLElement) type-check; the runtime tag is whatever `as` says.
  const Tag = as as 'section';
  const titleId = useId();
  const bracketCorners = brackets === true ? defaultBrackets[cut] : brackets === false ? [] : brackets;
  const glowOn = glow ?? level >= 2;
  const labelled = !rest['aria-label'] && !rest['aria-labelledby'] && title && typeof title === 'string';

  return (
    <Tag
      ref={ref}
      className={cx('jv-panel', interactive && 'jv-panel--interactive', className)}
      data-level={level}
      data-tone={tone}
      data-cut={cut}
      data-cut-size={cutSize}
      data-glow={glowOn ? 'true' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-labelledby={labelled ? titleId : undefined}
      onKeyDown={(event: React.KeyboardEvent<HTMLElement>) => {
        onKeyDown?.(event);
        if (interactive && !event.defaultPrevented && (event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      {...rest}
    >
      <div className="jv-panel__frame">
        <span className="jv-panel__ring" aria-hidden="true" />
        <span className="jv-panel__hair" aria-hidden="true" />
        {bracketCorners.length > 0 ? <CornerBrackets corners={bracketCorners} tone={tone} /> : null}
        {header ??
          (title || actions || live ? (
            <HudPanelHeader
              title={title}
              titleId={titleId}
              icon={icon}
              actions={actions}
              live={live}
              subtitle={subtitle}
              headingLevel={headingLevel}
            />
          ) : null)}
        <div className={cx('jv-panel__body', `jv-panel__body--${padding}`, scroll && 'jv-panel__body--scroll', bodyClassName)}>
          {children}
        </div>
        {footer ? <div className="jv-panel__footer">{footer}</div> : null}
      </div>
    </Tag>
  );
});
