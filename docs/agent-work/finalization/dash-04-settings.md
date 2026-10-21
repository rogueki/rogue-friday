# DASH-04 — settings that tell the truth (work record)

2026-10-21/22, branch `feat/friday-finalization-20261021`, commit `5c5d9d4`.

## 1. What already existed (verified, not assumed)

`apps/web/src/features/settings/` holds 45 files and 87 passing tests. The master-detail shell, schema-driven
adapter form, skill accounts area, draft provider, save bar with `If-Match`/409 handling and read-only role
banner were already implemented before this work unit:

| Requirement | Existing proof |
|---|---|
| Master-detail, deep links `?area=…` / `?adapter=…` | `SettingsPage.tsx:186-197`, `SETTINGS_AREAS` in `settingsLogic.ts` |
| Schema form with write-only secrets, cleared after save | `SchemaForm.tsx`, `AdapterForm`, test "masks secrets, sends them only write-only and clears the input after saving" |
| Drafts per area, save, discard, conflict resolution | `SettingsDrafts.tsx`, `settingsLogic.test.ts` |
| Skill accounts master-detail with search and shared key reference | `SkillAccountsArea.tsx` (`search` filter over id/setup text, shared `HERMES_API_KEY` notes) |
| Read-only role cannot write | `readOnly` from `useSettingsDrafts`, `ownerOnly` gate in `AdaptersArea`, "lesende Rolle" tests in `SettingsPage.test.tsx` |

## 2. What was wrong and is now fixed

| Defect | Fix |
|---|---|
| The adapter area claimed "Kalenderansicht verwendet Simulation" in **every** data mode — in a live installation that promise is false | `AdaptersArea` reads `useMeta().data.dataMode`; live says the calendar stays empty until a tested credential exists, hybrid/mock keep the simulation sentence, unknown mode says nothing |
| Categories without an adapter were invisible: an operator could not tell "not set up" from "broken" | New section "Nicht eingerichtete Bereiche" lists every category of the contract enum that has no adapter in a live runtime, with the honest explanation that no replacement adapter exists |
| Switching areas dropped a draft silently | `SettingsPage` asks via `role="alertdialog"` before leaving a dirty area or switching a dirty adapter; "Hier bleiben" keeps the draft, "Verwerfen und wechseln" discards and navigates, `Escape` cancels |

## 3. Evidence

| Check | Command | Result |
|---|---|---|
| new behaviour | `vitest run src/features/settings/HonestAdapters.test.tsx` | 5 passed (3 honest display, 2 draft switch incl. Escape and confirm) |
| no regression in settings | `vitest run src/features/settings` | 87 passed, 15 files |
| dictionary contract | `vitest run src/i18n` | passed (`d.de.ts`/`d.en.ts` carry the four new keys) |
| typecheck | `pnpm typecheck` | exit 0 |
| lint | `pnpm lint` | 0 errors (3 pre-existing hook warnings) |

## 4. Still open for DASH-04

- **04.04 acceptance** (two adapters + two skills configured one after another, restart read-back, owner writes
  vs. read-only role, 390/1024/1920 px and keyboard): the unit level is green, but the plan demands a real
  browser pass. `tests/e2e/settings.spec.ts` exists against the isolated e2e stack; the run is the next step and
  needs `pnpm build:app`.
- **04.05 recovery** (a misconfiguration isolates only its own page, all other settings stay reachable, existing
  accounts migrate): needs the restore path from `acceptance-environment.md` plus a broken single area.
- Skill-account selection currently filters over id/setup text; searching by *source* and *status* columns of
  `IntegrationStatus` needs the DASH-07 inventory first, because only that tells which sources exist.