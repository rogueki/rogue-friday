import goldCore from './themes/jarvis-command-gold-core.json';
import midnight from './themes/jarvis-command-midnight.json';
import { THEME_TOKEN_MAP, type ThemeTokenKey } from './tokens';

export type CornerStyle = 'technical-cut' | 'soft-cut' | 'square';

export interface JarvisTheme {
  id: string;
  name: string;
  version?: number;
  tokens: Partial<Record<ThemeTokenKey, string>> & Record<string, string>;
  orb?: {
    preset?: string;
    particleDensity?: number;
    fragmentDensity?: number;
    glowIntensity?: number;
    motionSpeed?: number;
    mouseParallax?: boolean;
  };
  panels?: {
    cornerStyle?: CornerStyle;
    borderIntensity?: number;
    backgroundOpacity?: number;
  };
  effects?: {
    gridVisibility?: number;
    cyanIntensity?: number;
  };
}

/** Runtime knobs that can change without a rebuild (PLAN §25.2). */
export interface ThemeSettings {
  /** Multiplier for cyan line alpha (borders). 0.3–1.5 */
  cyanIntensity: number;
  /** 0 = theme default, 1 = nearly see-through panels. */
  panelTransparency: number;
  /** Multiplier for the gold glow around the AI core. 0–1.5 */
  orbGoldIntensity: number;
  /** 0 hides the dot grid, 1 = theme default. */
  gridVisibility: number;
  /** Font scale for all --jv-fs-* sizes. 0.85–1.3 */
  fontScale: number;
}

export const DEFAULT_THEME_SETTINGS: Readonly<ThemeSettings> = {
  cyanIntensity: 1,
  panelTransparency: 0,
  orbGoldIntensity: 1,
  gridVisibility: 1,
  fontScale: 1,
};

const SETTING_RANGES: Record<keyof ThemeSettings, readonly [number, number]> = {
  cyanIntensity: [0.3, 1.5],
  panelTransparency: [0, 1],
  orbGoldIntensity: [0, 1.5],
  gridVisibility: [0, 1],
  fontScale: [0.85, 1.3],
};

/** Reference values of the default theme: token alphas correspond to these panel intensities. */
export const REFERENCE_BORDER_INTENSITY = 0.55;
export const REFERENCE_BACKGROUND_OPACITY = 0.88;

export const defaultTheme = goldCore as JarvisTheme;
export const midnightTheme = midnight as JarvisTheme;
export const themes: readonly JarvisTheme[] = [defaultTheme, midnightTheme];

export function getTheme(id: string): JarvisTheme | undefined {
  return themes.find((t) => t.id === id);
}

// ── validation ────────────────────────────────────────────────────────────

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/deg-]+\))$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const TOKEN_KEY_RE = /^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)+$/;
const CORNER_STYLES: readonly string[] = ['technical-cut', 'soft-cut', 'square'];

export interface ThemeValidation {
  ok: boolean;
  errors: string[];
  theme?: JarvisTheme;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkRange(errors: string[], path: string, value: unknown, min: number, max: number): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    errors.push(`${path} must be a number in [${min}, ${max}]`);
  }
}

/** Validates the shape of a theme file (§25.5: damaged themes must be rejected, not applied). */
export function validateTheme(input: unknown): ThemeValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['theme must be an object'] };

  if (typeof input.id !== 'string' || !ID_RE.test(input.id)) errors.push('id must match ^[a-z0-9][a-z0-9-]{1,63}$');
  if (typeof input.name !== 'string' || input.name.length === 0 || input.name.length > 80) {
    errors.push('name must be a non-empty string (max 80)');
  }
  if (input.version !== undefined && (!Number.isInteger(input.version) || (input.version as number) < 1)) {
    errors.push('version must be an integer >= 1');
  }

  if (!isRecord(input.tokens)) {
    errors.push('tokens must be an object');
  } else {
    for (const [key, value] of Object.entries(input.tokens)) {
      if (!TOKEN_KEY_RE.test(key)) errors.push(`tokens.${key}: invalid key`);
      else if (typeof value !== 'string' || !COLOR_RE.test(value.trim())) errors.push(`tokens.${key}: invalid colour value`);
    }
  }

  if (input.orb !== undefined) {
    if (!isRecord(input.orb)) errors.push('orb must be an object');
    else {
      checkRange(errors, 'orb.particleDensity', input.orb.particleDensity, 0, 1);
      checkRange(errors, 'orb.fragmentDensity', input.orb.fragmentDensity, 0, 1);
      checkRange(errors, 'orb.glowIntensity', input.orb.glowIntensity, 0, 1.5);
      checkRange(errors, 'orb.motionSpeed', input.orb.motionSpeed, 0, 3);
      if (input.orb.mouseParallax !== undefined && typeof input.orb.mouseParallax !== 'boolean') {
        errors.push('orb.mouseParallax must be boolean');
      }
    }
  }
  if (input.panels !== undefined) {
    if (!isRecord(input.panels)) errors.push('panels must be an object');
    else {
      if (input.panels.cornerStyle !== undefined && !CORNER_STYLES.includes(input.panels.cornerStyle as string)) {
        errors.push(`panels.cornerStyle must be one of ${CORNER_STYLES.join(', ')}`);
      }
      checkRange(errors, 'panels.borderIntensity', input.panels.borderIntensity, 0, 1);
      checkRange(errors, 'panels.backgroundOpacity', input.panels.backgroundOpacity, 0, 1);
    }
  }
  if (input.effects !== undefined) {
    if (!isRecord(input.effects)) errors.push('effects must be an object');
    else {
      checkRange(errors, 'effects.gridVisibility', input.effects.gridVisibility, 0, 1);
      checkRange(errors, 'effects.cyanIntensity', input.effects.cyanIntensity, 0.3, 1.5);
    }
  }

  return errors.length === 0 ? { ok: true, errors, theme: input as unknown as JarvisTheme } : { ok: false, errors };
}

// ── colour helpers ────────────────────────────────────────────────────────

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function parseColor(value: string): Rgba | null {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (hex?.[1]) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)(?:[\s,/]+([0-9.]+%?))?\s*\)$/i.exec(v);
  if (rgb) {
    const alphaRaw = rgb[4];
    const a = alphaRaw === undefined ? 1 : alphaRaw.endsWith('%') ? parseFloat(alphaRaw) / 100 : parseFloat(alphaRaw);
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a };
  }
  return null;
}

function scaleAlpha(value: string, factor: number): string {
  const c = parseColor(value);
  if (!c) return value; // hsl() etc. pass through unscaled
  const a = Math.min(1, Math.max(0, c.a * factor));
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Number(a.toFixed(3))})`;
}

const clamp = (v: number, [min, max]: readonly [number, number]): number =>
  Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

// ── apply ─────────────────────────────────────────────────────────────────

interface TargetState {
  theme: JarvisTheme;
  settings: ThemeSettings;
  written: Set<string>;
}

const states = new WeakMap<HTMLElement, TargetState>();

const LINE_KEYS: readonly string[] = ['line.dim', 'line.default', 'line.active'];
const PANEL_KEYS: readonly string[] = ['panel.fill0', 'panel.fill1', 'panel.fillActive'];

const CUT_SCALE: Record<CornerStyle, number> = { 'technical-cut': 1, 'soft-cut': 0.6, square: 0 };

function resolveTarget(target?: HTMLElement): HTMLElement | null {
  if (target) return target;
  return typeof document === 'undefined' ? null : document.documentElement;
}

function render(target: HTMLElement, state: TargetState): void {
  const { theme, settings } = state;
  const style = target.style;
  const borderFactor =
    settings.cyanIntensity *
    ((theme.panels?.borderIntensity ?? REFERENCE_BORDER_INTENSITY) / REFERENCE_BORDER_INTENSITY) *
    (theme.effects?.cyanIntensity ?? 1);
  const panelFactor =
    ((theme.panels?.backgroundOpacity ?? REFERENCE_BACKGROUND_OPACITY) / REFERENCE_BACKGROUND_OPACITY) *
    (1 - 0.75 * settings.panelTransparency);
  const gridFactor = settings.gridVisibility * (theme.effects?.gridVisibility ?? 1);

  const nextWritten = new Set<string>();
  const write = (name: string, value: string): void => {
    style.setProperty(name, value);
    nextWritten.add(name);
  };

  for (const [key, value] of Object.entries(theme.tokens)) {
    const cssName = (THEME_TOKEN_MAP as Record<string, string | undefined>)[key];
    if (!cssName) continue; // unknown keys are tolerated (forward compatibility) but not applied
    let out = value;
    if (LINE_KEYS.includes(key)) out = scaleAlpha(value, borderFactor);
    else if (PANEL_KEYS.includes(key)) out = scaleAlpha(value, panelFactor);
    else if (key === 'grid.color') out = scaleAlpha(value, gridFactor);
    write(cssName, out);
  }

  const cornerStyle = theme.panels?.cornerStyle ?? 'technical-cut';
  write('--jv-cut-scale', String(CUT_SCALE[cornerStyle]));
  write('--jv-font-scale', String(settings.fontScale));
  const orbGlow = (settings.orbGoldIntensity * (theme.orb?.glowIntensity ?? 0.78)) / 0.78;
  write('--jv-orb-intensity', String(Number(orbGlow.toFixed(3))));
  write('--jv-cyan-intensity', String(settings.cyanIntensity));

  // Properties written for a previous theme but absent now must not leak into the new one.
  for (const name of state.written) if (!nextWritten.has(name)) style.removeProperty(name);
  state.written = nextWritten;

  target.setAttribute('data-theme', theme.id);
  target.setAttribute('data-corners', cornerStyle);
  target.setAttribute('data-grid', gridFactor <= 0.001 ? 'off' : 'on');
}

export interface ApplyThemeOptions {
  target?: HTMLElement;
  settings?: Partial<ThemeSettings>;
}

export interface ApplyThemeResult {
  themeId: string;
  /** true when the input was invalid and the default theme was applied instead */
  fallback: boolean;
  errors: string[];
}

function sanitizeSettings(patch: Partial<ThemeSettings>): ThemeSettings {
  const out: ThemeSettings = { ...DEFAULT_THEME_SETTINGS };
  for (const key of Object.keys(SETTING_RANGES) as (keyof ThemeSettings)[]) {
    const value = patch[key];
    if (typeof value === 'number') out[key] = clamp(value, SETTING_RANGES[key]);
  }
  return out;
}

/**
 * Applies a theme to `document.documentElement` (or `options.target`) at runtime.
 * Corrupt input never throws and never half-applies: the default theme is applied (§25.5).
 */
export function applyTheme(input: unknown, options: ApplyThemeOptions = {}): ApplyThemeResult {
  const target = resolveTarget(options.target);
  const validation = validateTheme(input);
  const theme = validation.ok && validation.theme ? validation.theme : defaultTheme;
  const result: ApplyThemeResult = { themeId: theme.id, fallback: !validation.ok, errors: validation.errors };
  if (!target) return result;

  const previous = states.get(target);
  const settings = sanitizeSettings({ ...(previous?.settings ?? DEFAULT_THEME_SETTINGS), ...options.settings });
  const state: TargetState = { theme, settings, written: previous?.written ?? new Set() };
  states.set(target, state);
  render(target, state);
  return result;
}

/** Applies a registered theme by id; unknown ids fall back to the default theme. */
export function applyThemeById(id: string, options: ApplyThemeOptions = {}): ApplyThemeResult {
  const theme = getTheme(id);
  const result = applyTheme(theme ?? null, options);
  return theme ? result : { ...result, errors: [`unknown theme id "${id}"`] };
}

/** Adjusts runtime knobs (cyan intensity, panel transparency, orb gold, grid, font scale). */
export function applyThemeSettings(patch: Partial<ThemeSettings>, target?: HTMLElement): ThemeSettings {
  const el = resolveTarget(target);
  if (!el) return sanitizeSettings(patch);
  let state = states.get(el);
  if (!state) {
    applyTheme(defaultTheme, { target: el });
    state = states.get(el);
  }
  if (!state) return sanitizeSettings(patch);
  state.settings = sanitizeSettings({ ...state.settings, ...patch });
  render(el, state);
  return state.settings;
}

export function getThemeSettings(target?: HTMLElement): ThemeSettings {
  const el = resolveTarget(target);
  return { ...((el && states.get(el)?.settings) || DEFAULT_THEME_SETTINGS) };
}

export function getActiveTheme(target?: HTMLElement): JarvisTheme {
  const el = resolveTarget(target);
  return (el && states.get(el)?.theme) || defaultTheme;
}

/** Serialises a theme for export (§25.5). Contains no secrets by construction. */
export function exportTheme(theme: JarvisTheme = defaultTheme): string {
  return JSON.stringify(theme, null, 2);
}

/** Parses an imported theme file. Invalid JSON or shape → ok:false; the caller falls back to default. */
export function importTheme(json: string): ThemeValidation {
  try {
    return validateTheme(JSON.parse(json));
  } catch (error) {
    return { ok: false, errors: [`invalid JSON: ${(error as Error).message}`] };
  }
}

export type MotionMode = 'full' | 'reduced' | 'off';

/** Sets the in-app animation preference ("Voll / Reduziert / Aus") as data-motion on <html>. */
export function setMotionMode(mode: MotionMode, target?: HTMLElement): void {
  resolveTarget(target)?.setAttribute('data-motion', mode);
}
