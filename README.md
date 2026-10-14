# F.R.I.D.A.Y. Command Center

F.R.I.D.A.Y. übernimmt dort, wo J.A.R.V.I.S. aufgehört hat – die nächste Generation, von Grund auf neu gebaut:
contract-first, adapterbasiert und transparent in allem, was sie tut. Dieses Repository enthält das **Command Center**: ein Dashboard mit
Next.js-Frontend, NestJS/Fastify Control API, austauschbaren Adaptern, vollständigem Mock-Betrieb und einem goldenen,
prozedural gerenderten Orb als AI-Core.

- **Aktueller Stand und nächste Schritte:** [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)
- Spezifikation: [`docs/PLAN.md`](docs/PLAN.md)
- Verbindliche technische Entscheidungen: [`docs/IMPLEMENTATION_CONVENTIONS.md`](docs/IMPLEMENTATION_CONVENTIONS.md)
- Verträge und Codegenerierung: [`docs/CONTRACT_FIRST.md`](docs/CONTRACT_FIRST.md)

## Namen und Bezeichner

- Der sichtbare Produktname ist **F.R.I.D.A.Y.** (im Fließtext „Friday“). Der Assistentenname ist konfigurierbar
  (`settings.profile.assistantName`, Standard „F.R.I.D.A.Y.“).
- Das Standard-Aktivierungswort ist „Hey Friday“. Bei der Installation lässt sich ein eigener Name festlegen, etwa
  Jarvis oder James. Die Umsetzung im Installer ist noch offen (siehe [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)).
- Technische Bezeichner aus der Vorgängergeneration bleiben bewusst unverändert, weil sie Teil des Vertrags und des
  Build-Setups sind: Paketnamen `@jarvis/*`, Event-Typen `jarvis.*`, API-Pfad `/api/v1`, Umgebungsvariablen `JARVIS_*`,
  CSS-Variablen `--jarvis-*`, Komponenten wie `JarvisOrb` sowie Pfade wie `installer/install-jarvis.bat` und `C:\Jarvis`.
  Details: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), Abschnitt „Namen und Bezeichner“.

## Paketinhalt

| Ordner | Inhalt |
| --- | --- |
| `installer/` | Windows-Komplettinstaller (WSL2, Hermes Agent, Kimi, lokales Qwen, Sprachsteuerung mit Stimmprofil). Start: `installer/install-jarvis.bat` per Doppelklick, Anleitung: [`installer/ANLEITUNG.md`](installer/ANLEITUNG.md) |
| `apps/`, `packages/`, `adapters/` | F.R.I.D.A.Y. Command Center (Dashboard, Control API, Adapter) – pnpm-Monorepo |
| `skills/` | Platz für separate Skills (siehe [`skills/README.md`](skills/README.md)) |
| `docs/` | Plan, Konventionen, Architektur, Status |

## Voraussetzungen (Dashboard)

Node.js >= 22.13 (entwickelt mit Node 24) und pnpm 10.

```bash
pnpm install
```

## Wichtige Befehle

| Befehl                    | Zweck                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                | Control API (Port 3100) und Web (Port 3000) im Entwicklungsmodus        |
| `pnpm contracts:check`    | Lint, Schema-/Beispielvalidierung, SDK aktuell, Breaking-Change-Prüfung |
| `pnpm contracts:generate` | SDK aus den Verträgen neu erzeugen                                      |
| `pnpm typecheck`          | TypeScript in allen Paketen                                             |
| `pnpm lint`               | ESLint                                                                  |
| `pnpm test`               | Vitest (Unit/Komponenten) über alle Pakete                              |
| `pnpm test:conformance`   | Adapter-Konformitätstests                                               |
| `pnpm test:e2e`           | Playwright                                                              |
| `pnpm storybook`          | Komponenten- und Orb-Katalog                                            |
| `pnpm scenario`           | Mock-Szenario-CLI                                                       |

## Aufbau

```text
installer/  Windows-Installer (PowerShell/Batch, WSL-Skripte, Voice-Service)
apps/       web, control-api, mock-console, storybook
packages/   contracts (Quelle der Wahrheit), generated-sdk, design-tokens, ui, orb, adapter-core, ...
adapters/   mock, example-http, Platzhalter für Hermes/Voice/Mail/Kalender/System
config/     Beispielkonfigurationen, Themes, Layouts
docs/       Plan, Konventionen, Architektur- und Betriebsdokumentation
skills/     separate Skills (später)
```

Jede Änderung an einem Datenmodell beginnt in `packages/contracts`; Typen, Client und Validatoren werden daraus erzeugt
und nie von Hand gepflegt.
