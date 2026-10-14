# F.R.I.D.A.Y. Command Center

F.R.I.D.A.Y. übernimmt dort, wo J.A.R.V.I.S. aufgehört hat – die nächste Generation, von Grund auf neu gebaut:
contract-first, adapterbasiert und transparent in allem, was sie tut. Dieses Repository enthält das **Command Center**: ein Dashboard mit
Next.js-Frontend, NestJS/Fastify Control API, austauschbaren Adaptern, vollständigem Mock-Betrieb und einem goldenen,
prozedural gerenderten Orb als AI-Core.

## Dokumentation

- **Aktueller Stand und nächste Schritte:** [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)
- **Übergabe an einen Kollegen** (Lieferumfang, neue Anbindung in 10 Schritten, echte Dienste, Fehlersuche): [`docs/HANDOFF.md`](docs/HANDOFF.md)
- **Architektur** (Frontend, Control API, Adapter und Integration): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Deployment auf Windows 11** (Pfade, Betriebsmodi, Ports, Geheimnisse, Logs): [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- **Tests** (Unit, Conformance, Integration, E2E, Visual, Accessibility): [`docs/TESTING.md`](docs/TESTING.md)
- Adapter: [`docs/ADAPTER_SDK.md`](docs/ADAPTER_SDK.md), Konformität [`docs/ADAPTER_CONFORMANCE.md`](docs/ADAPTER_CONFORMANCE.md), Feldzuordnungen [`docs/MAPPING/`](docs/MAPPING/README.md)
- Spezifikation: [`docs/PLAN.md`](docs/PLAN.md)
- Verbindliche technische Entscheidungen: [`docs/IMPLEMENTATION_CONVENTIONS.md`](docs/IMPLEMENTATION_CONVENTIONS.md)
- Verträge und Codegenerierung: [`docs/CONTRACT_FIRST.md`](docs/CONTRACT_FIRST.md)

## Namen und Bezeichner

- Der sichtbare Produktname ist **F.R.I.D.A.Y.** (im Fließtext „Friday“). Der Assistentenname ist konfigurierbar
  (`settings.profile.assistantName`, Standard „F.R.I.D.A.Y.“).
- Das Standard-Aktivierungswort ist „Hey Friday“. Der Installer fragt den Namen vor den Stimmaufnahmen ab; später lässt er sich
  mit `installer/change-assistant-name.bat` ändern.
- Technische Bezeichner aus der Vorgängergeneration bleiben bewusst unverändert, weil sie Teil des Vertrags und des
  Build-Setups sind: Paketnamen `@jarvis/*`, Event-Typen `jarvis.*`, API-Pfad `/api/v1`, Umgebungsvariablen `JARVIS_*`,
  CSS-Variablen `--jarvis-*`, Komponenten wie `JarvisOrb` sowie Pfade wie `installer/install-jarvis.bat` und `C:\Jarvis`.
  Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), Abschnitt „Namen und Bezeichner“.

## Paketinhalt

| Ordner                            | Inhalt                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `installer/`                      | Windows-Komplettinstaller (WSL2, Hermes Agent, Kimi, lokales Qwen, Sprachsteuerung mit Stimmprofil). Start: `installer/install-jarvis.bat` per Doppelklick, Anleitung: [`installer/ANLEITUNG.md`](installer/ANLEITUNG.md) |
| `apps/`, `packages/`, `adapters/` | F.R.I.D.A.Y. Command Center (Dashboard, Control API, Adapter) – pnpm-Monorepo                                                                                                                                             |
| `skills/`                         | Platz für separate Skills (siehe [`skills/README.md`](skills/README.md))                                                                                                                                                  |
| `docs/`                           | Plan, Konventionen, Architektur, Übergabe, Deployment, Tests, Status                                                                                                                                                      |

## Voraussetzungen (Dashboard)

Node.js >= 22.13 (entwickelt mit Node 24) und pnpm 10.

```bash
pnpm install
```

## Wichtige Befehle

Alle Befehle stammen aus der Root-`package.json`. Die Befehle für Anbindung und Betrieb mit echten Diensten sind in
[`docs/HANDOFF.md`](docs/HANDOFF.md) beschrieben.

| Befehl                              | Zweck                                                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Control API (Port 3100) und Web (Port 3000) im Entwicklungsmodus                                     |
| `pnpm dev:api` / `pnpm dev:web`     | nur Control API (`tsx watch`, Mock-Modus) bzw. nur Web (`next dev`)                                  |
| `pnpm build`                        | alle Pakete bauen                                                                                    |
| `pnpm build:app`                    | Web (statischer Export nach `apps/web/out`) und Control API (`apps/control-api/dist/main.js`) bauen  |
| `pnpm start`                        | Control API aus `dist/main.js` starten, Datenmodus laut `config/dashboard.yaml`                      |
| `pnpm start:hybrid`                 | wie `pnpm start`, erzwingt `JARVIS_DATA_MODE=hybrid` (echte Adapter, Rest Mock)                      |
| `pnpm fake:upstreams`               | fiktive Hermes-, Voice- und llama-Dienste auf den Installer-Ports 43691–43694, Steuerport 43699      |
| `pnpm contracts:check`              | Lint, Schema-/Beispielvalidierung, SDK aktuell, Breaking-Change-Prüfung                              |
| `pnpm contracts:generate`           | SDK aus den Verträgen neu erzeugen                                                                   |
| `pnpm typecheck`                    | TypeScript in allen Paketen                                                                          |
| `pnpm lint`                         | ESLint                                                                                               |
| `pnpm format:check` / `pnpm format` | Prettier prüfen bzw. formatieren                                                                     |
| `pnpm test`                         | Vitest (Unit und Komponenten) über alle Pakete                                                       |
| `pnpm test:conformance`             | Adapter-Konformitätstests (`adapters/*/test/conformance.test.ts`)                                    |
| `pnpm test:integration`             | Playwright gegen die Control API im Hybrid-Modus mit Fake-Upstreams; braucht vorher `pnpm build:app` |
| `pnpm test:e2e`                     | Playwright-E2E-Tests (`playwright.config.ts`, startet den Stack selbst)                              |
| `pnpm storybook`                    | Komponenten- und Orb-Katalog auf Port 6006                                                           |
| `pnpm scenario -- <befehl>`         | Mock-Szenario-CLI, z. B. `pnpm scenario -- list` (Hilfe: `pnpm scenario -- --help`)                  |

## Aufbau

```text
installer/  Windows-Installer (PowerShell/Batch, WSL-Skripte, Voice-Service)
apps/       web, control-api, mock-console, storybook
packages/   contracts (Quelle der Wahrheit), generated-sdk, design-tokens, ui, orb,
            adapter-core, adapter-testkit, config, auth, observability, mock-data
adapters/   mock, example-http, hermes, voice-http, system-local, Platzhalter (*-placeholder)
config/     Beispielkonfigurationen (dashboard/adapters, mock, hybrid, live), Themes, Layouts
tests/      e2e (Playwright), integration (Hybrid-Stack mit Fake-Upstreams)
docs/       Plan, Konventionen, Architektur, Übergabe, Deployment, Tests, Status
skills/     separate Skills (später)
```

Jede Änderung an einem Datenmodell beginnt in `packages/contracts`; Typen, Client und Validatoren werden daraus erzeugt
und nie von Hand gepflegt.
