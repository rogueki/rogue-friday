# Design System (`@friday/design-tokens`, `@friday/ui`, Storybook)

Binding sources: `docs/PLAN.md` §14, §23–27, §46.2, §51.7 and `docs/briefs/DASHBOARD_DESIGN_BRIEF.md`.
The reference image is a briefing only; nothing in this system copies its texts or assets.

## Packages

| Package | Path | Content |
|---|---|---|
| `@friday/design-tokens` | `packages/design-tokens` | `tokens.css`, TS token mirror, themes, `applyTheme()` |
| `@friday/ui` | `packages/ui` | all components, hooks, `styles.css` (single stylesheet entry) |
| `@friday/storybook` | `apps/storybook` | Storybook 10 catalogue, `OverviewComposition`, screenshot script |

Usage in an app: `import '@friday/ui/styles.css'` once (imports Oxanium / Inter / JetBrains Mono weights 400–700 from
`@fontsource`, then `tokens.css`, then component CSS). No Tailwind, no CSS-in-JS. Components use plain CSS with `jv-` prefixed
BEM-ish class names, so Next.js and Vite need no special loader.

## Tokens

`packages/design-tokens/src/tokens.css` contains

* all §24.15 tokens, verbatim, as `--friday-*` custom properties (a unit test checks each against its TS mirror);
* semantic tone tokens for `cyan | green | violet | amber | red | teal | blue | gold | muted`:
  `--friday-tone-<t>`, `--friday-tint-<t>-bg|border|glow` (derived with `color-mix`, so a theme change re-tints everything);
* spacing scale `--jv-space-1…12`, cut sizes `--jv-cut-xs…lg` (scaled by `--jv-cut-scale`), radii, font families
  (`--jv-font-display|body|mono`), font sizes `--jv-fs-2xs…hero` (scaled by `--jv-font-scale`), tracking;
* panel hierarchy z-index `--jv-z-level-0…4` (+ popover/toast/tooltip), line/row tokens, glow tokens;
* motion durations/easings (`--jv-dur-*`, `--jv-ease-out = cubic-bezier(0.2, 0.8, 0.2, 1)`), `--jv-motion-scale`;
* layout constants (nav width, top/bottom bar height);
* utility classes `.jv-bg-grid` (24 px dot grid), `.jv-bg-radial`, `.jv-bg-stage` (both).

TypeScript mirror (`import { … } from '@friday/design-tokens'`):

| Export | Purpose |
|---|---|
| `fridayTokens`, `colors`, `FridayTokenKey` | name + default value of every binding token |
| `cssVar(key, fallback?)`, `toneVar(tone)`, `readCssVar(key)` | `var(--friday-…)` references / live computed value |
| `toneColors`, `TONES`, `Tone` | default-theme colours per tone (canvas/SVG), tone list |
| `THEME_TOKEN_MAP` | dotted theme key (`color.primary`) → CSS property |
| `zLevels`, `motionTokens`, `spacing`, `fontFamilies` | structural constants |

## Colour discipline

80–85 % navy surfaces · 10–15 % cyan (lines, interaction, focus) · 2–5 % semantic accents (green/amber/red/violet) ·
**gold only in the AI-core context**: `HudPanel tone="gold"`, the orb slot, the voice capsule while F.R.I.D.A.Y. speaks
(`state="speaking"`), `Button variant="friday"`. Never use gold for normal panels, rows or status. Glow is reserved for level 2/3
panels, active tiles and the capsule; text never glows (the clock has a soft halo as the single exception).
States are never colour-only: status chips carry a dot **and** a word, `HealthBadge`/`FreshnessBadge` carry an icon **and** text,
tasks/agents show the status word.

## Panel hierarchy (§24.5)

| Level | Use | Component |
|---|---|---|
| 0 | page background | `.jv-bg-stage` (`FridayShell` applies it) |
| 1 | normal modules | `HudPanel level={1}` |
| 2 | active / selected, cyan glow | `HudPanel level={2}` |
| 3 | attention / approval / critical (`tone` amber or red, glow) | `HudPanel level={3} tone="amber\|red"` |
| 4 | dialog, drawer, command overlay (`z-index: 1000`) | `Dialog`, `Drawer`, `CommandPalette` |

`HudPanel` draws the technical cut with `clip-path` on the frame and a **separate ring layer**
(`clip-path: polygon(evenodd, outer, inner)`, chamfer offset by 0.414·inset) so the 1 px border follows the diagonal at the same
weight; a second, fainter ring 4 px inside forms the inner hairline. The outer glow is a `filter: drop-shadow` on the
unclipped wrapper. Variants: `cut` (`tl-br | tr-bl | all | tl | br | none`), `cutSize` (`sm|md|lg`), `tone`, `glow`,
`brackets` (corner marks on the non-cut corners by default), `padding`, `scroll`, `interactive`.

## Components

Everything is typed, forwards refs where useful, accepts `className`, fetches no data, takes German default labels as props,
and has `:focus-visible` outlines in `--friday-focus`.

* **Shell**: `FridayShell` (grid nav/top/main/bottom, collapsible nav, nav becomes a drawer < 1024 px, skip link, context
  `useFridayShell`), `LeftCommandNav` (brand block with SVG `BrandMark`, items, count badges, collapsed icon-only mode with tooltips,
  scrollable, footer slot), `VoiceStatusPanel` (nav footer + focus-mode button), `TopStatusBar` (system status frame, centred
  date and `Intl` clock by `locale`/`timeZone`/`hour12`, Ctrl+K search trigger, action buttons with badges, operator chip,
  connection status), `BottomCommandBar` (context chips, glowing capsule, waveforms, dotted lines, Stop/Pause, quick action, `compact`).
* **Panels**: `HudPanel`, `HudPanelHeader`, `PanelLink`, `LivePill`, `CornerBrackets`.
* **Status/primitives**: `IconTile`, `TagPill`, `Badge`, `StatusChip`, `StatusDot`, `HealthBadge`, `SourceBadge`, `FreshnessBadge`,
  `Button` (primary, ghost, subtle, danger, friday), `IconButton`, `Skeleton`, `VisuallyHidden`, `Tooltip` (portal, never clipped).
* **Data display**: `CircularMetric` (`null` renders "—" with reason tooltip and `data-missing`, never a fake 0), `MetricCard`,
  `ConstellationGraph`, `Waveform` (canvas; static when `levels` given or motion is reduced; pauses when hidden/offscreen),
  `Timeline`, `ActivityRow`, `ActivityFeed` (virtualized), `DataTable` (virtualized, sortable, keyboard-navigable grid, card mode),
  `FilterBar`.
* **Cards**: `AgentCard` (mini waveform in the agent colour), `ProviderCard`, `TaskCard`, `AlertCard`, `ApprovalCard`
  (`capability` = `available | read-only | missing`), `KanbanColumn`.
* **Forms**: `SearchField`, `TextField`, `Select` (native), `Switch`, `Slider`, `Tabs`.
* **Overlays**: `Dialog`, `ConfirmDialog` (alertdialog), `Drawer`, `CommandPalette` (combobox/listbox, groups, fuzzy ranking,
  preview pane, critical items need a second confirmation §43.4), `Toaster`/`ToastProvider`/`useToast`.
* **States**: `EmptyState`, `ErrorState` (retry + correlation-id copy), `OfflineState`, `DegradedState`, `StaleBanner`.
* **Voice**: `VoiceControl` (rings, waveform, status text; state-driven).
* **Hooks**: `useMotionMode`, `useMediaQuery`, `useControllable`, `useFocusTrap`, `useScrollLock`, `useElementWidth`, `useNow`.

## Theming API (§25)

Theme files live in `packages/design-tokens/src/themes/*.json` (copied to `config/themes/`); the schema is
`theme.schema.json`. Shape (default theme `friday-command-gold-core`, alternative `friday-command-midnight`):

```json
{ "id": "…", "name": "…", "version": 1,
  "tokens": { "color.primary": "#27dcff", "color.background": "#01060c", "color.orb": "#ffb52e", "…": "every token" },
  "orb": { "preset": "gold-fragment-core", "particleDensity": 0.72, "glowIntensity": 0.78, … },
  "panels": { "cornerStyle": "technical-cut | soft-cut | square", "borderIntensity": 0.55, "backgroundOpacity": 0.88 },
  "effects": { "gridVisibility": 1, "cyanIntensity": 1 } }
```

```ts
applyTheme(theme: unknown, { target?, settings? }): { themeId, fallback, errors }   // invalid input -> default theme applied
applyThemeById(id)                       // registered themes, unknown id -> default
validateTheme(input) / importTheme(json) / exportTheme(theme)                        // §25.5, no secrets
applyThemeSettings({ cyanIntensity, panelTransparency, orbGoldIntensity, gridVisibility, fontScale }): ThemeSettings
getThemeSettings() / getActiveTheme() / DEFAULT_THEME_SETTINGS / themes / defaultTheme / midnightTheme
setMotionMode('full' | 'reduced' | 'off')                                              // data-motion on <html>
```

`applyTheme` writes CSS custom properties on `<html>` (no rebuild), tolerates unknown keys, removes properties of the previous
theme, and sets `data-theme`, `data-corners`, `data-grid`. Runtime settings rescale alpha channels
(`cyanIntensity`, `panelTransparency`, `gridVisibility`), `--jv-orb-intensity` (gold glow, also read by the orb package) and
`--jv-font-scale`. Token alphas correspond to the default theme's `borderIntensity 0.55` / `backgroundOpacity 0.88`; other values
scale relative to those. The layout file `config/layouts/friday-command-overview.json` (12 columns, all §27 widgets) drives the
grid placement in the `OverviewComposition` story.

## Motion rules

* `motion/react` for entrances (opacity + small translate, 180–260 ms, ease `[0.2, 0.8, 0.2, 1]`), drawers, toasts.
* Continuous animation (waveforms, live dot, voice rings, shimmer, twinkle) only in mode **full**. Mode resolution
  (`useMotionMode`): `data-motion` on `<html>` (`full | reduced | off`) wins; otherwise `prefers-reduced-motion`.
* CSS: under `reduced`/`off` (or OS reduce without explicit `full`) all animation/transition durations collapse to ~0 and
  every keyframe ends in the resting state, so elements render static, not broken. Canvas waveforms draw a deterministic static
  pattern. No flicker for errors.
* Hover = border brighten, never scale jumps.

## Accessibility (§51.7)

Keyboard everywhere (nav, tabs with arrows/Home/End, grid with arrows/PageUp/PageDown/Home/End/Enter, palette combobox);
dialogs/drawers trap focus, close on Esc, restore focus; icon buttons require `label`; skip link in the shell;
`role="progressbar"`, `aria-sort`, `aria-current`, live regions for results and toasts; text colours meet AA on the navy surfaces
(muted `#7fa6b8` on `#03111d` ≈ 7:1); `forced-colors` is not themed separately yet.

## Storybook

`pnpm --filter @friday/storybook dev` (port 6006) / `build`. Toolbar: **Animationen** (Voll / Reduziert / Aus) and **Theme**.
Stories live in `apps/storybook/src/stories` (+ any `packages/*/src/**/*.stories.tsx`, e.g. the orb). Every component has stories with
the §46.2 states where applicable (empty, loading, error, offline, stale, normal, long German text, 10 000 rows, read-only,
missing capability). `msw-storybook-addon` is wired with an empty handler list (`.storybook/handlers.ts`).
Visual check: `pnpm --filter @friday/storybook build && pnpm --filter @friday/storybook screenshots` writes 1920×1080 PNGs to
`apps/storybook/screenshots/` (use `--base http://localhost:6006` against a running dev server).

## Tests

`npx vitest run packages/ui packages/design-tokens` — token/CSS parity, theme validation and runtime switching, fallback on corrupt
themes, CommandPalette/Dialog/Tabs keyboard behaviour, `CircularMetric` null handling, `FreshnessBadge` text, DataTable and
ActivityFeed virtualization (subset of 10 000 rows), sorting stability.
