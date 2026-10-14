/** TypeScript mirror of the binding tokens in tokens.css (PLAN §24.15). */

export const jarvisTokens = {
  bg0: { name: '--jarvis-bg-0', value: '#01060c' },
  bg1: { name: '--jarvis-bg-1', value: '#03111d' },
  bg2: { name: '--jarvis-bg-2', value: '#061a2a' },
  panel0: { name: '--jarvis-panel-0', value: 'rgba(3, 15, 27, 0.92)' },
  panel1: { name: '--jarvis-panel-1', value: 'rgba(5, 24, 39, 0.84)' },
  panelActive: { name: '--jarvis-panel-active', value: 'rgba(6, 36, 54, 0.92)' },
  borderDim: { name: '--jarvis-border-dim', value: 'rgba(30, 178, 218, 0.20)' },
  border: { name: '--jarvis-border', value: 'rgba(38, 215, 255, 0.42)' },
  borderActive: { name: '--jarvis-border-active', value: 'rgba(79, 232, 255, 0.82)' },
  cyan: { name: '--jarvis-cyan', value: '#27dcff' },
  cyanBright: { name: '--jarvis-cyan-bright', value: '#7af3ff' },
  teal: { name: '--jarvis-teal', value: '#20e0d0' },
  blue: { name: '--jarvis-blue', value: '#168cff' },
  orbGold: { name: '--jarvis-orb-gold', value: '#ffb52e' },
  orbOrange: { name: '--jarvis-orb-orange', value: '#ff7a00' },
  orbHot: { name: '--jarvis-orb-hot', value: '#fff2ba' },
  orbDeep: { name: '--jarvis-orb-deep', value: '#a94c00' },
  success: { name: '--jarvis-success', value: '#42efb0' },
  warning: { name: '--jarvis-warning', value: '#ffc857' },
  error: { name: '--jarvis-error', value: '#ff4d54' },
  violet: { name: '--jarvis-violet', value: '#9b7bff' },
  text: { name: '--jarvis-text', value: '#e8fbff' },
  textStrong: { name: '--jarvis-text-strong', value: '#ffffff' },
  muted: { name: '--jarvis-muted', value: '#7fa6b8' },
  disabled: { name: '--jarvis-disabled', value: '#405d6b' },
  grid: { name: '--jarvis-grid', value: 'rgba(39, 220, 255, 0.055)' },
  focus: { name: '--jarvis-focus', value: '#7af3ff' },
} as const;

export type JarvisTokenKey = keyof typeof jarvisTokens;

/** Raw values (hex / rgba) of the default theme, e.g. for canvas drawing. */
export const colors: { readonly [K in JarvisTokenKey]: string } = Object.fromEntries(
  Object.entries(jarvisTokens).map(([key, def]) => [key, def.value]),
) as { readonly [K in JarvisTokenKey]: string };

export type Tone = 'cyan' | 'green' | 'violet' | 'amber' | 'red' | 'teal' | 'blue' | 'gold' | 'muted';
export const TONES: readonly Tone[] = ['cyan', 'green', 'violet', 'amber', 'red', 'teal', 'blue', 'gold', 'muted'];

/** Default-theme hex per tone, for canvas/SVG where CSS variables cannot be used directly. */
export const toneColors: Readonly<Record<Tone, string>> = {
  cyan: jarvisTokens.cyan.value,
  green: jarvisTokens.success.value,
  violet: jarvisTokens.violet.value,
  amber: jarvisTokens.warning.value,
  red: jarvisTokens.error.value,
  teal: jarvisTokens.teal.value,
  blue: jarvisTokens.blue.value,
  gold: jarvisTokens.orbGold.value,
  muted: jarvisTokens.muted.value,
};

/** `var(--jarvis-…)` reference for a binding token, with optional fallback. */
export function cssVar(key: JarvisTokenKey, fallback?: string): string {
  const name = jarvisTokens[key].name;
  return fallback === undefined ? `var(${name})` : `var(${name}, ${fallback})`;
}

/** `var(--jarvis-tone-…)` for a semantic tone. */
export function toneVar(tone: Tone): string {
  return `var(--jarvis-tone-${tone})`;
}

/** Reads the live computed value of a token from the DOM (falls back to the default value). */
export function readCssVar(key: JarvisTokenKey, target?: Element): string {
  const fallback = jarvisTokens[key].value;
  if (typeof document === 'undefined') return fallback;
  const el = target ?? document.documentElement;
  const value = getComputedStyle(el).getPropertyValue(jarvisTokens[key].name).trim();
  return value || fallback;
}

/** Dotted theme-file key → CSS custom property. */
export const THEME_TOKEN_MAP = {
  'color.background': '--jarvis-bg-0',
  'color.background1': '--jarvis-bg-1',
  'color.background2': '--jarvis-bg-2',
  'panel.fill0': '--jarvis-panel-0',
  'panel.fill1': '--jarvis-panel-1',
  'panel.fillActive': '--jarvis-panel-active',
  'line.dim': '--jarvis-border-dim',
  'line.default': '--jarvis-border',
  'line.active': '--jarvis-border-active',
  'color.primary': '--jarvis-cyan',
  'color.primaryBright': '--jarvis-cyan-bright',
  'color.teal': '--jarvis-teal',
  'color.blue': '--jarvis-blue',
  'color.orb': '--jarvis-orb-gold',
  'color.orbOrange': '--jarvis-orb-orange',
  'color.orbHot': '--jarvis-orb-hot',
  'color.orbDeep': '--jarvis-orb-deep',
  'color.success': '--jarvis-success',
  'color.warning': '--jarvis-warning',
  'color.error': '--jarvis-error',
  'color.violet': '--jarvis-violet',
  'text.default': '--jarvis-text',
  'text.strong': '--jarvis-text-strong',
  'text.muted': '--jarvis-muted',
  'text.disabled': '--jarvis-disabled',
  'grid.color': '--jarvis-grid',
  'focus.color': '--jarvis-focus',
} as const;

export type ThemeTokenKey = keyof typeof THEME_TOKEN_MAP;

/** z-index levels of the panel hierarchy (§24.5). */
export const zLevels = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 1000, popover: 1100, toast: 1200, tooltip: 1300 } as const;

/** Motion constants mirrored from tokens.css (ms). */
export const motionTokens = {
  durFast: 140,
  durBase: 200,
  durPanel: 240,
  durDrawer: 260,
  easeOut: [0.2, 0.8, 0.2, 1] as const,
  staggerMs: 30,
} as const;

export const spacing = [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 56] as const;

export const fontFamilies = {
  display: "'Oxanium', 'Rajdhani', 'Segoe UI', system-ui, sans-serif",
  body: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace",
} as const;
