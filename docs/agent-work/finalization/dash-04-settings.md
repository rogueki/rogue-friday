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

## 4. Browser acceptance (DASH-04.04) in the isolated e2e stack

`tests/e2e/settings-acceptance.spec.ts` (3 tests, green against the built artefacts: `pnpm build:app` plus the
stack from `tests/e2e/stack.ts`, mock mode, dev login, its own temp data dir):

| Step | Evidence |
|---|---|
| Two adapters one after another | `mock-tasks` latency 111 typed, `mock-memory` selected and saved with 333; `GET /settings/adapters` reports `mock-memory.config.latencyMs = 333` |
| Draft kept | Leaving the dirty form opens `role="alertdialog"` naming `mock-memory`; "Hier bleiben" closes it and the field still holds 111 |
| Draft discarded | Second attempt with "Verwerfen und wechseln" switches to `mock-memory` (`aria-current`) and the discarded 111 never reaches the server (`config.latencyMs !== 111`) |
| Restart read-back | Full `page.reload()`, adapter selected again, the form shows 333 from the server |
| Owner writes, read-only does not | Browser session logged in as `dev-viewer`: "Nur lesend" banner, `Speichern` disabled, adapters area "Nur für Eigentümer" instead of credentials |
| 390/1024/1920 px | `document.documentElement.scrollWidth - innerWidth <= 1` at all three widths, settings navigation and area buttons visible |
| Keyboard only | Focus the "Theme" area button, `Enter` opens the draft dialog, focus lands on "Hier bleiben", `Escape` closes it and the typed value survives |

`tests/e2e/settings.spec.ts` (6 existing settings/theme tests) stays green with the extended fixtures.

### Defect found and fixed by the browser pass

The adapter form sent the **settings** version as `If-Match` (`AdaptersArea.tsx:64`). Each adapter carries its
own revision (`AdapterSettingsService.patch` compares `AdapterConfigSettings.version`), so as soon as the two
counters diverged the save failed with `409 CONFLICT` ("erwartet Version 1, aktuell 2") although nothing was
stale. Fixed to `adapter.version ?? 1`; proved by the e2e save (adapter revision 2, settings revision 1) and by
`SettingsPage.test.tsx` / `HonestAdapters.test.tsx`, which now assert `If-Match: 7` against a fake settings
version of 3.

### Fixture change

`cleanWorld` restored only `/settings`; it now also captures and restores every adapter through
`PATCH /settings/adapters/{id}` (`restoreAdapters`), because `adapters` is a read-only mirror inside the
settings payload and `PATCH /settings` rejects it with 422 `additionalProperties`.

## 6. Nachtrag 2026-10-22: Skillkonten als Master-Detail (DASH-04.03/04.04/04.05)

### Befund

Die Skillkonten-Seite war **integrationszentriert**: eine flache Suche ueber alle Integrationen, und die Kontoanforderung
eines Skills war nur als Fliestext ("Benoetigt von: ...") sichtbar. Man konnte nicht vom Skill aus lesen, welche Konten
er braucht, und ein von mehreren Skills genutzter Schluessel wurde nirgends als geteilt gekennzeichnet.

### Umsetzung

| Teil | Datei | Inhalt |
|---|---|---|
| Reine Logik | `apps/web/src/features/settings/skillAccountPlan.ts` | `skillAccounts`, `skillState` (bereit / Pflichtkonto fehlt / unbekannt / deaktiviert / unbeobachtet), `skillSummaries` (offene Faelle zuerst), `filterSkills` (Name, Quelle, Kategorie, Zustandstext + exakter Zustandsfilter), `sharedWith` / `sharedAccountIds` |
| Bedienoberflaeche | `SkillAccountWorkbench.tsx` | Links Suche + Zustandsfilter + Liste mit Name, Quelle (Friday/Hermes) und Zustand; rechts **nur** die Konten des gewaehlten Skills, Pflicht und optional getrennt, "Geteilt mit ..." mit dem Hinweis, dass ein hinterlegter Schluessel nicht erneut abgefragt wird. Kein Eingabefeld in der Detailansicht - die Schluesselfelder bleiben genau einmal weiter unten auf der Seite |
| Einbindung | `SkillAccountsArea.tsx` | Abschnitt "Skills und ihre Konten" ueber dem Integrationskatalog; Tiefenlink `?area=skillAccounts&skill=<id>` ueber `router.replace` |
| Stil | `features/skills/skills.css` | `.sk-workbench*`, `.sk-badge--friday/--hermes`, Zustandsfarben, einspaltig unter 1024 px |

Kontraktseitig wurde nichts geaendert: die Ansicht liest ausschliesslich `/api/v1/skills`, das bereits `source`,
`enabled`, `discovered` und `integrationDetails[].configured` liefert.

### Nachweise

| Pruefung | Ergebnis |
|---|---|
| `skillAccountPlan.test.ts` | 6 Tests: Zustaende inkl. unbekannt/deaktiviert/unbeobachtet, Sortierung, Suche ueber Name/Quelle/Zustandstext, Zustandsfilter, geteilte Konten |
| `SkillAccountWorkbench.test.tsx` | 5 Tests: Liste mit Quelle und Zustand, rechts nur die Konten des gewaehlten Skills, "Geteilt mit Termine" ohne zweites Eingabefeld, Suche/Filter/Leerzustand, Tastatur (Enter, Pfeil ab, Fokus bleibt in der Liste), Nur-Lese-Hinweis und leerer Katalog |
| `SkillAccountsResilience.test.tsx` | 2 Tests (DASH-04.05): kaputter Katalog zeigt den Fehler nur im Skillbereich und erfindet keine Konten; der Profilbereich bleibt editierbar und speichert, ohne den Katalog anzufragen |
| `vitest run --project web features/settings` | **18 Dateien, 101 Tests gruen** |
| `tsc -p apps/web/tsconfig.json --noEmit` | 0 Fehler |
| Browser (DASH-04.04) | `pnpm build:app` + `playwright test tests/e2e/settings-acceptance.spec.ts` → **4 Tests gruen in 48,2 s**, davon der neue Skilltest 20,1 s |

Der Browserlauf prueft real: zwei Skills nacheinander auswaehlen (`aria-pressed` wechselt), die Detailansicht nennt
jeweils nur den gewaehlten Skill, enthaelt **kein** Eingabefeld, Suche bis zum Leerzustand und zurueck, Tastatur
(Enter waehlt, Pfeil ab wechselt die Auswahl), und 390/1024/1920 px ohne waagerechten Ueberlauf
(`scrollWidth - innerWidth <= 1`).

### Testdaten fuer den E2E-Stack

Der Stack hatte keinen Skillkatalog (`FRIDAY_SKILLS_CATALOG_PATH` unset), die Seite zeigte daher "Der Skillkatalog ist
leer". Neu: `tests/e2e/fixtures/skills/{integration_setup.json,skills.json}` im echten Registry-Format mit zwei Skills
("Kalender", "Reiseplanung"), die sich das CalDAV-Konto teilen; `tests/e2e/stack.ts` setzt
`FRIDAY_SKILLS_CATALOG_PATH` darauf. Kein Produktivpfad betroffen, kein Mock in der Anwendung - die Dateien sind
Eingabedaten fuer den Testserver.

Fallstrick fuer spaetere Aenderungen: `SkillsService.catalog()` verwirft einen Katalog, wenn `inventory_count` fehlt
(`Number(undefined)` ist NaN) - der Fixture muss die Anzahl also nennen.

## 5. Still open for DASH-04

- **04.03** skill-account search by *source* and *status*: the filter covers id and setup text only. The source
  and status columns come from `IntegrationStatus`, whose authoritative list is the DASH-07 inventory.
- **04.04** two *skills* configured one after another: the e2e stack has no skills catalog
  (`GET /skills` → `catalogError: "Skills-Katalogpfad nicht konfiguriert"`) and skill accounts live in
  Hermes inside Friday-Ubuntu, which is not reachable from the stack (`ADAPTER_UNAVAILABLE`). The adapter half,
  draft handling, read-back, roles, widths and keyboard are proven; the skill half needs a stack with a catalog
  path and a Hermes bridge.
- **04.05** recovery (one broken area isolates only its own page, all other settings stay reachable, existing
  accounts migrate): the adapter-level conflict handling is now correct, the isolation drill is still open.