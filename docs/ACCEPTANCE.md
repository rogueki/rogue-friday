# Abnahme F.R.I.D.A.Y. Command Center

Stand: **2026-10-15** · Commit **`17129af`** (HEAD, Arbeitsbaum sauber) · Geltungsbereich: Cloud-Umgebung (Linux, Chromium, Node 22),
sofern nicht anders angegeben.

Grundlage: `docs/PLAN.md` §57 (Definition of Done, 29 Punkte), §55 (Implementierungsphasen 0–14 mit Gates) und §27.16 (Abnahme
Overview). Jeder Nachweis wurde am Repository geprüft: Dateien und Testnamen per `grep`, Gate-Ergebnisse aus dem Auftrag.

**Statusdefinition**

| Status | Bedeutung |
|---|---|
| ERFÜLLT | Der Punkt ist durch benannte Tests, Commands oder Artefakte belegt. Einschränkungen stehen in der Spalte „Lücke / Einschränkung“. |
| TEILWEISE | Ein Teil ist belegt, ein anderer Teil fehlt oder ist nur gegen Fakes bzw. auf Mock-Ebene geprüft. |
| OFFEN | Nicht umgesetzt oder nicht prüfbar. |

Alle „ERFÜLLT“-Aussagen beziehen sich auf die Cloud-Umgebung. Was nur dort und nicht auf Windows 11 geprüft ist, steht in
Abschnitt 6.

---

## 1. Ergebnis

| Prüfbereich | Punkte | ERFÜLLT | TEILWEISE | OFFEN |
|---|---:|---:|---:|---:|
| §57 Definition of Done | 29 | 26 | 3 | 0 |
| §27.16 Abnahme Overview | 11 | 8 | 3 | 0 |
| §55 Phasen-Gates (Phase 0–14) | 15 | 10 | 5 | 0 |

**Gesamturteil.** Vertrag (OpenAPI/AsyncAPI, SDK), Control API mit 122 Operationen, Mock-Plattform, Adapter-SDK mit zehn
Konformitätssuiten, Web-Oberfläche mit 16 Menüseiten und die Playwright-Suite (137 Tests) sind in der Cloud durchgehend belegt.

Die Abnahme ist **nicht vollständig**. Offen sind vor allem:

1. **Kein Windows-Lauf.** Installer, Dashboard-Schritt 15, Visual-Baselines (nur `-linux`) und die 3D-Darstellung mit echter GPU sind
   nicht auf dem Zielgerät geprüft (Abschnitt 6).
2. **Echte Dienste fehlen.** Hermes, Stimme und Qwen sind nur gegen Fakes geprüft. Ein echter Kimi-Lauf fand nicht statt.
3. **Audio-Reaktivität im Produktbetrieb ist nicht belegt.** Die Orb-Tests arbeiten mit synthetischen Fixtures; kein Adapter liefert
   Pegelwerte, und es gibt keinen Mikrofonzugriff im Code.
4. **Smartphone-Breite ist ungeprüft.** Tests laufen bis 1024 px (Tablet); §27.15 „Mobile“ und §53 fehlen in der Prüfung.
5. **Dokumentation und Status sind teilweise veraltet.** `docs/TESTING.md` fehlt, `docs/PROJECT_STATUS.md` steht noch auf 2026-10-14.
6. **Langlauf fehlt.** Der 30-Minuten-Orb-Soak (§51.6) ist nicht gelaufen; Standard sind 2 Minuten.

---

## 2. Gate-Ergebnisse

Die Ergebnisse stammen aus dem Auftrag für diese Abnahme (Stand 2026-10-15). Die Gates wurden für dieses Dokument nicht erneut
ausgeführt.

| Command | Ergebnis (2026-10-15) | Hinweis |
|---|---|---|
| `pnpm contracts:check` | grün | 122 Operationen, Contract `1.0.0`. Prüft Lint, Validierung, Generator-Aktualität und Breaking-Change-Erkennung (`packages/contracts/scripts/check.mjs`). |
| `pnpm typecheck` | grün | |
| `pnpm lint` | grün | |
| `pnpm test` | 107 Dateien, 2409 passed, 60 skipped | Vitest, Workspace-weit. |
| `pnpm test:conformance` | 10 Adapter, 422 passed | `adapters/*/test/conformance.test.ts`. |
| `pnpm build` | grün | |
| `pnpm test:e2e` | 137 passed, 36,8 min, kein `test.fail`, `KNOWN_ISSUES` leer | Playwright, Chromium, seriell (`workers: 1`). |
| `pnpm test:integration` | 7/7, zweimal hintereinander | Echte Adapter gegen Fake-Upstreams, gebaute Control API (Hybrid-Modus). Belege: `docs/evidence/integration/`. |
| Storybook-Build | grün, 254 Stories | Gezählt im lokal erzeugten `apps/storybook/storybook-static/index.json` (Ausgabe ist gitignored). |

---

## 3. §57 Definition of Done

| # | Punkt | Status | Nachweis | Lücke / Einschränkung |
|---|---|---|---|---|
| 1 | Dashboard vollständig in Mock Mode läuft | ERFÜLLT | `pnpm test:e2e` 137 passed (Commit `17129af`). `tests/e2e/navigation.spec.ts` „every route also loads directly (static export + SPA fallback)“. `apps/control-api/test/contract.test.ts` „contract: all operations“. Standard `dataMode: mock` in `config/dashboard.example.yaml`. | Nur Chromium auf Linux. Smartphone-Breite nicht geprüft (siehe §27.16 e). |
| 2 | Alle 17 Kernbereiche vorhanden | ERFÜLLT | 16 Menüseiten als Routen in `apps/web/src/app/(dashboard)/`: `/` (Übersicht), `activity`, `tasks`, `approvals`, `agents`, `memory`, `alerts`, `communication`, `calendar`, `automations`, `research`, `files`, `voice`, `system`, `audit`, `settings`. Dazu die globale Command Bar als 17. Bereich. `tests/e2e/navigation.spec.ts` „all 16 menu entries are reachable by click and mark the current page“. | `dev/scenarios` und `login` sind keine Menüpunkte. |
| 3 | Global Command Bar funktioniert | ERFÜLLT | `tests/e2e/command-bar.spec.ts` (6 Tests, z. B. „a write command shows the server preview, cancelling executes nothing, confirming creates the approval“, „a forbidden command is rejected with a clear message and changes nothing“). `tests/e2e/a11y.spec.ts` „the whole task flow works with the keyboard only“. Textfeld in Commit `1903958`. | Befehle sind Control-API-Intents. Eine Sprachsteuerung über einen realen Voice-Adapter ist nicht belegt. |
| 4 | Orb unterstützt alle Zustände | ERFÜLLT | 14 Modi in `packages/orb` (`src/machine/orbMachine.test.ts`). `tests/e2e/orb-states.spec.ts` „all 14 forced orb modes are mirrored in data-orb-mode, the accessible name and the live region“. Baselines `tests/e2e/__screenshots__/visual.spec.ts/orb-*-linux.png` (14 Modi, 2D). 14 Modus-Stories in Storybook (`Orb/JarvisOrb`). | 3D-Baselines nur für booting, error, success, speaking (SwiftShader, Linux). |
| 5 | Orb audio-reaktiv getestet | TEILWEISE | Synthetische Fixtures in `packages/orb/src/audio/fixtures.ts` (silence, normal, loud, tts, spike), Tests `fixtures.test.ts` und `audioSource.test.ts`. Baselines `orb3d-speaking-audio-{silence,normal,loud,tts,spike}-linux.png` (`visual.spec.ts` „speaking with every audio fixture“). `packages/orb/src/JarvisOrb.test.tsx` „polls getAudioLevel from the 2D animation loop“. | **Kein echtes Mikrofon und kein echter Lautsprecher geprüft.** Im Repo gibt es keinen `getUserMedia`- oder `AnalyserNode`-Code. Pegel kommen nur über `jarvis.voice.audio_level`-Events. Der reale Adapter `adapters/voice-http` liefert solche Events nicht (kein Treffer in `adapters/voice-http/src`); nur die Mock-Welt (`packages/mock-data/src/world/services/voice.ts`) erzeugt sie. Audio-Reaktivität im Produktbetrieb ist daher nicht belegt. |
| 6 | Orb unterstützt Reduced Motion | ERFÜLLT | `tests/e2e/visual.spec.ts` „reduced motion (OS preference, orb animations off)“ mit Baseline `orb-thinking-reduced-motion-linux.png`. `tests/e2e/fallback-2d.spec.ts` „scenario 'reduced-motion' switches the running app to reduced motion without a reload“. `packages/orb/src/visual/deriveVisualTargets.test.ts` „reduced motion removes large rotations, radial motion and parallax“. | Keine eigene 3D-Baseline unter Reduced Motion. |
| 7 | 2D-Fallback funktioniert | ERFÜLLT | `tests/e2e/fallback-2d.spec.ts` (5 Tests: Renderer `2D`, Szenario `webgl-failure`, Szenario-Hinweise in `GET /meta`, Reduced Motion, Browser ohne WebGL). `packages/orb/src/JarvisOrb.test.tsx` „falls back to 2d when animations are off and when WebGL is unavailable“. | Nur Chromium mit SwiftShader. Ein echter Browser ohne WebGL wurde nicht geprüft. |
| 8 | Capability Discovery funktioniert | ERFÜLLT | `GET /api/v1/capabilities` (`packages/contracts/openapi/jarvis-api.yaml`, `operationId: getCapabilities`). `apps/control-api/test/degradation.test.ts` „reports the outage in health, adapters, capabilities, status and overview“. `contract.test.ts` „serves meta, health and capabilities without a session“. | – |
| 9 | Module zeigen partielle Fähigkeiten korrekt | ERFÜLLT | `apps/control-api/test/degradation.test.ts` „answers CAPABILITY_MISSING for an operation whose capability is switched off, reads stay available“ und „restores the operation when the capability returns“. `apps/web/src/features/shared/availability.test.tsx`. `tests/e2e/outage.spec.ts` „partial outage: mail is offline and marked as such, tasks/calendar/agents keep working“. | E2E deckt nur den Mail-Fall ab. Schreib-/Lese-Unterschiede sind auf Mock-Ebene geprüft. |
| 10 | Jeder Adapter ist austauschbar | ERFÜLLT | Zehn Konformitätssuiten: `adapters/{mock, example-http, hermes, hermes-placeholder, voice-http, voice-placeholder, system-local, system-placeholder, mail-placeholder, calendar-placeholder}/test/conformance.test.ts`. Austausch je Kategorie über `dataMode: hybrid`; Mock-Fallbacks in `apps/control-api/test/real-adapters.test.ts`. Integrationslauf 7/7 (zweimal). | Praktisch ausgetauscht wurden nur drei Kategorien (Hermes: Aufgaben, Aktivität, Agenten; Sprache; System), und das nur gegen Fakes. Mail und Kalender sind nur Platzhalter. |
| 11 | Kein Provider im Frontend hardcodiert | ERFÜLLT | Kein `fetch(` in Komponenten (`grep -rnP "(?<![\w.])fetch\(" apps/web/src` ohne Tests und Mocks: 0 Treffer). Alle Daten über `@jarvis/sdk` (`apps/web/src/lib/api`). Keine Adressen oder Ports im Produktivcode der Web-App. | Zwei namensabhängige Icon-Zuordnungen: `apps/web/src/features/overview/WidgetPanels.tsx:400` (Regex auf Dienstnamen) und `apps/web/src/features/system/SystemPage.tsx:267` (Icon-Map nach Enum `Service.kind`, Wert `hermes`). Keine Funktionsstörung, aber Provider-Namen im Frontend. |
| 12 | OpenAPI und AsyncAPI sind Source of Truth | ERFÜLLT | `packages/contracts/openapi/jarvis-api.yaml` (Version `1.0.0`, 122 Operationen), `packages/contracts/asyncapi/jarvis-events.yaml`, JSON-Schemas in `packages/contracts/schemas/`, Baseline in `packages/contracts/baseline/`. `pnpm contracts:check` grün. | – |
| 13 | SDK wird automatisch generiert | ERFÜLLT | Generator `packages/contracts/scripts/generate.mjs`. `check-generated.mjs` läuft in `contracts:check` und bricht bei veraltetem Code ab. SDK `packages/generated-sdk` (`@jarvis/sdk`), Tests `packages/generated-sdk/test/sdk.test.ts`. | – |
| 14 | Mock-Daten erfüllen die Contracts | ERFÜLLT | `adapters/mock/test/conformance.test.ts` (Mock-Adapter gegen die Port-Verträge). `apps/control-api/test/contract.test.ts` prüft jede Operation gegen die laufende API (Status, Body, Schema). `packages/mock-data/test/world.test.ts`. | – |
| 15 | Scenario Console vorhanden | ERFÜLLT | Route `apps/web/src/app/(dashboard)/dev/scenarios/page.tsx`. `tests/e2e/scenarios.spec.ts` (3 Tests). `apps/web/src/features/dev-scenarios/ScenarioConsole.test.tsx`. Alle 14 Szenario-IDs aus §45 in `packages/mock-data`. CLI `apps/mock-console`. | Die Konsole ist nur aktiv, wenn `features.devScenarios` in `GET /meta` gesetzt ist (`apps/control-api/src/handlers/meta.ts`). |
| 16 | Storybook enthält alle Hauptzustände | ERFÜLLT | 254 Stories (lokaler Build, `index.json`): 21 Orb-Stories (alle 19 Zustände aus §46.1 plus Speaking mit Agenten und Performance-Overlay), 15 Domänen-Bereiche mit je 10 Zuständen (150 Stories: leer, Loading, Error, Offline, Stale, normale, lange, große Datenmenge, read-only, fehlende capability), 73 Components, 6 Design System, 4 Overview. Screenshots in `apps/storybook/screenshots/`. | Die Domänen-Stories prüfen Komponenten-Zustände, keine Seiten-Abnahme. |
| 17 | E2E-Tests sind erfolgreich | ERFÜLLT | `pnpm test:e2e`: 137 passed, 36,8 min, kein `test.fail`. 13 Spec-Dateien in `tests/e2e/`: `a11y`, `approvals`, `command-bar`, `fallback-2d`, `navigation`, `orb-states`, `outage`, `performance`, `reconnect`, `scenarios`, `settings`, `tasks`, `visual`. Letzter Fix in Commit `17129af`. | Chromium, Linux. Die Suite läuft seriell. |
| 18 | Visual Regression ist bestanden | ERFÜLLT (Linux) | 71 PNG-Baselines in `tests/e2e/__screenshots__/visual.spec.ts/` mit Suffix `-linux`: Übersicht, Kernseiten, 1080p/1440p/4K, Tablet 1024×768, Reduced Motion, Long German Text, Zustände, Orb 2D und 3D. Maskiert werden nur Live-Werte (`MASK_LIVE` in `visual.spec.ts`). | Baselines gelten nur für Linux und SwiftShader; auf Windows fehlen sie. In der Overview-Baseline erscheint der maskierte Systemmonitor als magenta Fläche; dieser Bereich wird nicht geprüft. |
| 19 | Accessibility-Test ist bestanden | ERFÜLLT | `tests/e2e/a11y.spec.ts`: axe (WCAG 2.0/2.1 A und AA) auf allen Seiten, Overlays und Settings-Bereichen; Tastatur (Tab-Reihenfolge, Fokusfalle, Escape); Reduced Motion; „keine color-only states“; Orb-Zustand als Text. `KNOWN_ISSUES` ist leer. | Automatisierte axe-Prüfung. Kein Test mit einem Screenreader (NVDA, JAWS, Narrator). |
| 20 | Adapter-Ausfälle werden abgefangen | ERFÜLLT | `tests/e2e/outage.spec.ts` (3 Tests). `apps/control-api/test/degradation.test.ts` (5 Tests, u. a. „answers 503 ADAPTER_UNAVAILABLE for the offline module only; everything else keeps working“). `tests/integration/hybrid.spec.ts`: „stopping the voice service marks exactly the voice module offline“ und „stopping Hermes marks tasks, activity and agents offline while voice and system keep working“. Belege: `docs/evidence/integration/` (17 Bilder). | Ausfälle sind geschlossene Ports bei Fakes. Hänger, Fehlformen und 401-Rotation prüfen nur die Adapter-Tests. |
| 21 | WebSocket-Reconnect funktioniert | ERFÜLLT | `tests/e2e/reconnect.spec.ts` (3 Tests: Backoff und `?since=`, Live-Feed nach Reconnect, `resync_required`). `apps/web/src/lib/realtime/client.test.ts` „reconnects after a drop with backoff inside the bounds and resumes from the last sequence“. `tests/e2e/performance.spec.ts` „the event stream reconnects under load and the burst of the scenario is not lost“. | Netzverhalten unter Windows/WSL nicht geprüft. |
| 22 | Event-Gap wird erkannt | ERFÜLLT | `apps/web/src/lib/realtime/client.test.ts` „detects gaps, reports them and still applies the event“. `apps/web/src/lib/realtime/applyEvent.test.ts` „merges a backfill after a gap“. `tests/e2e/reconnect.spec.ts` lädt nach dem Reconnect per `?since=` nach. | – |
| 23 | Audit ist vorhanden | ERFÜLLT | `apps/control-api/test/audit.test.ts`: Hash-Kette („is gapless, starts at the genesis hash and links every event to its predecessor“), Manipulationserkennung (`describe("tamper detection")`), Kopf außerhalb der Tabelle („persists the chain head“). Seite `apps/web/src/app/(dashboard)/audit/`, Baseline `audit-1080p-linux.png`. | Kette und Kopf liegen in derselben SQLite-Datenbank. Eine externe Verankerung gibt es nicht. Wer die ganze Datenbank neu schreibt, kann die Kette ersetzen. |
| 24 | Secrets erscheinen nicht im Frontend | ERFÜLLT | `apps/control-api/test/secrets.test.ts` (10 Tests, u. a. „does not leak any secret, password, password hash or server key through any read endpoint“, „keeps secrets out of the audit trail“, „does not persist secret values in the settings database“). Einzige Browser-Speicherung der Web-App: die Ereignis-Sequenz in `apps/web/src/lib/realtime/client.ts`. Geheimnisse per `file:`-Referenz (`docs/ARCHITECTURE.md`, Abschnitt Geheimnisse). | Der Windows Credential Manager (`wincred:`, PLAN §49.6) ist nur für Windows vorgesehen und dort ungeprüft. |
| 25 | Theme und Orb sind ohne Rebuild konfigurierbar | ERFÜLLT | `tests/e2e/settings.spec.ts`: „theme switch: picking a theme applies live without a reload, saving persists it“, „changing the orb quality applies to the running orb and persists“, „theme intensity sliders change the live css tokens“, „renaming the assistant changes brand, orb label, title and bottom bar live and persists“. | Theme-Editor nur über Slider und Auswahl getestet, nicht als vollständige Bearbeitung. |
| 26 | Layout ist exportier- und importierbar | ERFÜLLT | `apps/web/src/features/settings/LayoutArea.test.tsx` „exports the layout as JSON“, „imports a valid layout as draft and rejects an invalid file with reasons“. API `importLayout`, `exportSettings`, `importSettings` (`jarvis-api.yaml`). `apps/control-api/test/contract.test.ts` „lists, imports and exports themes, layouts and the full settings“. | Kein E2E-Test für den Layout-Editor. |
| 27 | Dokumentation ist vollständig | TEILWEISE | Vorhanden: `README.md`, `docs/ARCHITECTURE.md`, `docs/ADAPTER_SDK.md`, `docs/ADAPTER_CONFORMANCE.md`, `docs/CONTRACT_FIRST.md`, `docs/DEPLOYMENT.md`, `docs/HANDOFF.md`, `docs/SECURITY.md`, `docs/MOCK_SCENARIOS.md`, `docs/ORB_SPECIFICATION.md`, `docs/DESIGN_SYSTEM.md`, `docs/MAPPING/` (8 Dateien), `docs/INSTALLER_INTEGRATION_REVIEW.md`. | **Fehlt:** `docs/TESTING.md`, obwohl `docs/HANDOFF.md` darauf verlinkt und PROJECT_STATUS es als Punkt 5 fordert. `docs/PROJECT_STATUS.md` ist seit 2026-10-14 nicht aktualisiert; der Abschnitt „Remaining work“ führt Punkte als offen, die committet sind. `docs/SECURITY.md` §9 ist nicht abgehakt. `docs/evidence/integration/README.md` spricht von einer „ungecommitteten“ Testanpassung, der Arbeitsbaum ist aber sauber. |
| 28 | Beispieladapter besteht Conformance | ERFÜLLT | `adapters/example-http/test/conformance.test.ts`. `pnpm test:conformance`: 10 Adapter, 422 passed. | Der Beispieladapter ist HTTP-basiert. Nicht-HTTP-Adapter werden nur statisch geprüft und über Welt-Schalter getestet (PROJECT_STATUS, Abschnitt Adapter-Core). |
| 29 | Produktive Adapter lassen sich ohne UI-Umbau ergänzen | TEILWEISE | Hermes (`adapters/hermes`: Aufgaben, Aktivität, Agenten), `adapters/voice-http` und `adapters/system-local` sind über `config/*.hybrid.example.yaml` verdrahtet (Commits `5fde094`, `6aba15f`, `ffa7daa`). `apps/control-api/test/real-adapters.test.ts` (8 Tests). Der Integrationslauf benutzt denselben Web-Build ohne Code-Änderung. | Nur gegen Fakes. Kein echtes Hermes, keine echte Stimme, kein echtes Qwen (`docs/evidence/integration/README.md`, Abschnitt Grenzen). Hermes-Endpunkte sind teils unbelegte Annahmen (`docs/MAPPING/hermes.md`). Hermes-Aktionen wie Abbrechen oder Pausieren haben keine Schnittstelle und sind mit `capability=false` gesperrt. Mail und Kalender sind nur Platzhalter-Adapter. |

---

## 4. §27.16 Abnahme Overview

| # | Kriterium | Status | Nachweis | Lücke / Einschränkung |
|---|---|---|---|---|
| a | Design ist auf den ersten Blick derselben visuellen Familie wie die Referenz | ERFÜLLT | Sichtprüfung von `tests/e2e/__screenshots__/visual.spec.ts/overview-1080p-linux.png` gegen `design-references/jarvis_dashboard_reference.webp`: gleiche Navy/Cyan-HUD-Sprache, Topbar, Navigation, Panelrahmen und Command Bar. | Sichtprüfung durch diese Abnahme und das Lead-Review (PROJECT_STATUS). Kein formaler Owner-Vermerk. |
| b | Orb entspricht der goldenen holografischen Referenzform | TEILWEISE | 3D-Baselines `orb3d-*-linux.png`; Referenz `design-references/jarvis_orb_reference.webp`. | Die goldene prozedurale Kugel mit Ringen ist erkennbar. Die Referenz ist fotorealistisch-holografisch mit mehr Tiefe und Transparenz. Die Baselines stammen aus SwiftShader. Lead-Abnahme nach zwei Review-Runden, Owner-Abnahme offen. |
| c | Kein blauer Standardglobus bleibt übrig | ERFÜLLT | Alle Orb-Baselines (2D und 3D) zeigen Gold und Amber. Storybook `Orb/JarvisOrb`. | – |
| d | Keine statischen Screenshot-Hintergründe | ERFÜLLT | `apps/web/public/` enthält nur `icon.svg`. In `apps/web/src` gibt es keine Bilddateien (`find` nach png, webp, jpg ohne Treffer). Hintergründe sind CSS. | – |
| e | Alle Panels sind echte responsive Komponenten | TEILWEISE | Breakpoints in `apps/web/src/app/responsive.css` (1279, 1099 und 699 px sowie Laptop-Höhe 960 px). Baselines für Tablet 1024×768 (`*-tablet-linux.png`), 1080p, 1440p und 4K. | Kein Test bei Smartphone-Breite (≤ 699 px). §27.15 „Mobile“ und §53 sind nicht geprüft. Das kleinste geprüfte Layout ist Tablet. |
| f | Alle Menüpunkte dieses Plans sind erreichbar | ERFÜLLT | `tests/e2e/navigation.spec.ts` „all 16 menu entries are reachable by click and mark the current page“. | – |
| g | Orb reagiert auf sämtliche Mock-Zustände | ERFÜLLT | `tests/e2e/orb-states.spec.ts`: alle 14 Modi; Szenario `voice-pipeline` durchläuft listening, transcribing, thinking, speaking, idle; „clicking the orb opens the context that belongs to its state (waiting_approval -> approval)“. | Die Zustände werden über Szenarien und erzwungene Modi geprüft, nicht jede Szenario-Kombination mit einer Orb-Baseline. |
| h | Startseite bleibt bei ausgefallenem Adapter nutzbar | ERFÜLLT | `tests/e2e/outage.spec.ts` „partial outage: mail is offline and marked as such, tasks/calendar/agents keep working“. Baseline `overview-partial-outage-linux.png`. Integrationslauf: Übersicht bleibt bei Ausfall von Voice und Hermes live (Belege 06, 09, 12–15). | Im Integrationslauf zeigt die Kachel „System“ bei ausgefallener Sprache „Offline“ (Befund in `docs/evidence/integration/README.md`, Abschnitt Beobachtungen). |
| i | Layout ist konfigurierbar | ERFÜLLT | `apps/web/src/features/settings/LayoutArea.test.tsx` (7 Tests: Verschieben und Größe per Tastatur, ausblenden und einblenden, exportieren, importieren, zurücksetzen, Viewer nur lesend). `tests/e2e/settings.spec.ts`. | Kein E2E-Test für den Layout-Editor. |
| j | Gold und Cyan sind klar getrennt eingesetzt | TEILWEISE | PLAN §24.2 verlangt Gold nur im Orb-Kontext. In `overview-1080p-linux.png` erscheint Gold zusätzlich bei den WARN-Badges der Live-Intelligenz, beim Freigabe-Hinweis und bei der Kachel „Modelle“. | Die Trennung gilt nicht durchgehend. Das ist eine Designfrage für Owner und Lead, sie wird von keinem Test geprüft. |
| k | Command Bar bleibt immer erreichbar | ERFÜLLT | `tests/e2e/command-bar.spec.ts`. Tab-Reihenfolge in `tests/e2e/a11y.spec.ts` (Sprungmarke, 16 Menüeinträge, Command Bar, Primäraktion). Die Bottom-Bar ist auf allen Baselines sichtbar. | Smartphone-Breite nicht geprüft (siehe e). |

---

## 5. §55 Phasen-Gates

| Phase | Inhalt (PLAN §55) | Gate (PLAN §55) | Status | Nachweis | Lücke / Einschränkung |
|---|---|---|---|---|---|
| 0 | Monorepo, TypeScript strict, Lint, Format, Test Runner, CI, Grunddokumentation | Clean Build | ERFÜLLT | `pnpm build` grün. CI-Workflow `.github/workflows/ci.yml` mit Schritten für contracts:check, typecheck, lint, format:check, test, test:conformance, build und einem E2E-Job. | Der letzte Lauf der Remote-CI auf GitHub ist nicht geprüft. |
| 1 | Common Schemas, OpenAPI, AsyncAPI, Beispiele, Generator, SDK, Contract CI | Alle Verträge validieren | ERFÜLLT | `pnpm contracts:check` grün (Lint, Validierung, Generator-Aktualität, Breaking-Change). Beispiele in `packages/contracts/examples/`. | – |
| 2 | Base Adapter, Manifest, Registry, Ports, Health, Capabilities, Error Mapping, Conformance Testkit | Example Adapter besteht Conformance | ERFÜLLT | `adapters/example-http/test/conformance.test.ts`. `pnpm test:conformance`: 422 passed. | – |
| 3 | Mock-Adapter, MSW, Event Simulator, Scenario Console, Seed Data, Mock Clock | Alle Contracts über Mock bedienbar | ERFÜLLT | `apps/control-api/test/contract.test.ts` (jede Operation). `adapters/mock/test/conformance.test.ts`. MSW-Modus `pnpm --filter @jarvis/web dev:mock`. | – |
| 4 | Tokens, Theme, Layout, Core Components, Navigation, Loading/Error/Empty | Storybook vollständig | ERFÜLLT | 254 Stories, Build grün. Alle 19 Orb-Zustände aus §46.1 vorhanden. Domänen-Stories mit allen Zuständen aus §46.2. | Die Komponenten nicht einzeln gegen §24.16 abgeglichen. |
| 5 | Renderer, Shader, Ring Layers, Particles, State Machine, 2D Fallback, Reduced Motion, Storybook States, Performance Overlay | Alle Orb-Zustände einzeln bestanden | ERFÜLLT | Tests in `packages/orb` (Zustandsmaschine, Visual Targets, Audio, Qualitätsprofile, Fallback). 14 Modus-Stories plus Performance-Overlay-Story. Orb-Baselines (2D und 3D). | Der Audio-Pfad ist nur synthetisch geprüft (siehe §57 Punkt 5). |
| 6 | Startseite, Orb-Integration, Attention, Quick Actions, Active Tasks, System Health, Activity Strip | Alle Overview-Szenarien | ERFÜLLT | `tests/e2e/visual.spec.ts` (Gruppe „states“): Overview in den Szenarien; Baselines `overview-approval-waiting`, `overview-critical-alert`, `overview-empty-new-installation`, `overview-partial-outage`, `overview-long-german-*`, `overview-reduced-motion`. `tests/e2e/a11y.spec.ts` „overview with the critical-alert scenario“. | – |
| 7 | Tasks, Activity, Approvals, Agents, Memory, Notifications | Vollständige Mock-Flows | TEILWEISE | E2E-Flows: Tasks (`tasks.spec.ts`, 2 Tests), Approvals (`approvals.spec.ts`, 6 Tests). Activity, Agents, Memory und Alerts sind über Baselines, axe, Komponententests und Storybook geprüft. | Kein E2E-Flow für Live-Aktivität (Filter, Baum), Agenten, Gedächtnis und Meldungen/Eskalation. |
| 8 | Mail & Communication, Calendar, Automations | Read/write capability korrekt | ERFÜLLT | `apps/control-api/test/contract.test.ts` („communication and calendar“, „automations and research“). `apps/control-api/test/degradation.test.ts` (CAPABILITY_MISSING). `tests/e2e/outage.spec.ts` „adapter-recovery scenario walks the calendar through its degraded/offline phases and back to online“. `apps/web/src/features/communication/communication.test.tsx`. | Nur auf Mock-Ebene. Es gibt keine echten Mail- und Kalender-Adapter. |
| 9 | Research, Files & Documents, Voice, System, Audit | Sämtliche Menüs vollständig | ERFÜLLT | Routen vorhanden. Baselines `research-1080p`, `files-1080p`, `voice-1080p`, `system-1080p`, `audit-1080p`. `tests/e2e/a11y.spec.ts` „axe: every page“. | E2E-Flows nur als Stichprobe. Voice-Testmodus und Enrollment nur auf Komponenten- und API-Ebene. |
| 10 | Theme Editor, Orb Settings, Layout Editor, Adapter Settings, Model Routing UI, Export/Import | Änderungen ohne Rebuild | ERFÜLLT | `tests/e2e/settings.spec.ts` (6 Tests, u. a. Versionierung mit 409 bei veraltetem Stand). Layout-Import und -Export (`LayoutArea.test.tsx`). Model Routing UI in `apps/web/src/features/settings/BasicAreas.tsx`. | Model Routing UI nur auf Komponenten-Ebene geprüft. |
| 11 | Reconnect, Gap Detection, Replay, Backfill, Offline Cache, Stale UI, Event Load | Ausfall-/Recovery-Tests | TEILWEISE | Reconnect, Gap, Backfill und Replay: `tests/e2e/reconnect.spec.ts`, `apps/web/src/lib/realtime/client.test.ts`, `applyEvent.test.ts`. Adapter-Ausfall: `tests/e2e/outage.spec.ts` und Integrationslauf 7/7. Event Load: `tests/e2e/performance.spec.ts`. | **Offline Cache fehlt als persistenter Datencache.** Vorhanden sind nur der In-Memory-Query-Cache und die Ereignis-Sequenz im localStorage. |
| 12 | Auth, Rollen, CSRF, CSP, Secrets, Approval Enforcement, Audit | Security Checklist | TEILWEISE | Belegt durch Tests: `apps/control-api/test/security.test.ts` (CSRF, Rollen, Idle- und absolute Sitzungsdauer, Rate Limit, Logout-All), `approvals.test.ts` (Token einmalig, 120 s), `secrets.test.ts`, `audit.test.ts` (Manipulation), `static.test.ts` (CSP, Host-Header), `tests/e2e/approvals.spec.ts` (Tier 3 mit erneuter Anmeldung). | Die Checkliste in `docs/SECURITY.md` §9 ist nicht abgehakt. Nicht belegt sind u. a. die Dateirechte von `auth.key`, die Durchsicht von `pnpm audit`, die Logs auf Token und Mailadressen, der Remote-Zugriff und der Windows-Secret-Store. Der Dev-Login akzeptiert im Mock-Modus jedes Passwort (`tests/e2e/README.md`). Dass er bei `hybrid` oder `live` nicht startet, ist nicht als Test belegt. |
| 13 | Unit, Contract, Visual, E2E, Accessibility, Performance, Browser, Long Run | Definition of Done | TEILWEISE | Unit (`pnpm test`), Contract (`contracts:check`), Visual, E2E, A11y und Performance (`tests/e2e/performance.spec.ts`: 10 000 Aktivitäten, 1 000 Tasks, Hintergrund-Tab, GPU-Skalierung) sind ausgeführt. | Long Run: der 30-Minuten-Orb-Soak (§51.6) ist nicht gelaufen (`E2E_SOAK=1`, Standard 2 Minuten). Browser: nur Chromium. Windows-Läufe fehlen. |
| 14 | Adapter SDK, Beispieladapter, Integrationsanleitung, Mapping-Tabellen, Config Templates, Troubleshooting, Übergabe | Kein Gate definiert | TEILWEISE | `docs/ADAPTER_SDK.md`, `adapters/example-http`, `docs/HANDOFF.md` (PLAN §56), `docs/MAPPING/` (8 Dateien), `config/*.example.yaml` (Varianten `example`, `hybrid`, `live`), `docs/DEPLOYMENT.md` §10 (Fehlersuche). | `docs/TESTING.md` fehlt. Die Übergabe an den Kollegen ist nicht erfolgt. Im PLAN ist für diese Phase kein Gate definiert. |

---

## 6. Nur auf Windows prüfbar

Die Checkliste für den Test auf einem frischen Windows-11-PC steht in `docs/INSTALLER_INTEGRATION_REVIEW.md`, Abschnitt 5:

- 5.1 Schritte im Ablauf (Schritte 0 bis 15, Zusatz Watchdog, Abschluss)
- 5.2 Aufgaben, Ports und Logs (`JARVIS_*`, Ports 3100 und 43691–43694)
- 5.3 Funktionale Endtests (Wake Word, Command Center, Ausfalltests, Neustart, Update)

Zusätzlich aus dieser Abnahme, nur auf Windows prüfbar:

| Punkt | Warum nur dort | Betroffene Stelle |
|---|---|---|
| `pnpm install --frozen-lockfile` und `pnpm build:app` mit nativen Binaries | Linux-Lauf nicht übertragbar (Befund D-06) | §57 Punkt 1, Phase 0 |
| Visual-Baselines für Windows erzeugen und prüfen (`pnpm test:e2e:update` dort) | Baselines heißen `-linux` | §57 Punkt 18 |
| 3D-Orb mit echter GPU (WebGL, Qualitätsregler, Frame-Zeiten) und 30-Minuten-Soak | Cloud nutzt SwiftShader | §57 Punkt 4, §55 Phase 13 |
| Erreichbarkeit der Ports 43691–43694 und 3100 aus Windows bei WSL-`networkingMode=mirrored` | Nur in der VM und mit Fakes geprüft | §57 Punkt 20, §27.16 h |
| Secret-Store `wincred:` | Nur für Windows implementiert | §57 Punkt 24 |
| Autostart der Aufgaben `JARVIS_Dashboard` und `JARVIS_Watchdog` nach Anmeldung | Windows-Aufgabenplanung | §57 Punkt 20 |
| Echter Hermes-Lauf mit Kimi K3, echte Stimme, Wake Word „Hey Friday“ | Keine echten Dienste in der Cloud (Befunde H-03, W-02 bis W-06) | §57 Punkt 10, §57 Punkt 29 |
| Screenreader-Test (z. B. NVDA) im Browser | Automatisierte axe-Prüfung ersetzt das nicht | §57 Punkt 19 |
| Browser-Matrix (Edge, Firefox) | Playwright läuft nur mit Chromium | §55 Phase 13 |

---

## 7. Offen / Owner-Entscheidungen

Aus `docs/PROJECT_STATUS.md` (Abschnitt „Open owner decisions“):

1. **Wake Word:** entschieden am 2026-10-14. Standard „Hey Friday“, Name bei der Installation wählbar. Erledigt, nur zur Vollständigkeit aufgeführt.
2. **Umbenennen interner Bezeichner** (`@jarvis/*`, Events `jarvis.*`, Umgebungsvariablen `JARVIS_*`). Das ist ein Vertragsbruch.
3. **Autorname in der Git-Historie:** Der alte Name steht in drei Commits. Entfernen erfordert ein Umschreiben der Historie und einen Force-Push auf `main`.
4. **Pfade, Dateinamen und Aufgabennamen** (`C:\Jarvis`, `install-jarvis.bat`, `JARVIS_*`): bleiben vorerst. Eine Umbenennung bricht bestehende Installationen.

Aus `docs/INSTALLER_INTEGRATION_REVIEW.md`, Abschnitt 6:

5. Internes Umbenennen `@jarvis/*` (Paketnamen, `jarvis.*`-Events, `/api/v1`). Vertragsbruch. Entspricht Punkt 2.
6. Autor-Umschreiben der Git-Historie (Force-Push). Irreversibel für Remotes und Klone. Entspricht Punkt 3.
7. Umbenennen von Pfaden, Dateinamen und Aufgabennamen unter `C:\Jarvis`. Entspricht Punkt 4.
8. Filterung der Friday-Stimme (`tts_film_filter`, Standard `true`, Befund VS in `installer/voice/voice_setup.py`) und eine weibliche TTS-Stimme. Die Standardstimme ist Thorsten (männlich, `installer/voice/LIESMICH.txt`).
9. Hermes-Version festlegen (Commit oder Tag, Prüfsumme im Installer). Betrifft H-06 und I-22.
10. Wake-Word-Verfahren, falls die Qualität mit echter Stimme nicht reicht (z. B. ein eigenes openWakeWord-Modell für den Namen).

Zusätzliche Befunde dieser Abnahme, die eine Entscheidung brauchen (keine Owner-Entscheidung im engeren Sinn):

- Gold-und-Cyan-Trennung (§27.16 j) und die Orb-Referenzform (§27.16 b): Owner-Sichtung der 3D-Baselines.
- Quelle der Audio-Pegel im Produktbetrieb (§57 Punkt 5): welcher Adapter liefert `jarvis.voice.audio_level`?
- Umfang des Offline-Caches (§55 Phase 11).
- Abarbeitung der Security-Checkliste (`docs/SECURITY.md` §9) und Entscheidung über den Dev-Login-Schutz bei `hybrid`/`live`.
- Mobile-Breite: Prüfung aufnehmen oder als nicht vorgesehen dokumentieren (§27.15, §53).

---

## 8. Nicht verifiziert in dieser Abnahme

- Die Gate-Ergebnisse in Abschnitt 2 stammen aus dem Auftrag. Sie wurden nicht erneut ausgeführt.
- Der Status der Remote-CI auf GitHub wurde nicht geprüft.
- Der Storybook-Build liegt lokal vor und ist gitignored. Die Story-Zahl stammt aus `index.json` dieses Builds.
- Die 3D-Baselines wurden nicht neu erzeugt. Die Zahl der Baselines (71) stammt aus dem Dateisystem.
- Die Ähnlichkeit mit den Referenzbildern (§27.16 a, b, j) ist eine Sichtprüfung einzelner Screenshots, kein Pixelvergleich. Die Referenzbilder sind anders gerendert.
- Nicht geprüft: Screenreader, reale Mikrofone, echte Dienste (Hermes, Stimme, Qwen, Kimi), Smartphone-Breite, Windows-Installation, 30-Minuten-Soak.
- Die Konformitäts- und E2E-Ergebnisse gelten nur für Linux und Chromium.
- Das Evidence-README (`docs/evidence/integration/README.md`) und die Status-Doku sind in Teilen veraltet (siehe §57 Punkt 27). Diese Abnahme hat sie nicht korrigiert, weil der Schreibbereich nur dieses Dokument umfasst.

---

## 9. Commit-Zuordnung

| Bereich | Commits |
|---|---|
| Grundlage, Monorepo, Contracts (Ausgangsstand) | `a1f9e79` (Initial commit), `65172b8` (Hauptimplementierung: contract-first, adapter-basiert), `f03f24e` (Cloud-Vorbereitung) |
| Branding F.R.I.D.A.Y. | `717f898`, `8733b2e`, `1ed02eb` |
| Contracts (Erweiterungen, 122 Operationen) | `8733b2e`, `7f8b5f8`, `394dfa7` |
| Control API | `6f484cb` (vollständig, Tests), `6963206` (Plattformlücken) |
| Adapter | `ffa7daa` (Hermes), `6aba15f` (voice-http, system-local), `5fde094` (reale Adapter verdrahtet), `84460a7` (Retry-Stapelung behoben) |
| Web-Oberfläche | `1903958` (A.2), `609e82a` (Modulseiten), `cfd68b7` (Ausfall- und A11y-Feinschliff), `e0971c8` (Storybook-Domänen) |
| Playwright-Suite | `e4d1a61` (Suite), `17129af` (Lücken geschlossen, 137 grün) |
| Integration | `25a7d56` (7/7 zweimal), `8d5efb3` (Nachweis-Doku) |
| Installer | `c3ede6d` (statische Prüfung), `1ca7cdb` (Assistentenname), `89b3b6c` (Schritt 15 Command Center), `82384e1` (Fixes I-31 bis I-38), `7a89c9a` (Watchdog) |
| Dokumentation | `692d811` (HANDOFF, PLAN §56), `14d120d` (Namen und Bezeichner), `63e2c4c` |
