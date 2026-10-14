# rogue-friday — Projektanweisungen für Claude Code

Produkt: **F.R.I.D.A.Y.** — Nachfolger von J.A.R.V.I.S. Dieses Repo ist ihr Command Center (Dashboard + Control API).
Operator: RogueKI. Kommunikation: **Deutsch**, direkt, technisch, präzise. Code-Bezeichner/Kommentare: Englisch.

## Pflicht zu Beginn jeder Session

1. `docs/PROJECT_STATUS.md` lesen — verifizierter Stand, offene Arbeit in Reihenfolge, bekannte Lücken.
2. `docs/IMPLEMENTATION_CONVENTIONS.md` lesen — verbindliche technische Entscheidungen.
3. `docs/PLAN.md` ist die verbindliche Spezifikation (Deutsch). **Nichts aus dem Plan auslassen.**
4. Bei Design-/Orb-Arbeit zusätzlich `docs/briefs/*.md` und die Referenzbilder in `design-references/` ansehen.

## Arbeitsweise

- Die Haupt-Session **orchestriert und prüft**; Implementierung durch günstigere Subagents
  (`.claude/agents/implementer.md` = Sonnet, `.claude/agents/doc-writer.md` = Haiku). Schreibbereiche der
  parallelen Agents strikt trennen; jede Übergabe mit Ziel, Scope, Eingaben, Akzeptanzkriterien.
- Ergebnisse **selbst verifizieren** (Typecheck, Tests, Build, Screenshots) bevor committet wird. Visuelle Arbeit erst
  nach Screenshot-Vergleich mit den Referenzbildern abnehmen.
- Nicht nachfragen, wenn eine reversible, vernünftige Standardentscheidung möglich ist: entscheiden, dokumentieren,
  weiterarbeiten. Rückfragen nur bei irreversiblen oder wesentlich unterschiedlichen Ergebnissen.
- Nach jeder abgeschlossenen Arbeitseinheit `docs/PROJECT_STATUS.md` aktualisieren (ersetzt hier die lokale
  `MEMORY.md`): neuer Stand, Entscheidungen, offene Punkte, zuletzt verifizierter Zustand.
- Kleine, atomare Commits; Arbeit auf Feature-Branches, Merge nach `main` erst bei grünen Gates.

## Harte Regeln

- Contract-First: jede Modelländerung beginnt in `packages/contracts`; danach `pnpm contracts:generate`.
  Keine handgeschriebenen DTOs — Typen aus `@jarvis/sdk`.
- Frontend spricht nur mit der Control API über das generierte SDK; kein `fetch()` in Komponenten.
- Keine Secrets, keine echten Personendaten (Namen, E-Mails, Telefonnummern) in Code, Mock-Daten, Beispielen oder
  Screenshots. Mock-Personen sind fiktiv (z. B. „Erik Brandt“).
- Orb: prozedural (R3F), Gold/Amber-Identität, keine Videos/GIFs/Bilder als Orb; keine React-State-Updates pro Frame.
- Interne Paket-/Event-Namen (`@jarvis/*`, `jarvis.*`, `/api/v1`) bleiben stabil (Contract); die **sichtbare Marke**
  ist F.R.I.D.A.Y. (siehe Aufgabe „Branding“ in `docs/PROJECT_STATUS.md`).

## Gates (müssen grün sein)

```bash
pnpm contracts:check && pnpm typecheck && pnpm lint && pnpm test && pnpm test:conformance && pnpm build
pnpm test:e2e   # sobald die Playwright-Suite existiert
```

## Umgebung

- Node ≥ 22.13 (Cloud: `/opt/node22` ist Standard), pnpm 10 (`packageManager` im Root-`package.json`).
- Abhängigkeiten installiert der SessionStart-Hook `scripts/cloud-setup.sh` automatisch in Cloud-Sessions.
- Playwright braucht Chromium (`pnpm exec playwright install chromium`); headless WebGL mit
  `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`. Falls der Browser-Download im
  Cloud-Netzwerk blockiert ist: Host `cdn.playwright.dev` / `playwright.download.prss.microsoft.com` in der
  Cloud-Umgebung freigeben oder das vorinstallierte Chrome per `channel: "chrome"` nutzen.
- Zielplattform des Endnutzers ist Windows (`D:\Jarvis\dashboard`); Pfade/Skripte plattformneutral halten.
