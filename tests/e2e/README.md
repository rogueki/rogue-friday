# Playwright-Suite (`pnpm test:e2e`)

End-to-End-, Visual-Regression-, Accessibility- und Performance-Tests nach PLAN §51.4 bis §51.7 und §52 gegen das **gebaute**
Command Center: Control API (`apps/control-api/dist/main.js`) im Mock-Modus mit Dev-Login, die statische Web-App
(`apps/web/out`) liefert dieselbe Instanz aus (ein Port, gleicher Origin).

## Ausführen

```bash
pnpm build:app                 # nur nötig, wenn apps/web/out oder apps/control-api/dist fehlen/veraltet sind
pnpm test:e2e                  # komplette Suite (serieller Lauf, ca. 27 Minuten, 122 Tests)
pnpm test:e2e -- tests/e2e/tasks.spec.ts          # einzelne Spec
pnpm test:e2e:update           # Visual-Baselines neu erzeugen (nach jeder UI-Änderung!)
E2E_SOAK=1 pnpm test:e2e -- tests/e2e/performance.spec.ts -g soak   # 30-Minuten-Orb-Soak (Standard: 2 Minuten)
```

- `playwright.config.ts` startet den Stack selbst (`webServer` -> `tests/e2e/stack.ts`). Fehlt der Build, läuft `pnpm build:app`
  automatisch; `JARVIS_E2E_BUILD=1` erzwingt einen Neubau. Der Stack arbeitet auf einer **Kopie** von `apps/web/out`
  (Temp-Verzeichnis), ein paralleler Rebuild verändert den Lauf also nicht.
- Entwicklung einer Spec: Stack einmal von Hand starten (`pnpm exec tsx tests/e2e/stack.ts`) und die Specs mit
  `JARVIS_E2E_REUSE=1 pnpm test:e2e -- <spec>` dagegen laufen lassen.
- Port `JARVIS_E2E_PORT` (Standard 3200), Datenverzeichnis `JARVIS_E2E_DIR` (Standard `<tmp>/jarvis-e2e`), Chromium
  `JARVIS_CHROMIUM` (Standard in der Cloud: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). Chromium startet mit
  `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` (WebGL in Software).

## Aufbau

| Datei | Inhalt |
|---|---|
| `stack.ts` | Startet die gebaute Control API (Mock, Seed 42, Dev-Login, Temp-`JARVIS_DATA_DIR`) |
| `support/fixtures.ts` | Auto-Fixtures: vor **jedem** Test Welt-Reset (`dev/scenarios/control reset`) und Wiederherstellung der Einstellungen; Fehler bei unbehandelten Page-Exceptions |
| `support/api.ts` | Kleiner API-Client (Cookies, CSRF, Idempotency-Key) für Setup und Gegenprobe der UI-Aktionen am Server |
| `navigation`, `scenarios`, `tasks`, `approvals`, `outage`, `orb-states`, `command-bar`, `settings`, `reconnect`, `fallback-2d` `.spec.ts` | E2E (§51.5) |
| `visual.spec.ts` | Visual Regression (§51.4), Baselines in `__screenshots__/visual.spec.ts/` (pro Plattform) |
| `a11y.spec.ts` | axe-core WCAG 2.0/2.1 A+AA, Tastatur, Fokus, Reduced Motion, Nicht-nur-Farbe (§51.7) |
| `performance.spec.ts` | 10 000 Aktivitäten, 1 000 Tasks, Reconnect unter Last, Hintergrund-Tab, Orb-Soak (§51.6) |

## Determinismus der Visual-Tests

Seed 42 und simulierte Uhr 08:15 (Reset vor jedem Test), eingefrorenes `Date` im Browser (Uhr in der Kopfzeile und alle
relativen Zeiten sind konstant), CSS-Animationen deaktiviert, Orb mit Einstellung `animations: "off"`. Dieser Modus
ist ein Produktmodus: die 3D-Szene schaltet auf den statischen 2D-Renderer, dessen Ausgabe eine reine Funktion des Zustands
ist (zweimal byte-identisch geprüft). Ein 3D-WebGL-Frame hängt von der Wanduhr ab; die Web-App reicht den Orb-Testtakt
(`fixedTime`/`animationProgress`, PLAN §52.1) nicht durch. Deshalb gibt es für 3D nur einen Smoke-Test (Canvas nicht leer, Gold-Anteil),
keine Pixel-Baseline. Maskiert wird nur der Latenz-Chip des Event-Streams.

**Baselines müssen neu erzeugt werden, sobald sich die UI ändert** (`pnpm test:e2e:update`, danach Bilder ansehen und committen).

## Bekannte Lücken (von der Suite als erwarteter Fehlschlag oder Allowlist geführt)

- `fallback-2d.spec.ts` Szenario `webgl-failure` (`test.fail`): `GET /meta` der Control API übernimmt die `uiHints` der Mock-Welt nicht.
- `a11y.spec.ts`: `prefers-reduced-motion` stoppt ~22 unendliche CSS-Animationen nicht (`test.fail`); Allowlist `KNOWN_ISSUES`
  (Kontrast blaues Tag in der Freigabe-Vorschau 4.12:1, icon-only Button ohne Namen bei 1024 px).
- Orb-Testtakt (`fixedTime`/`animationProgress`, PLAN §52.1) ist in der Web-App nicht erreichbar: keine entry/mid/stable/exit-Frames in 3D.
- Dev-Auth akzeptiert jedes nicht leere Passwort für Re-Auth; "falsches Passwort" ist nur mit Hash-Auth testbar (Control-API-Tests).
- Seed-Zeiten liegen am 14.10.2026, die UI rechnet mit der echten Serverzeit: Tests pinnen `Date` und `/meta.serverTime` (`freezeDate`).
- Der Stack muss unberührt starten (Fixture prüft das); bei `JARVIS_E2E_REUSE=1` den Stack zwischen Läufen neu starten.
