// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_SETTINGS,
  THEME_TOKEN_MAP,
  applyTheme,
  applyThemeById,
  applyThemeSettings,
  cssVar,
  defaultTheme,
  getActiveTheme,
  importTheme,
  jarvisTokens,
  midnightTheme,
  parseColor,
  themes,
  validateTheme,
} from './index';

const here = dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(resolve(here, 'tokens.css'), 'utf8');

/** Compares colours independent of whitespace, case and trailing zeros (0.20 == 0.2). */
function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/(\.\d*?)0+\)/, '$1)');
}

function varOf(name: string, el: HTMLElement = document.documentElement): string {
  return el.style.getPropertyValue(name);
}

describe('tokens', () => {
  it('declares every binding §24.15 token in tokens.css with the exact default value', () => {
    for (const { name, value } of Object.values(jarvisTokens)) {
      const re = new RegExp(`${name}:\\s*([^;]+);`);
      const match = re.exec(tokensCss);
      expect(match, `${name} missing in tokens.css`).not.toBeNull();
      expect(normalise(match?.[1] ?? '')).toBe(normalise(value));
    }
  });

  it('provides reduced-motion overrides', () => {
    expect(tokensCss).toContain('prefers-reduced-motion');
    expect(tokensCss).toContain("[data-motion='reduced']");
    expect(tokensCss).toContain("[data-motion='off']");
  });

  it('cssVar builds var() references', () => {
    expect(cssVar('cyan')).toBe('var(--jarvis-cyan)');
    expect(cssVar('bg0', '#000')).toBe('var(--jarvis-bg-0, #000)');
  });

  it('maps every theme token key to a declared CSS custom property', () => {
    for (const cssName of Object.values(THEME_TOKEN_MAP)) expect(tokensCss).toContain(`${cssName}:`);
  });
});

describe('themes', () => {
  it('ships a default theme in the §25.3 shape covering every token', () => {
    expect(defaultTheme.id).toBe('jarvis-command-gold-core');
    expect(defaultTheme.tokens['color.primary']).toBe('#27dcff');
    expect(defaultTheme.tokens['color.background']).toBe('#01060c');
    expect(defaultTheme.tokens['color.orb']).toBe('#ffb52e');
    expect(defaultTheme.tokens['color.orbHot']).toBe('#fff2ba');
    expect(defaultTheme.orb?.preset).toBe('gold-fragment-core');
    expect(defaultTheme.panels?.cornerStyle).toBe('technical-cut');
    expect(Object.keys(defaultTheme.tokens).sort()).toEqual(Object.keys(THEME_TOKEN_MAP).sort());
    expect(Object.keys(midnightTheme.tokens).sort()).toEqual(Object.keys(THEME_TOKEN_MAP).sort());
  });

  it('all registered themes validate', () => {
    for (const t of themes) expect(validateTheme(t)).toMatchObject({ ok: true });
  });

  it('config/themes copies are identical to the package themes', () => {
    for (const id of ['jarvis-command-gold-core', 'jarvis-command-midnight']) {
      const pkg = readFileSync(resolve(here, 'themes', `${id}.json`), 'utf8');
      const cfg = readFileSync(resolve(here, '../../../config/themes', `${id}.json`), 'utf8');
      expect(JSON.parse(cfg)).toEqual(JSON.parse(pkg));
    }
  });
});

describe('validateTheme', () => {
  it('rejects malformed input with readable errors', () => {
    expect(validateTheme(null).ok).toBe(false);
    expect(validateTheme({ id: 'x', name: '', tokens: 1 }).errors.length).toBeGreaterThanOrEqual(2);
    const bad = validateTheme({ id: 'ok-id', name: 'T', tokens: { 'color.primary': 'url(javascript:alert(1))' } });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toContain('invalid colour value');
    expect(validateTheme({ id: 'ok-id', name: 'T', tokens: {}, panels: { cornerStyle: 'round' } }).ok).toBe(false);
    expect(validateTheme({ id: 'ok-id', name: 'T', tokens: {}, orb: { glowIntensity: 9 } }).ok).toBe(false);
  });

  it('importTheme handles invalid JSON', () => {
    expect(importTheme('{nope').ok).toBe(false);
    expect(importTheme(JSON.stringify(midnightTheme)).ok).toBe(true);
  });
});

describe('applyTheme', () => {
  let el: HTMLElement;
  beforeEach(() => {
    el = document.createElement('div');
  });

  it('applies the default theme at runtime', () => {
    const result = applyTheme(defaultTheme, { target: el });
    expect(result).toEqual({ themeId: 'jarvis-command-gold-core', fallback: false, errors: [] });
    expect(varOf('--jarvis-cyan', el)).toBe('#27dcff');
    expect(varOf('--jarvis-bg-0', el)).toBe('#01060c');
    expect(el.getAttribute('data-theme')).toBe('jarvis-command-gold-core');
    expect(varOf('--jv-cut-scale', el)).toBe('1');
  });

  it('switches themes without leaking values', () => {
    applyTheme(defaultTheme, { target: el });
    applyTheme(midnightTheme, { target: el });
    expect(varOf('--jarvis-cyan', el)).toBe('#2fb8d6');
    expect(el.getAttribute('data-theme')).toBe('jarvis-command-midnight');
    expect(varOf('--jv-cut-scale', el)).toBe('0.6');
    expect(getActiveTheme(el).id).toBe('jarvis-command-midnight');
  });

  it('falls back to the default theme on corrupt input (§25.5)', () => {
    const result = applyTheme({ id: 'broken', name: 'x', tokens: { 'color.primary': 'javascript:evil' } }, { target: el });
    expect(result.fallback).toBe(true);
    expect(result.themeId).toBe('jarvis-command-gold-core');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(varOf('--jarvis-cyan', el)).toBe('#27dcff');
    expect(applyTheme('not a theme', { target: el }).fallback).toBe(true);
    expect(applyThemeById('does-not-exist', { target: el }).fallback).toBe(true);
  });

  it('adjusts cyan intensity, panel transparency, grid, gold and font scale at runtime', () => {
    applyTheme(defaultTheme, { target: el });
    const base = parseColor(varOf('--jarvis-border', el));
    expect(base?.a).toBeCloseTo(0.42, 2);

    applyThemeSettings({ cyanIntensity: 0.5 }, el);
    expect(parseColor(varOf('--jarvis-border', el))?.a).toBeCloseTo(0.21, 2);

    applyThemeSettings({ panelTransparency: 1 }, el);
    expect(parseColor(varOf('--jarvis-panel-1', el))?.a).toBeCloseTo(0.84 * 0.25, 2);

    applyThemeSettings({ gridVisibility: 0 }, el);
    expect(el.getAttribute('data-grid')).toBe('off');
    expect(parseColor(varOf('--jarvis-grid', el))?.a).toBe(0);

    applyThemeSettings({ orbGoldIntensity: 1.5, fontScale: 1.2 }, el);
    expect(varOf('--jv-orb-intensity', el)).toBe('1.5');
    expect(varOf('--jv-font-scale', el)).toBe('1.2');
  });

  it('clamps out-of-range settings', () => {
    applyTheme(defaultTheme, { target: el });
    const s = applyThemeSettings({ cyanIntensity: 99, fontScale: -3 }, el);
    expect(s.cyanIntensity).toBe(1.5);
    expect(s.fontScale).toBe(0.85);
    expect(DEFAULT_THEME_SETTINGS.cyanIntensity).toBe(1);
  });
});
