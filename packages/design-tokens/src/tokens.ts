/** TypeScript mirror of the binding tokens in tokens.css (PLAN §24.15). */

export const fridayTokens = {
  bg0: { name: '--friday-bg-0', value: '#01060c' },
  bg1: { name: '--friday-bg-1', value: '#03111d' },
  bg2: { name: '--friday-bg-2', value: '#061a2a' },
  panel0: { name: '--friday-panel-0', value: 'rgba(3, 15, 27, 0.92)' },
  panel1: { name: '--friday-panel-1', value: 'rgba(5, 24, 39, 0.84)' },
  panelActive: { name: '--friday-panel-active', value: 'rgba(6, 36, 54, 0.92)' },
  borderDim: { name: '--friday-border-dim', value: 'rgba(30, 178, 218, 0.20)' },
  border: { name: '--friday-border', value: 'rgba(38, 215, 255, 0.42)' },
  borderActive: { name: '--friday-border-active', value: 'rgba(79, 232, 255, 0.82)' },
  cyan: { name: '--friday-cyan', value: '#27dcff' },
  cyanBright: { name: '--friday-cyan-bright', value: '#7af3ff' },
  teal: { name: '--friday-teal', value: '#20e0d0' },
  blue: { name: '--friday-blue', value: '#168cff' },
  orbGold: { name: '--friday-orb-gold', value: '#ffb52e' },
  orbOrange: { name: '--friday-orb-orange', value: '#ff7a00' },
  orbHot: { name: '--friday-orb-hot', value: '#fff2ba' },
  orbDeep: { name: '--friday-orb-deep', value: '#a94c00' },
  success: { name: '--friday-success', value: '#42efb0' },
  warning: { name: '--friday-warning', value: '#ffc857' },
  error: { name: '--friday-error', value: '#ff4d54' },
  violet: { name: '--friday-violet', value: '#9b7bff' },
  text: { name: '--friday-text', value: '#e8fbff' },
  textStrong: { name: '--friday-text-strong', value: '#ffffff' },
  muted: { name: '--friday-muted', value: '#7fa6b8' },
  disabled: { name: '--friday-disabled', value: '#405d6b' },
  grid: { name: '--friday-grid', value: 'rgba(39, 220, 255, 0.055)' },
  focus: { name: '--friday-focus', value: '#7af3ff' },
} as const;

export type FridayTokenKey = keyof typeof fridayTokens;

/** Raw values (hex / rgba) of the default theme, e.g. for canvas drawing. */
export const colors: { readonly [K in FridayTokenKey]: string } = Object.fromEntries(
  Object.entries(fridayTokens).map(([key, def]) => [key, def.value]),
) as { readonly [K in FridayTokenKey]: string };

export type Tone = 'cyan' | 'green' | 'violet' | 'amber' | 'red' | 'teal' | 'blue' | 'gold' | 'muted';
export const TONES: readonly Tone[] = ['cyan', 'green', 'violet', 'amber', 'red', 'teal', 'blue', 'gold', 'muted'];

/** Default-theme hex per tone, for canvas/SVG where CSS variables cannot be used directly. */
export const toneColors: Readonly<Record<Tone, string>> = {
  cyan: fridayTokens.cyan.value,
  green: fridayTokens.success.value,
  violet: fridayTokens.violet.value,
  amber: fridayTokens.warning.value,
  red: fridayTokens.error.value,
  teal: fridayTokens.teal.value,
  blue: fridayTokens.blue.value,
  gold: fridayTokens.orbGold.value,
  muted: fridayTokens.muted.value,
};

/** `var(--friday-…)` reference for a binding token, with optional fallback. */
export function cssVar(key: FridayTokenKey, fallback?: string): string {
  const name = fridayTokens[key].name;
  return fallback === undefined ? `var(${name})` : `var(${name}, ${fallback})`;
}

/** `var(--friday-tone-…)` for a semantic tone. */
export function toneVar(tone: Tone): string {
  return `var(--friday-tone-${tone})`;
}

/** Reads the live computed value of a token from the DOM (falls back to the default value). */
export function readCssVar(key: FridayTokenKey, target?: Element): string {
  const fallback = fridayTokens[key].value;
  if (typeof document === 'undefined') return fallback;
  const el = target ?? document.documentElement;
  const value = getComputedStyle(el).getPropertyValue(fridayTokens[key].name).trim();
  return value || fallback;
}

/** Dotted theme-file key → CSS custom property. */
export const THEME_TOKEN_MAP = {
  'color.background': '--friday-bg-0',
  'color.background1': '--friday-bg-1',
  'color.background2': '--friday-bg-2',
  'panel.fill0': '--friday-panel-0',
  'panel.fill1': '--friday-panel-1',
  'panel.fillActive': '--friday-panel-active',
  'line.dim': '--friday-border-dim',
  'line.default': '--friday-border',
  'line.active': '--friday-border-active',
  'color.primary': '--friday-cyan',
  'color.primaryBright': '--friday-cyan-bright',
  'color.teal': '--friday-teal',
  'color.blue': '--friday-blue',
  'color.orb': '--friday-orb-gold',
  'color.orbOrange': '--friday-orb-orange',
  'color.orbHot': '--friday-orb-hot',
  'color.orbDeep': '--friday-orb-deep',
  'color.success': '--friday-success',
  'color.warning': '--friday-warning',
  'color.error': '--friday-error',
  'color.violet': '--friday-violet',
  'text.default': '--friday-text',
  'text.strong': '--friday-text-strong',
  'text.muted': '--friday-muted',
  'text.disabled': '--friday-disabled',
  'grid.color': '--friday-grid',
  'focus.color': '--friday-focus',
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
