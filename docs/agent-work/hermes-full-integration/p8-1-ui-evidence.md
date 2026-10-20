# P8-1 — Profile, dashboard, theme, Orb, layout, and navigation

Baseline: `171fe10`. This is a scoped implementation record for P8-1 in `p7-p8-bundles.md`; it does not change the program-wide acceptance ledger. Source consumers are traced locally, and the focused checks listed below pass. Live restart/runtime and physical device behavior remain separate verification.

## Implemented profile and dashboard consumers

| Setting | UI and consumer path | Evidence |
|---|---|---|
| `profile.displayName` | `settings/BasicAreas.tsx` → `shell/AppTopBar.tsx`; the API runtime also uses it as owner identity. | The top bar now prefers the saved profile name, with session name fallback. |
| `profile.assistantName`, `locale` | `BasicAreas.tsx` → `lib/settings.tsx` → i18n document/title and shell branding; runtime services read the same profile fields. | Existing apply path retained. |
| `profile.timeZone`, `timeFormat`, `dateFormat` | `BasicAreas.tsx` → `lib/settings.tsx` → shared formatting in memory, tasks, system and calendar views. | Added configured date pattern formatting, including date-time values. 12/24-hour and timezone options continue through `Intl`. |
| `profile.firstDayOfWeek` | `BasicAreas.tsx` → memory formatter → `CalendarPage.tsx`, `MonthGrid.tsx`, `dates.ts`. | Week range, month grid, and range label use the configured Monday/Sunday start. |
| `dashboard.activeLayoutId` | `BasicAreas.tsx`/`LayoutArea.tsx` → `overview/OverviewPage.tsx` and `overview/layout.ts`. | Selected server layout resolves into the visible overview widget grid. |
| `dashboard.fontScale`, `backgroundGrid` | `lib/settings.tsx` → design-token theme runtime. | Existing live theme application retained. |
| `dashboard.compact` | `BasicAreas.tsx` → `lib/settings.tsx` sets `html[data-density=compact]` → `app/web.css`. | Added compact spacing for dashboard panels/overview while preserving grid and touch target sizing. |
| `dashboard.autoRefreshSeconds` | `BasicAreas.tsx` → `shell/AppShell.tsx` → `shell/dashboardRefresh.ts`. | Added fallback query invalidation only when realtime is offline, document visible and browser online; cleanup stops the timer and realtime mode does not poll. |
| `dashboard.soundEffects` | `BasicAreas.tsx` → `lib/realtime/applyEvent.ts` → `lib/soundEffects.ts`. | Opt-in sound for newly requested approvals and newly opened notifications; event IDs are deduplicated per query client. Audio API/autoplay failures are ignored. |
| `dashboard.contentStudioEnabled` | Existing nav/route gate in `navModel.tsx` and shell. | Existing visibility and route gate retained. |
| `navigation.order`, `hidden`, `mode` | `NavigationArea.tsx` → `shell/navModel.tsx`/`AppShell.tsx`. | Existing ordering/visibility and expanded/compact nav behavior retained; Settings remains reachable. |
| `navigation.defaultPage` | `NavigationArea.tsx` → new root redirect in `AppShell.tsx`. | Redirect applies only to `/`, preserves deep links, avoids onboarding, and skips disabled Content Studio or unknown routes. |

The date-pattern formatter produces the configured numeric order explicitly, rather than relying on locale defaults that can contradict the selected profile option. Supported patterns are the three UI/schema choices: `dd.MM.yyyy`, `yyyy-MM-dd`, and `MM/dd/yyyy`.

## Existing theme, layout, and Orb paths reviewed

- Theme selection, imported themes, token overrides, cyan intensity, panel opacity and gold intensity are applied by `lib/settings.tsx` through `applyTheme` and `runtimeThemeSettings`; no second theme path was introduced.
- Layout widget geometry/visibility is edited by `LayoutArea.tsx`, persisted through the existing layout API, and rendered by `overview/layout.ts`/`OverviewPage.tsx`.
- `OrbArea.tsx` exposes preset, renderer, size, intensity, speed, particle density, audio-reactive mode, parallax, bloom, animation mode, quality, and status colors. `OrbSlotInner.tsx` maps the wire setting through `orbSettingsFromWire` to `FridayOrb` props; `lib/settings.tsx` applies the motion setting. The existing reduced-motion feature flag still forces reduced motion when required.
- The wire default preset `gold-reference` is accepted by the settings form, while the Orb runtime maps unknown presets to its `gold` preset. This remains behavior-compatible, but the displayed legacy value is not the runtime enum name; selecting a supported preset writes the runtime-native value. This P8-1 patch deliberately leaves Orb rendering/Stop/audio ownership untouched.

## Focused verification

- Web TypeScript check: `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit` — passed.
- Focused Vitest: shared time, calendar dates, dashboard refresh, nav model, and realtime event application — 5 files, 31 tests passed.
- ESLint: all changed TypeScript/TSX source and test files — passed without warnings after correcting the two affected hook dependency lists.
- No live install, provider, device, or deployment test was performed by this UI package.
