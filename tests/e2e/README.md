# Playwright-Suite (`pnpm test:e2e`)

End-to-End-, Visual-Regression-, Accessibility- und Performance-Tests nach PLAN §51.4 bis §51.7 und §52 gegen das **gebaute**
Command Center: Control API (`apps/control-api/dist/main.js`) im Mock-Modus mit Dev-Login, die statische Web-App
(`apps/web/out`) liefert dieselbe Instanz aus (ein Port, gleicher Origin).

## Ausführen

```bash
pnpm build:app                 # nur nötig, wenn apps/web/out oder apps/control-api/dist fehlen/veraltet sind
pnpm test:e2e                  # komplette Suite (serieller Lauf, siehe Laufzeit in der Ausgabe)
pnpm test:e2e tests/e2e/tasks.spec.ts          # einzelne Spec
pnpm test:e2e:update           # Visual-Baselines neu erzeugen (nach jeder UI-Änderung!)
E2E_SOAK=1 pnpm test:e2e tests/e2e/performance.spec.ts -g soak   # 30-Minuten-Orb-Soak (Standard: 2 Minuten; E2E_SOAK=1 setzt in orb-voice.spec auch 200 statt 25 Mikrofon-Zyklen)
ORB_EVIDENCE=1 pnpm test:e2e tests/e2e/orb-evidence.spec.ts   # Orb-Screenshots + Auto-Demo-Video
```

- `playwright.config.ts` startet den Stack selbst (`webServer` -> `tests/e2e/stack.ts`). Fehlt der Build, läuft `pnpm build:app`
  automatisch; `FRIDAY_E2E_BUILD=1` erzwingt einen Neubau. Der Stack arbeitet auf einer **Kopie** von `apps/web/out`
  (Temp-Verzeichnis), ein paralleler Rebuild verändert den Lauf also nicht.
- Entwicklung einer Spec: Stack einmal von Hand starten (`pnpm exec tsx tests/e2e/stack.ts`) und die Specs mit
  `FRIDAY_E2E_REUSE=1 pnpm test:e2e <spec>` dagegen laufen lassen.
- Port `FRIDAY_E2E_PORT` (Standard 3200), Datenverzeichnis `FRIDAY_E2E_DIR` (Standard `<tmp>/friday-e2e`), Chromium
  `FRIDAY_CHROMIUM` (Standard in der Cloud: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`). Chromium startet mit
  `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` (WebGL in Software).

- Dev-Auth: Login akzeptiert jedes nicht leere Passwort, die erneute Authentifizierung (Stufe-3-Freigabe) verlangt das dokumentierte Dev-Passwort `dev`.

## Aufbau

| Datei                                                                                                                                     | Inhalt                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stack.ts`                                                                                                                                | Startet die gebaute Control API (Mock, Seed 42, Dev-Login, Temp-`FRIDAY_DATA_DIR`)                                                                             |
| `support/fixtures.ts`                                                                                                                     | Auto-Fixtures: vor **jedem** Test Welt-Reset (`dev/scenarios/control reset`) und Wiederherstellung der Einstellungen; Fehler bei unbehandelten Page-Exceptions |
| `support/api.ts`                                                                                                                          | Kleiner API-Client (Cookies, CSRF, Idempotency-Key) für Setup und Gegenprobe der UI-Aktionen am Server                                                         |
| `navigation`, `scenarios`, `tasks`, `approvals`, `outage`, `orb-states`, `command-bar`, `settings`, `reconnect`, `fallback-2d` `.spec.ts` | E2E (§51.5)                                                                                                                                                    |
| `activity`, `agents`, `memory`, `alerts` `.spec.ts` | Mock-Flows der Kernmodule (PLAN Phase 7, §29/§30/§31/§39): echte UI-Interaktion gegen den gebauten Stack, jede Aktion wird zusätzlich an der Control API gegengeprüft (siehe "Modul-Flows") |
| `visual.spec.ts`                                                                                                                          | Visual Regression (§51.4), Baselines in `__screenshots__/visual.spec.ts/` (pro Plattform)                                                                      |
| `a11y.spec.ts`                                                                                                                            | axe-core WCAG 2.0/2.1 A+AA, Tastatur, Fokus, Reduced Motion, Nicht-nur-Farbe (§51.7)                                                                           |
| `mobile.spec.ts` | Smartphone 390x844 (PLAN §27.15, §53): kein horizontales Scrollen, Command Bar vollständig und prominent, Navigation als Drawer, Attention vor Detailmodulen, Karten statt Tabellen; Baselines `mobile-*-linux.png` |
| `offline-cache.spec.ts` | Offline-Cache (Phase 11): Reload bei gesperrter API zeigt die letzten Daten mit Offline-Cache-Banner/-Badge, nichts Geheimes im Speicher, automatische Rückkehr |
| `security.spec.ts` | Security-Gate im Browser (docs/SECURITY.md §9): Cookie-Flags, CSP ohne Verstöße auf allen Seiten, kein ungehashtes Inline-Skript, kein Framing, Host-/Origin-Prüfung |
| `performance.spec.ts`                                                                                                                     | 10 000 Aktivitäten, 1 000 Tasks, Reconnect unter Last, Hintergrund-Tab, Orb-Soak (§51.6)                                                                       |
| `orb-layout`, `orb-idle`, `orb-voice`, `orb-flows`, `orb-debug-build` `.spec.ts` | Orb-Abnahme (Owner-Auftrag 22.1-22.9): Position/Größe bei 4 Auflösungen x 3 Zoomstufen, Idle-Bewegung, Mikrofon (Chromium-Fake-Device mit WAV-Fixtures) und TTS (Playwright-WebSocket als Sprachdienst) durch den echten Browser-Voice-Pfad, Events -> Controller (Transcribing/Thinking/Working/Approval/Error), Production-Build ohne Debug-Panel; Hilfen in `support/orb.ts` |
| `orb-evidence.spec.ts` | Nur mit `ORB_EVIDENCE=1`: Screenshots der Kernzustände und Video der Auto-Demo nach `test-results/orb-evidence/` |

## Modul-Flows (`activity`, `agents`, `memory`, `alerts`)

Jeder Test bedient die echte Oberfläche und prüft das Ergebnis danach am Server (`api.get(...)`), nicht nur im DOM.
Wiederkehrende Techniken:

- **Szenario auf simulierter Uhr treiben:** Szenarien laufen auf der Mock-Uhr. `api.play("syncing", 0.1)` streckt die Schritte
  um den Faktor 10, `api.control({ action: "clock_advance", ms })` löst sie dann gezielt aus (deterministisch, ohne `sleep`).
  Beispiel Eskalationskette: `critical-alert` mit Tempo 0,05 und `clock_advance 1_600_000` ergibt alle vier Kanäle mit festen
  Zeitstempeln (10:15, 10:20, 10:28, 10:41 Berlin), der Schritt "Alert bestätigt" liegt noch in der Zukunft.
- **Szenarien mit Baseline `quiet`** (`critical-alert`, `syncing`, `multi-agent-working`, ...) lösen vorhandene offene Meldungen und
  Freigaben auf; die Seeds der Tests müssen das berücksichtigen (siehe `alerts.spec.ts`).
- **Capability entfernen:** `api.control({ action: "capability_toggle", module, capability, enabled: false })` vor dem Öffnen der Seite;
  geprüft wird "deaktiviert mit Begründung" (nie stilles Verschwinden) und die Ablehnung durch die API.
- **Rolle wechseln:** `ApiClient.login("operator" | "viewer")` und `context.addCookies(client.cookieList())` vor `open()`; der Browser
  läuft dann mit dieser Sitzung (Gegenprobe über `/auth/session`).
- **Zwischenablage:** `context.grantPermissions(["clipboard-read", "clipboard-write"], { origin })`, gelesen mit `navigator.clipboard.readText()`.
- **Download:** `page.waitForEvent("download")`, Inhalt aus `download.path()`.
- Der Auto-Fixture-Reset stellt Welt und Einstellungen vor jedem Test wieder her; die Specs räumen nichts selbst auf.

## Determinismus der Visual-Tests

Seed 42 und simulierte Uhr 08:15 (Reset vor jedem Test), eingefrorenes `Date` im Browser (Uhr in der Kopfzeile und alle
relativen Zeiten sind konstant), CSS-Animationen deaktiviert, Orb mit Einstellung `animations: "off"`. Dieser Modus
ist ein Produktmodus: die 3D-Szene schaltet auf den statischen 2D-Renderer, dessen Ausgabe eine reine Funktion des Zustands
ist (zweimal byte-identisch geprüft).

**Orb in 3D (PLAN §52):** Die Web-App reicht den Orb-Testtakt durch, aber nur wenn `GET /meta` `features.devScenarios`
meldet (Produktion: aus, die Parameter werden dann ignoriert). Zugang: `window.__FRIDAY_ORB_TEST__ = { fixedTime,
animationProgress, audioFixture, frameMs }` plus `window.dispatchEvent(new Event("friday-orb-test"))`, oder URL-Parameter
`?orbTime=4&orbProgress=0.5&orbAudio=loud&orbFrameMs=40`. Mit `fixedTime` ist ein Frame eine reine Funktion aus
(Modus, Zeit, Fortschritt, Audio-Fixture): keine Wanduhr, keine Dämpfung, keine Parallaxe. Die Baselines `orb3d-*`
(booting/error/success: entry, mid, stable, exit; speaking mit allen fünf Audio-Fixtures) sind in drei getrennten
Läufen byte-identisch (SHA-256 der PNGs) erzeugt worden. Qualität ist auf `medium` gepinnt (`auto` hängt von der
Kernzahl des Hosts ab). Der Frame-Loop meldet den angewendeten Takt in `window.__ORB_DEBUG__.testClock`; die Tests warten darauf.
`frameMs` ersetzt die gemessene Frame-Zeit des Auto-Qualitätsreglers (GPU-Last-Simulation, §51.6). Eine 3D-Baseline
bleibt linux-/SwiftShader-spezifisch; ein 3D-Test dauert dort ca. 2 Minuten pro Zustand.
Maskiert wird nur der Latenz-Chip des Event-Streams (und "Aktualisiert hh:mm", Host-Metriken).

**Baselines müssen neu erzeugt werden, sobald sich die UI ändert** (`pnpm test:e2e:update`, danach Bilder ansehen und committen).

## Bekannte Lücken (von der Suite als erwarteter Fehlschlag oder Allowlist geführt)

Keine `test.fail` und kein Eintrag in `KNOWN_ISSUES` (`a11y.spec.ts`, Mechanismus bleibt für künftige Lücken).

- Seed-Zeiten liegen am 14.10.2026, die UI rechnet mit der echten Serverzeit: Tests pinnen `Date` und `/meta.serverTime` (`freezeDate`).
- Der Stack muss unberührt starten (Fixture prüft das); bei `FRIDAY_E2E_REUSE=1` den Stack zwischen Läufen neu starten.
