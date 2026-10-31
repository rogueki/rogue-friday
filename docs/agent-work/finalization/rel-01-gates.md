# REL-01 Release-Gates (Stand 2026-10-31)

## REL-01.01 Integrationsstand

- Integrationscommit: `988ed638` (main nach #158), Arbeitsbaum sauber, keine offenen PRs.
- main-CI-Lauf 41151402956 auf diesem Commit: gruen (Vertraege, Typecheck, Lint, Unit-Tests, Konformitaet, Build,
  12 E2E-Shards, Installer unter Windows PowerShell 5.1, Python-Voice- und Integrationshelfer).
- Vertraege und SDK werden in derselben CI-Stufe geprueft (`pnpm contracts:check`); generierte Dateien sind eingecheckt.
- Ausschluesse (Pruefung `git ls-files` und `git grep` auf diesem Commit):
  - keine `MEMORY.md`, `SCOPE.md`, `AGENTS.md`, keine `.env` ausser `.env.example`, keine Referenzaufnahmen im Repo;
    `CLAUDE.md` ist bewusst Projektdatei und wird nicht ausgeliefert (`$DashRootFiles` in `installer/install-friday.ps1`
    ist eine Positivliste ohne `CLAUDE.md`).
  - Treffer des Geheimnismusters sind ausschliesslich Testattrappen (`contract-gaps.test.ts`, `test_speech_redaction.py`),
    ein Hermes-Hilfetext im Inventar und `apps/control-api/test/fixtures/research-test.key`: selbstsigniertes
    Test-Schluesselpaar fuer einen TLS-Server auf 127.0.0.1 in `research-service.test.ts`, kein Produktgeheimnis.

## REL-01.02 Kommandos aus dem Checkout

| Kommando | Ort | Ergebnis |
|---|---|---|
| `pnpm contracts:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:conformance`, `pnpm build` | CI 41151402956 | PASS |
| `pnpm test:e2e` (12 Shards) | CI 41151402956 | PASS: 268 bestanden, 2 erst im zweiten Versuch (beide WebGL: `orb-flows.spec.ts:179`, `performance.spec.ts:111`), 1 uebersprungen |
| `pnpm build:app` + `pnpm test:integration` | lokal Windows 11, `988ed638` | PASS: 7 bestanden (3,3 min) |

Versionen: Node 24 (CI) bzw. 24.13.0 (lokal), pnpm 10.28.2 (`packageManager`), Lockfile `pnpm-lock.yaml` mit
`--frozen-lockfile` in der CI. Keine Snapshot-Aktualisierung zum Gruenmachen.

## REL-01.04 Regressionen aus dem Issue-Ledger

- `issue-ledger.csv`: 258 Zeilen. 130 Zeilen nennen konkrete Testdateien; jede genannte Datei existiert auf `988ed638`
  (`content-studio-restart/-production.test.ts` steht fuer die zwei Dateien `content-studio-restart.test.ts` und
  `content-studio-production.test.ts`). Alle diese Tests laufen in den CI-Stufen oben.
- Die uebrigen Zeilen belegen mit PR, Dokument oder Live-Nachweis oder sind `BLOCKED_EXTERNAL` (24), historisch bzw.
  ueberholt (11) oder `OPEN` (1: N-171, Owner-Entscheidung KEEP-06).
- N-093 (E2E-Wiederholungen): im Lauf 41151402956 nur noch 2 von 271 Tests mit Wiederholung, beide WebGL unter
  SwiftShader; vorher 9 von 10 Wiederholungen durch Kontext-Timeouts.

## Offen (Owner)

REL-02 bis REL-05 brauchen echte Konten, Geraete und eine saubere Neuinstallation; siehe `docs/PROJECT_STATUS.md`.
