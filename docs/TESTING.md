# Testing: F.R.I.D.A.Y. Command Center

Stand: 2026-10-15. Dieses Dokument beschreibt die Testebenen des Monorepos, wie sie lokal und in der Cloud laufen, und welche Anforderungen aus `docs/PLAN.md` §51 und §52 abgedeckt sind. Befehle stammen aus der Root-`package.json`; Zahlen sind entweder selbst gemessen (Spalte "Beleg") oder übernommen und entsprechend markiert.

Verbindliche Gates stehen in `CLAUDE.md` und `docs/IMPLEMENTATION_CONVENTIONS.md` §10.

## 1. Testpyramide

| Ebene                                 | Werkzeug                                                                              | Befehl                                                         | Was geprüft wird                                                                                                                                                                                           | Umfang und Laufzeit                                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts                             | Redocly, AsyncAPI-Parser, JSON-Schema (Node-Skripte in `packages/contracts/scripts/`) | `pnpm contracts:check`                                         | OpenAPI- und AsyncAPI-Lint, Schema- und Beispielvalidierung, generiertes SDK aktuell, Breaking-Change-Erkennung                                                                                            | 4 Schritte, 122 Operationen. Laufzeit ca. 7 s (gemessen). Der Control-API-Vertragstest deckt alle 122 Operationen ab (`apps/control-api/test/contract.test.ts`, läuft unter `pnpm test`).                                                                |
| Unit und Komponente                   | Vitest (Root-`vitest.config.ts` mit `projects`), jsdom, Testing Library               | `pnpm test`                                                    | Mapper, Adapter-Registry, Zustandsmaschinen, Orb-Arbitrierung, Rechte, Formatierung, Fehlerabbildung, React-Komponenten                                                                                    | 110 Dateien, 2469 Tests bestanden, 60 übersprungen (gemessen, 101 s). Enthält auch die 10 Conformance-Dateien (siehe unten).                                                                                                                             |
| Adapter-Conformance                   | Vitest mit `@friday/adapter-testkit`                                                  | `pnpm test:conformance`                                        | 21 Prüfpunkte je Adapter (PLAN §11, Details in `docs/ADAPTER_CONFORMANCE.md`)                                                                                                                              | 10 Adapter, 422 Tests bestanden, 60 übersprungen (482 gesamt, gemessen, 29 s)                                                                                                                                                                            |
| Storybook-Audit                       | Chromium über `@playwright/test`, axe-core                                            | `node apps/storybook/scripts/audit.mjs` (nach Storybook-Build) | Jede Story rendert, keine Seiten-, Konsolen- oder HTTP-Fehler, axe mit WCAG 2.0/2.1 A und AA plus Best Practice                                                                                            | 254 Stories laut Auftrag; nicht exakt reproduziert (siehe Abschnitt 10). Kein npm-Skript, kein Gate.                                                                                                                                                     |
| End-to-End, Visual, A11y, Performance | Playwright (Chromium, seriell, 1 Worker)                                              | `pnpm test:e2e`                                                | Navigation, Szenario-Wechsel, Aufgaben, Freigaben, Live-Aktivität, Agenten, Gedächtnis, Meldungen und Alarme, Ausfälle, Orb-Zustände, Befehlsleiste, Einstellungen, Theme, Reconnect, 2D-Fallback, Visual Regression, axe und Tastatur, Last- und Performance-Budgets | 204 Tests in 20 Dateien (gemessen per `--list`, davon 40 in den vier Modul-Flows). Laufzeit 42,7 min (gemessen, vollständiger Lauf 2026-10-15).                                                                                                                                                       |
| Integration                           | Playwright mit Fake-Upstreams                                                         | `pnpm test:integration`                                        | Kette Fake-Upstream, echter Adapter, Control API im Live-Modus, Web-UI; Ausfall und Erholung von Voice und Hermes                                                                                        | 7 Tests in 1 Datei (gemessen per `--list`). Laufzeit 3,3 bis 3,5 min laut `docs/evidence/integration/README.md` (Lauf 2026-10-14).                                                                                                                       |
| Installer, Voice                      | pytest                                                                                | `python -m pytest installer/voice/tests`                       | Persona und Namens-Slug, Wake-Word-Logik (Schwellen, Service-Stufen, Barge-in, Pre-roll)                                                                                                                   | 12 Tests in `test_personal_wake.py` (gemessen: 12 bestanden in 8 s, in einer venv mit numpy, pytest und scikit-learn, ohne openwakeword). Die Zahl ändert sich mit dem Bestand, aktuell ergänzt durch `test_audio_level.py` (in Arbeit, nicht gemessen). |
| Installer, statisch                   | PowerShell-Parser, ShellCheck, pyflakes                                               | manuell, kein Skript im Repo                                   | PowerShell-Syntax der `.ps1`, Stil der WSL-`.sh`-Skripte                                                                                                                                                   | Ergebnisse dokumentiert in `docs/INSTALLER_INTEGRATION_REVIEW.md`. Nicht automatisiert, nicht in CI.                                                                                                                                                     |

## 2. Gates

### Pflichtfolge (CLAUDE.md)

```bash
pnpm contracts:check && pnpm typecheck && pnpm lint && pnpm test && pnpm test:conformance && pnpm build
pnpm test:e2e   # Playwright-Suite gegen den gebauten Stack
```

### Was die CI tatsächlich ausführt

Quelle: `.github/workflows/ci.yml`.

| Schritt                 | Lokal (Pflicht) | CI-Job `verify` | CI-Job `e2e`       |
| ----------------------- | --------------- | --------------- | ------------------ |
| `pnpm contracts:check`  | ja              | ja              | nein               |
| `pnpm typecheck`        | ja              | ja              | nein               |
| `pnpm lint`             | ja              | ja              | nein               |
| `pnpm format:check`     | nein            | ja              | nein               |
| `pnpm test`             | ja              | ja              | nein               |
| `pnpm test:conformance` | ja              | ja              | nein               |
| `pnpm build`            | ja              | ja              | ja                 |
| `pnpm test:e2e`         | ja              | nein            | ja (nach `verify`) |
| `pnpm test:integration` | nein            | nein            | nein               |
| Storybook-Audit         | nein            | nein            | nein               |
| Installer-pytest        | nein            | nein            | nein               |

Hinweise:

- Die CI läuft mit Node 24, `CLAUDE.md` nennt Node ≥ 22.13 (Cloud: `/opt/node22`). Beides erfüllt `engines`.
- Die 10 Conformance-Dateien laufen zweimal: einmal unter `pnpm test` (Vitest-Include `adapters/*/test/**`), einmal unter `pnpm test:conformance`.
- `pnpm test:integration` und die Installer-Tests haben kein CI-Gate.

## 3. Lokal ausführen

Voraussetzung: `pnpm install` (in Cloud-Sessions übernimmt `scripts/cloud-setup.sh` das).

### Contracts, Typen, Unit

```bash
pnpm contracts:check                       # Lint, Validierung, Generierung, Breaking-Check
pnpm contracts:generate                    # nach jeder Vertragsänderung; danach contracts:check
pnpm test                                  # gesamter Workspace
pnpm exec vitest run apps/web/src/features/tasks/tasks.test.tsx   # eine Datei
pnpm exec vitest run --coverage            # Coverage nach coverage/ (v8)
```

### Conformance

```bash
pnpm test:conformance                      # alle Adapter in adapters/*
pnpm exec vitest run adapters/example-http # ein Adapter
```

Ein neuer Adapter braucht nur `adapters/<name>/test/conformance.test.ts` (Details: `docs/ADAPTER_CONFORMANCE.md`).

### Storybook-Audit

```bash
pnpm --filter @friday/storybook build      # erzeugt apps/storybook/storybook-static
node apps/storybook/scripts/audit.mjs      # alle Stories
node apps/storybook/scripts/audit.mjs --only <Story-ID-Teil> --json <datei>
```

Weitere Optionen des Skripts: `--shots <verzeichnis>` (PNG je Story), `--concurrency <n>`, `--executable <chromium>`, `--motion off|reduced|full`. Der Chromium-Pfad lässt sich auch über `CHROMIUM_PATH` setzen.

### End-to-End (`pnpm test:e2e`)

```bash
pnpm build:app                             # nur nötig, wenn apps/web/out oder apps/control-api/dist fehlt oder veraltet ist
pnpm test:e2e                              # komplette Suite, 204 Tests
pnpm test:e2e tests/e2e/tasks.spec.ts      # eine Spec (ohne "--" davor)
pnpm test:e2e tests/e2e/performance.spec.ts -g soak   # Spec-Teil per Titel
pnpm test:e2e:update                       # Visual-Baselines neu erzeugen (siehe Abschnitt 6)
E2E_SOAK=1 pnpm test:e2e tests/e2e/performance.spec.ts -g soak   # 30-Minuten-Soak statt 2 Minuten
```

Hinweis: Spec-Auswahl mit `pnpm test:e2e <spec>` (ohne `--`; mit `--` würde pnpm alle 204 Tests starten) oder `pnpm exec playwright test <spec>`.

Entwicklung einer Spec ohne Neustart des Stacks:

```bash
pnpm exec tsx tests/e2e/stack.ts                          # Terminal 1: Stack von Hand
FRIDAY_E2E_REUSE=1 pnpm test:e2e tests/e2e/tasks.spec.ts  # Terminal 2
```

Umgebungsvariablen (E2E):

| Variable           | Standard                    | Wirkung                                                        |
| ------------------ | --------------------------- | -------------------------------------------------------------- |
| `FRIDAY_E2E_PORT`  | `3200`                      | Port der Control API im Teststack                              |
| `FRIDAY_E2E_DIR`   | `<tmp>/friday-e2e`          | Datenverzeichnis des Stacks                                    |
| `FRIDAY_E2E_BUILD` | leer                        | `1` erzwingt `pnpm build:app` vor dem Start                    |
| `FRIDAY_E2E_REUSE` | leer                        | `1`: vorhandenen Stack wiederverwenden (`reuseExistingServer`) |
| `FRIDAY_CHROMIUM`  | Cloud-Pfad, falls vorhanden | Chromium-Binary für Playwright                                 |
| `E2E_SOAK`         | leer                        | `1`: Orb-Soak 30 min statt 2 min                               |

Der Stack läuft aus einer Kopie von `apps/web/out` in einem Temp-Verzeichnis, ein paralleler Rebuild verändert den Lauf also nicht.

### Integration (`pnpm test:integration`)

```bash
pnpm build:app                             # Pflicht: die Integration startet apps/control-api/dist/main.js und apps/web/out
pnpm test:integration
```

Die Spec `tests/integration/hybrid.spec.ts` startet über `tests/integration/stack.ts` Fake-Upstreams auf den Installer-Ports (Hermes-Dashboard 43691, Qwen 43692, Hermes-API 43693, Voice 43694, Steuerung 43699) und die Control API im Live-Modus auf Port 3100. Der Circuit Breaker ist für den Lauf auf 3 Fehler und 5 s Reset gekürzt, damit Erholung in Sekunden sichtbar wird.

| Variable                  | Standard                            | Wirkung                     |
| ------------------------- | ----------------------------------- | --------------------------- |
| `FRIDAY_INTEGRATION_PORT` | `3100`                              | Port der Control API        |
| `FRIDAY_INTEGRATION_DIR`  | `<tmp>/friday-integration`          | Arbeitsverzeichnis          |
| `FRIDAY_EVIDENCE_DIR`     | `test-results/integration/evidence` | PNG-Ausgabe der Screenshots |
| `FRIDAY_CHROMIUM`         | Cloud-Pfad, falls vorhanden         | Chromium-Binary             |

Ausfälle lassen sich von Hand auslösen, solange der Fake-Upstream läuft: `curl -X POST http://127.0.0.1:43699/services/<voice|hermes|hermes-api|hermes-dashboard|llama>/<stop|start>`. Die Evidenz-WebPs in `docs/evidence/integration/` entstehen aus den PNGs (Qualität 80, siehe dortiger README).

### Installer-Voice

```bash
python -m pytest installer/voice/tests     # in einer venv mit numpy, pytest, scikit-learn (openwakeword nicht nötig)
```

Der synthetische Benchmark `installer/voice/tests/eval_synthetic_wake.py` ist kein pytest-Test (keine `test_`-Funktionen). Er braucht Piper-Stimmen und Modelle, siehe Docstring.

### Screenshots (keine Tests)

```bash
pnpm --filter @friday/web screenshots      # apps/web/scripts/screenshot.mjs, braucht eine laufende Control API und pnpm --filter @friday/web dev
```

## 4. Cloud-Sessions

- Node 22 liegt unter `/opt/node22`, Abhängigkeiten installiert der SessionStart-Hook `scripts/cloud-setup.sh`.
- Chromium: Standardpfad `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Die Playwright-Configs nutzen ihn, wenn er existiert, sonst den von Playwright verwalteten Browser. Installation bei Bedarf: `pnpm exec playwright install chromium`. Ist der Download im Cloud-Netz blockiert, siehe `CLAUDE.md` ("Umgebung").
- WebGL in Software: die Suite startet Chromium mit `GL_ARGS` aus `tests/e2e/support/browser.ts` (`--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --enable-webgl`). 2D-Fallback-Tests starten ohne GPU mit `NO_GL_ARGS` (`--disable-gpu --disable-webgl`).
- Die Cloud hat keine GPU und kein Windows. Die Installer-Skripte sind dort nicht ausführbar (siehe Abschnitt 8).

## 5. Determinismus

| Größe                        | Wert                                                                  | Quelle                                                                |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Mock-Seed                    | `42`                                                                  | `DEFAULT_SEED` in `packages/mock-data/src/world/world.ts`             |
| Mock-Startzeit               | `2026-10-14T08:15:00Z` (UTC)                                          | `DEFAULT_START_TIME`, wird im Test-Browser als 10:15 Berlin angezeigt |
| Browser-`Date`               | eingefroren auf `2026-10-14T08:15:30.000Z`                            | `freezeDate()` in `tests/e2e/support/fixtures.ts`                     |
| Welt-Reset                   | vor jedem Test, Einstellungen wiederhergestellt                       | Auto-Fixture `cleanWorld` in `tests/e2e/support/fixtures.ts`          |
| Ausführung                   | seriell, 1 Worker, Timeouts 90 s (E2E) bzw. 120 s (Integration)       | `playwright.config.ts`, `playwright.integration.config.ts`            |
| Locale, Zeitzone, Farbschema | `de-DE`, `Europe/Berlin`, `dark`                                      | beide Playwright-Configs                                              |
| Viewport                     | 1920x1080 (E2E), 1600x900 (Integration)                               | beide Playwright-Configs                                              |
| Screenshot-Toleranz          | `maxDiffPixelRatio: 0.01`, Animationen aus, Caret aus, `scale: "css"` | `playwright.config.ts`                                                |
| Schreibende API-Aufrufe      | automatischer `Idempotency-Key`                                       | `tests/e2e/support/api.ts`                                            |

Die Live-Latenzanzeige des Event-Streams, "Aktualisiert hh:mm" und die Host-Metriken sind in den Visual-Tests maskiert.

### Orb-Testtakt (PLAN §52)

Der Testtakt wirkt nur, wenn `GET /meta` `features.devScenarios` meldet. In der Produktion werden die Parameter ignoriert (Test in `visual.spec.ts`).

| Zugang        | Form                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| URL-Parameter | `?orbTime=4&orbProgress=0.5&orbAudio=loud&orbFrameMs=40`                                                            |
| Window-Hook   | `window.__FRIDAY_ORB_TEST__ = { fixedTime, animationProgress, audioFixture, frameMs }` plus Event `friday-orb-test` |
| Rückmeldung   | `window.__ORB_DEBUG__.testClock` (Takt, den der Frame-Loop angewendet hat) und `frames`                             |

Mit `fixedTime` ist ein Frame eine reine Funktion aus Modus, Zeit, Fortschritt und Audio-Fixture. Die 3D-Qualität ist auf `medium` gepinnt. `frameMs` ersetzt die gemessene Frame-Zeit des Qualitätsreglers. Quelle: `apps/web/src/features/orb/orbTestHook.ts`.

Die Audio-Fixtures heißen `silence`, `normal`, `loud`, `tts`, `spike` (`packages/orb/src/audio/fixtures.ts`).

## 6. Visual-Baselines

- Ablage: `tests/e2e/__screenshots__/visual.spec.ts/`. Dateiname `<name>-<platform>.png`. Der Bestand umfasst 71 PNG-Dateien, alle mit Suffix `-linux` (gezählt).
- Baselines sind plattformspezifisch (Schriften, Antialiasing, SwiftShader). Auf Windows fehlen sie, der Lauf meldet dann fehlende Snapshots. Neu erzeugen mit `pnpm test:e2e:update` (danach Bilder ansehen und committen). Die 3D-Baselines `orb3d-*` sind nur unter Linux/SwiftShader reproduzierbar.
- Die 17 deterministischen 3D-Frames: `orb3d-{booting,error,success}-{entry,mid,stable,exit}` (12) und `orb3d-speaking-audio-{silence,normal,loud,tts,spike}` (5).
- Die 14 statischen 2D-Orb-Modi: `booting`, `idle`, `listening`, `transcribing`, `thinking`, `syncing`, `working`, `speaking`, `waiting_approval`, `success`, `warning`, `error`, `offline`, `paused` (Quelle: `ORB_MODES` in `tests/e2e/support/fixtures.ts`).

## 7. Mock-Szenarien in den Tests

Szenario-IDs stehen in `packages/mock-data/src/scenarios/definitions.ts`. Abspielen über `POST /api/v1/dev/scenarios/{id}/play` (nur auf dem E2E-/Testserver, injizierte Simulation).

| Szenario                            | Verwendet in                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `partial-outage`                    | `visual.spec.ts`, `outage.spec.ts`, `a11y.spec.ts`                                          |
| `critical-alert`                    | `visual.spec.ts`, `a11y.spec.ts`                                                            |
| `approval-waiting`                  | `visual.spec.ts`, `orb-states.spec.ts`                                 |
| `empty-new-installation`            | `visual.spec.ts`                                                                            |
| `long-german-text`                  | `visual.spec.ts`                                                                            |
| `voice-pipeline`                    | `orb-states.spec.ts`                                                                        |
| `adapter-recovery`                  | `outage.spec.ts`                                                                            |
| `reduced-motion`                    | `fallback-2d.spec.ts`                                                                       |
| `webgl-failure`                     | `fallback-2d.spec.ts`                                                                       |
| `high-load`                         | `performance.spec.ts` (1 000 Tasks, 10 000 Events, 100 Agenten)                             |
| `listening`, `syncing`              | Listen in `support/fixtures.ts` bzw. `performance.spec.ts`, kein eigener Testfall           |
| `clean-idle`, `multi-agent-working` | Testfixtures in `packages/mock-data`, kein eigener Testfall |

Ausführliche Beschreibung: `docs/MOCK_SCENARIOS.md`.

## 8. Abdeckung PLAN §51 und §52

Legende: **ja** = durch benannte Datei(en) abgedeckt. **teilweise** = nur ein Teil des Punkts oder nur Stichproben. **nein** = nicht abgedeckt.

### §51.1 Contract-Tests

| Punkt                     | Stand | Datei(en)                                                                       |
| ------------------------- | ----- | ------------------------------------------------------------------------------- |
| OpenAPI-Lint              | ja    | `packages/contracts/scripts/lint.mjs` (Redocly über `lib/redocly.mjs`)          |
| AsyncAPI-Lint             | ja    | `packages/contracts/scripts/lint.mjs` (`lib/asyncapi.mjs`)                      |
| Schema-Validierung        | ja    | `packages/contracts/scripts/validate.mjs` (Strict-Modus)                        |
| Beispiele gültig          | ja    | `validate.mjs`, `packages/contracts/test/examples.test.ts`                      |
| Generierter Code aktuell  | ja    | `packages/contracts/scripts/check-generated.mjs`                                |
| Breaking-Change-Erkennung | ja    | `packages/contracts/scripts/breaking.mjs`, `test/breaking.test.ts`, `baseline/` |

### §51.2 Unit-Tests

| Punkt             | Stand     | Datei(en)                                                                                                                                                    |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mapper            | ja        | `adapters/hermes/test/tasks.test.ts`, `adapters/voice-http/test/mapping.test.ts`, `packages/adapter-core/test/mapping.test.ts`                               |
| Adapter-Registry  | ja        | `packages/adapter-core/test/registry.test.ts`, `adapters/hermes/test/registry.test.ts`                                                                       |
| Zustandsmaschinen | teilweise | `packages/orb/src/machine/orbMachine.test.ts`, `apps/web/src/lib/realtime/client.test.ts` und `applyEvent.test.ts`. Weitere Maschinen nicht gezielt geprüft. |
| Orb-Arbitrierung  | ja        | `packages/orb/src/machine/orbMachine.test.ts` (`arbitrateOrbState`, PLAN 18.3)                                                                               |
| Rechte            | ja        | `packages/auth/src/auth.test.ts`, `apps/control-api/test/approvals.test.ts`, `apps/control-api/test/security.test.ts`                                        |
| Formatierung      | ja        | `apps/web/src/features/system/format.test.ts`, `apps/web/src/features/calendar/dates.test.ts`, `apps/web/src/i18n/i18n.test.ts`                              |
| Fehlerabbildung   | ja        | `packages/adapter-core/src/errors.test.ts`; Normalisierung zusätzlich in Conformance-Prüfung 15                                                              |

### §51.3 Komponenten-Tests

| Punkt                    | Stand     | Datei(en)                                                                                                                                                                                                |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alle Zustände            | teilweise | Leer-Zustände in 17 Testdateien, Lade-Zustände in 7 (Grep). Keine Vollständigkeitsprüfung je Komponente.                                                                                                 |
| Tastatur                 | ja        | `packages/ui/src/components/BottomCommandBar.test.tsx`, `components.test.tsx`, `apps/web/src/features/settings/SchemaForm.test.tsx`, `apps/web/src/features/tasks/tasks.test.tsx`; E2E in `a11y.spec.ts` |
| Loading, Error, Empty    | teilweise | siehe "Alle Zustände"                                                                                                                                                                                    |
| Capability-gesteuerte UI | ja        | `apps/web/src/features/shared/availability.test.tsx`, Feature-Tests mit Capability-Fällen                                                                                                                |

### §51.4 Visual Regression

| Punkt                 | Stand     | Datei(en) und Umfang                                                                                                                                                  |
| --------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alle Orb-Zustände     | teilweise | `visual.spec.ts`: 2D alle 14 Modi, `low quality`, `reduced motion`. 3D nur `booting`, `error`, `success` (entry/mid/stable/exit) und `speaking` mit 5 Audio-Fixtures. |
| Alle Kernseiten       | ja        | 17 Seiten bei 1920x1080 (`core pages 1920x1080`, Liste `PAGES`)                                                                                                       |
| 1080p                 | ja        | wie oben                                                                                                                                                              |
| 1440p                 | teilweise | nur Übersicht, Aufgaben, Freigaben                                                                                                                                    |
| 4K                    | teilweise | nur Übersicht (3840x2160)                                                                                                                                             |
| Tablet                | teilweise | Übersicht, Aufgaben, Freigaben, Einstellungen (1024x768); Übersicht und Aufgaben zusätzlich mit langem Deutsch                                                        |
| Reduced Motion        | teilweise | Übersicht und Aufgaben                                                                                                                                                |
| Langer deutscher Text | ja        | 5 Seiten 1080p, 2 Seiten Tablet, Überlaufprüfung als Zahlen auf 6 Routen                                                                                              |

### §51.5 End-to-End

| Punkt                 | Datei                                                                     |
| --------------------- | ------------------------------------------------------------------------- |
| Navigation            | `tests/e2e/navigation.spec.ts` (16 Menüeinträge, Direktaufruf, 404)       |
| Mock-Szenario-Wechsel | `tests/e2e/support/api.ts`, `fallback-2d.spec.ts`                                             |
| Task-Flow             | `tests/e2e/tasks.spec.ts`                                                 |
| Freigabe-Flow         | `tests/e2e/approvals.spec.ts` (Stufen 2 und 3, Token)                     |
| Live-Aktivität (§29)  | `tests/e2e/activity.spec.ts` (Stream, Filter, Baum, Pause, Detail, Raw-JSON nach Rolle) |
| Agenten (§31)         | `tests/e2e/agents.spec.ts` (Tabs, Pause/Fortsetzen, Stoppen, Zuweisen, Capability-Gating) |
| Gedächtnis (§30)      | `tests/e2e/memory.spec.ts` (Suche, Filter, Bearbeiten mit If-Match, Sperren, Vergessen mit Audit, Konflikte, Export) |
| Meldungen und Alarme (§39) | `tests/e2e/alerts.spec.ts` (P0 ohne Blinken, Bestätigen, Zurückstellen, Lösen, Eskalationskette, Verlauf, Badge) |
| Adapter-Ausfall       | `tests/e2e/outage.spec.ts`; zusätzlich `tests/integration/hybrid.spec.ts` |
| Orb-Zustandswechsel   | `tests/e2e/orb-states.spec.ts`                                            |
| Befehlsleiste         | `tests/e2e/command-bar.spec.ts`                                           |
| Einstellungen         | `tests/e2e/settings.spec.ts`                                              |
| Theme-Wechsel         | `tests/e2e/settings.spec.ts` ("theme switch")                             |
| Reconnect             | `tests/e2e/reconnect.spec.ts`                                             |
| 2D-Fallback           | `tests/e2e/fallback-2d.spec.ts`                                           |

### §51.6 Performance

| Punkt                           | Stand            | Datei und Hinweis                                                                                                                                                                          |
| ------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 30 Minuten Orb ohne Memory Leak | teilweise        | `tests/e2e/performance.spec.ts` ("orb soak"). Standard 2 min, 30 min nur mit `E2E_SOAK=1`, nicht in CI. Grenze: JS-Heap-Zuwachs nach Aufwärmphase unter 60 MB (30 min) bzw. 20 MB (2 min). |
| 10 000 Activity-Events          | ja               | `performance.spec.ts` (Profil `highLoad`, Feed virtualisiert)                                                                                                                              |
| 1 000 Tasks                     | ja               | `performance.spec.ts` (Zähler statt aller Karten)                                                                                                                                          |
| WebSocket-Reconnect             | ja               | `performance.spec.ts` ("reconnects under load"), `reconnect.spec.ts`                                                                                                                       |
| Hintergrund-Tab                 | ja               | `performance.spec.ts` ("orb render loop", Draw-Calls)                                                                                                                                      |
| GPU-Quality-Scaling             | ja (synthetisch) | `performance.spec.ts` ("GPU quality scaling"), Frame-Zeit über den Hook `frameMs`                                                                                                          |

Die Budgets sind bewusst weit gefasst, weil SwiftShader keine GPU-Frameraten liefert. Gemessene Werte werden als Annotation ausgegeben.

### §51.7 Accessibility

| Punkt                     | Stand         | Datei und Hinweis                                                                               |
| ------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| Tastatur                  | ja            | `tests/e2e/a11y.spec.ts` ("keyboard"): Tab-Reihenfolge, Befehlsleiste, Aufgabe nur mit Tastatur |
| Fokus                     | ja            | `a11y.spec.ts`: Fokusfalle im Dialog, Escape gibt Fokus zurück, sichtbarer Fokus                |
| Labels                    | ja (über axe) | `a11y.spec.ts`, axe-Regeln `wcag2a`/`wcag2aa`. Keine eigene Label-Assertion.                    |
| Kontrast                  | ja (über axe) | axe-Regel `color-contrast` (WCAG AA) auf allen Seiten und Overlays                              |
| Reduced Motion            | ja            | `a11y.spec.ts` ("reduced motion and non-colour cues"), Visual-Test `reduced motion`             |
| Screenreader              | teilweise     | `a11y.spec.ts` prüft, dass der Orb-Zustand als Text vorliegt. Kein Lauf mit einem Screenreader. |
| Keine Color-only-Zustände | ja            | `a11y.spec.ts` ("status is never colour-only")                                                  |

`KNOWN_ISSUES` in `a11y.spec.ts` ist leer. Ein Eintrag braucht Regel, Fläche und Begründung.

### §52 Orb-Testbarkeit

| Punkt                                                              | Stand     | Datei und Hinweis                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 52.1 Test-Clock (`fixedTime`, `animationProgress`, `audioFixture`) | ja        | `apps/web/src/features/orb/orbTestHook.ts` (+ `orbTestHook.test.ts`), `visual.spec.ts`                                                                                                                                                                                                                           |
| 52.2 Screenshots entry, mid, stable, exit                          | teilweise | nur für `booting`, `error`, `success` in 3D. Andere Zustände nur statisch in 2D.                                                                                                                                                                                                                                 |
| 52.3 Audio-Fixtures silence, normal, loud, tts, spike              | ja        | `packages/orb/src/audio/fixtures.test.ts`, `visual.spec.ts` ("speaking with every audio fixture")                                                                                                                                                                                                                |
| 52.4 Performance-Overlay (nur Entwicklung)                         | teilweise | `packages/orb/src/debug/OrbPerfOverlay.tsx` zeigt FPS, Frame-Zeit (avg, p95), Draw-Calls, Geometrien, Texturen, VRAM-Schätzung und Qualitätsstufe. Eingebunden nur über Prop `showPerf` in Orb-Stories und Demo, nicht in der Web-App. Kein Test rendert das Overlay selbst; Tests lesen `window.__ORB_DEBUG__`. |

Zusätzlich: `packages/orb/src/scene/adaptiveQuality.test.ts` und `qualityProfiles.test.ts` decken die Qualitätsstufen ab.

## 9. Bekannte Grenzen

- **Installer nur statisch.** Die Skripte brauchen Windows 11, PowerShell 5.1, robocopy, WSL2, `nvidia-smi` und `py.exe`. Die Cloud und die CI können das nicht ausführen. Der PowerShell-Parser-Lauf der Review lief unter PowerShell 7 auf Linux (siehe `docs/INSTALLER_INTEGRATION_REVIEW.md`), nicht unter 5.1.
- **Kein echtes Hermes, Voice oder Qwen in CI oder Integration.** Die Integration nutzt Fakes nach `docs/MAPPING/`. Geprüft wird die Verdrahtung und das Fehlerverhalten, nicht die Treue zu echten Antworten. Windows- und WSL-Portweiterleitung sind nicht abgedeckt.
- **Wake-Word nur synthetisch.** `eval_synthetic_wake.py` misst mit Piper-Stimmen, nicht mit Echtaufnahmen. Die pytest-Tests prüfen Logik, keine Erkennungsqualität.
- **3D-Baselines sind linux-/SwiftShader-spezifisch.** Auf Windows fehlen sie (Abschnitt 6).
- **Performance-Werte** sind Software-Rendering-Werte. Der 30-min-Soak läuft nicht in CI.
- **Storybook-Audit ist kein Gate** und läuft in keiner CI-Stufe.
- **Visual-Abdeckung ist nicht vollständig** (Größen und Zustände, Abschnitt 8, §51.4).
- **Keine Screenreader-Tests.** Die a11y-Suite prüft Text und axe-Regeln, nicht die Sprachausgabe.
- **Integration nicht in CI.** Wer Änderungen an Adaptern oder der Hybrid-Verdrahtung macht, führt `pnpm test:integration` lokal aus.

## 10. Belegstand

| Angabe                                              | Beleg                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 110 Unit-Dateien, 2469 Tests, 60 übersprungen       | gemessen: `pnpm test`, 2026-10-15                                                                                         |
| 10 Conformance-Adapter, 422 Tests, 60 übersprungen  | gemessen: `pnpm test:conformance`, 2026-10-15                                                                             |
| 4 Contract-Schritte, 122 Operationen                | gemessen: `pnpm contracts:check` grün; 122 `operationId` in `packages/contracts/openapi`                                  |
| 204 E2E-Tests in 20 Dateien, 7 Integrationstests    | gemessen per `--list`                                                                                                     |
| E2E-Laufzeit 42,7 min                               | gemessen: vollständiger Lauf, 2026-10-15                                                                                            |
| Integrationslaufzeit 3,3 bis 3,5 min                | `docs/evidence/integration/README.md`, Lauf 2026-10-14                                                                    |
| 12 Installer-Voice-Tests in `test_personal_wake.py` | gemessen: pytest in venv, 2026-10-15, vor Hinzufügen von `test_audio_level.py` (9 Tests, nicht gemessen)                  |
| 254 Stories                                         | übernommen. Grep über die 29 Story-Dateien ergibt 251 `export const`. Exakte Zahl braucht den Storybook-Index nach Build. |
| 71 Visual-Baselines                                 | gezählt im Verzeichnis (Auftrag nannte 60)                                                                                |
| Einzel-Spec `tasks.spec.ts`                         | Stack startet, die ersten sechs a11y-Tests waren grün. Lauf wurde nach Abbruch beendet, nicht vollständig gelaufen.       |
