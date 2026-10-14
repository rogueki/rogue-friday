# JARVIS Command Center

Adapterbasiertes, Contract-First Dashboard für Jarvis: Next.js-Frontend, NestJS/Fastify Control API, austauschbare
Adapter, vollständiger Mock-Betrieb.

- Spezifikation: [`docs/PLAN.md`](docs/PLAN.md)
- Verbindliche technische Entscheidungen: [`docs/IMPLEMENTATION_CONVENTIONS.md`](docs/IMPLEMENTATION_CONVENTIONS.md)
- Verträge und Codegenerierung: [`docs/CONTRACT_FIRST.md`](docs/CONTRACT_FIRST.md)

## Voraussetzungen

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
apps/       web, control-api, mock-console, storybook
packages/   contracts (Quelle der Wahrheit), generated-sdk, design-tokens, ui, orb, adapter-core, ...
adapters/   mock, example-http, Platzhalter für Hermes/Voice/Mail/Kalender/System
config/     Beispielkonfigurationen, Themes, Layouts
docs/       Plan, Konventionen, Architektur- und Betriebsdokumentation
```

Jede Änderung an einem Datenmodell beginnt in `packages/contracts`; Typen, Client und Validatoren werden daraus erzeugt
und nie von Hand gepflegt.
