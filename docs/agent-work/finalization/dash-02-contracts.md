# DASH-02 — API, job, event and migration contracts

Stand: 2026-10-22. Basis: `contract-freeze.md` (BASE-03), laufender Stand `d03527e`/`15d90af`.

## 1. Umfang des Vertrags

- `packages/contracts/openapi/friday-api.yaml` beschreibt **271 Operationen** (151 schreibend, 120 lesend).
- Rollenverteilung: 163 `owner`, 62 `viewer`, 44 `operator`, 2 `none` (öffentlicher Login und der anonyme
  Meta-Read). Jede Operation trägt genau einen Wert.
- `x-capability` tragen 236 Operationen. Die 35 ohne Capability sind ausschließlich `owner`-Operationen (Voice,
  lokaler Kalender, Mail-Preview/Confirm, Research-Provider) sowie Auth-, Telemetrie- und Dev-Konsole-Routen —
  dort ist die Rolle die Prüfung.
- Die ausgelieferte Durchsetzung ist die generierte Route-Tabelle
  `apps/control-api/src/http/route-table.generated.ts` (Rolle, Capability, CSRF, If-Match, Idempotenz, Bodylimit
  pro Operation).

## 2. Neuer Guard: Vertrag und Durchsetzung dürfen nicht auseinanderlaufen

`apps/control-api/test/authorization-contract.test.ts` (neu, 4 Tests, grün) prüft bei jedem Lauf:

1. Der Vertrag wird geparst und die Breite stimmt (>250 Operationen, >140 schreibend).
2. Jede Operation deklariert eine bekannte Rolle; `none` bleibt den öffentlichen Bootstrap-Routen vorbehalten.
3. Jede schreibende Operation deklariert eine Capability, außer sie ist `owner`-only oder eine der belegten
   Auth-/Telemetrie-/Dev-Routen.
4. Die generierte Route-Tabelle enthält **jede** Operation mit exakt derselben Methode, demselben Pfad,
   derselben Rolle und derselben Capability. Eine von Hand editierte Tabelle oder ein Vertrag ohne
   `x-required-role` schlägt hier fehl.

Damit ist „jede Operation erhält Rollen- und Capabilityprüfung" nicht mehr behauptet, sondern bei jedem Testlauf
erzwungen.

## 3. Ergebnis-Matrix (DASH-02.04)

Frisch ausgeführt in dieser Arbeitseinheit (`vitest run`, `--maxWorkers=2`, alle grün):

| Ausgang | Nachweis | Ergebnis |
|---|---|---|
| Erfolg + Revisionsrückleseprobe | `mutations.test.ts` „applies an update whose If-Match equals the current version and increments the version", „guards settings and persists assistantName" | grün (81 Tests im Lauf mit degradation/cloudtalk/contract-gaps) |
| Konflikt | `mutations.test.ts` „answers 409 CONFLICT for a stale version and leaves the resource untouched", `settings-acceptance.spec.ts` (Browser: Adapterrevision 2 gegen Settings-Version 1) | grün |
| 403 / Rolle / Capability | `contract-gaps.test.ts` „answers 403 CAPABILITY_MISSING when the capability is switched off", `security.test.ts`, `messenger-send-routes.test.ts` (Viewer 403, CSRF-Pflicht) | grün (95 Tests im Lauf mit himalaya/contract/settings-content-mutation/adapter-settings) |
| Timeout / Nichterreichbarkeit | `degradation.test.ts`, `cloudtalk.test.ts` „keeps an uncertain API outcome without retrying", `calendar-provider-restart.test.ts` | grün |
| Unbekannter Ausgang | `himalaya-send.test.ts` „keeps ambiguous SMTP outcome permanently unknown and stores no message text", „sends once through the authenticated route and replays the same key"; `messenger-send-routes.test.ts` (`state: "uncertain"`); `settings.ts` bildet `uncertain` auf `state: "unknown"` ab | grün |
| Idempotente Wiederholung, auch nach Neustart | `mutations.test.ts` „replays the stored response for a repeated key and executes only once", „treats parallel requests with one key as one execution", „keeps replaying after a restart of the API"; `himalaya-send.test.ts` „reserves before SMTP and replays across parallel calls and database restart" | grün |

## 4. Abschluss 2026-10-22 (Nachtrag)

Beide offenen Punkte sind jetzt belegt; 02.03 und 02.04 sind abgehakt.

**DASH-02.03 - UI und Sprachdialog, dieselbe Aktion.** `executeSettingsContentMutation`
(`handlers/settings-content-actions.ts`) ruft für den Schreibvorgang `settingsHandlers.updateSettings` - denselben
Handler wie `PATCH /api/v1/settings`. Neuer Test `apps/control-api/test/settings-shared-action.test.ts` (3 Tests,
grün) beweist:

- UI-PATCH mit `if-match` R führt zu R+1, danach staged und bestätigt der Sprachdialog und führt zu R+2; beide
  Felder bleiben gesetzt, beide Wege hinterlassen die Auditaktion `settings.updated`; ein Replay bleibt bei R+2 und
  schreibt keinen zweiten Audit-Eintrag.
- Wird zwischen Vorschau und Bestätigung von anderer Stelle geschrieben, antwortet die Bestätigung mit **409** und
  der gestagte Wert bleibt unangetastet.
- Eine Bestätigung mit derselben `previewId`, aber anderem gesprochenem Text, übernimmt den **gestagten** Inhalt
  oder wird abgelehnt - nie den neu gesprochenen Text.

Damit ist `expectedVersion` nicht mehr nur selbst berechnet, sondern gegen eine konkurrierende Schreiboperation
geprüft. Die feldweise Rückleseprobe bleibt Teil von KEEP-04.

**DASH-02.04 - Migrationshälfte.** `apps/control-api/test/db-migrate-repeatable.test.ts` (2 Tests, grün) arbeitet
auf einer echten SQLite-Datei: Konto (`owner_onboarding`), Mail-Entwurf (`mail_send_journal`, `state=pending`),
Studio-Plan (`content_studio_plan`, Revision 7) und Bibliothekseintrag werden geschrieben, `migrate` erneut
aufgerufen (`[]`), der Prozess neu geöffnet, erneut migriert (`[]`). Alle Zeilen sind byte-gleich vorhanden,
`schema_migrations` behält seine Zeilenzahl, `PRAGMA integrity_check` meldet `ok`, eine Schreiboperation danach
funktioniert. Enrollment liegt nachweislich außerhalb dieser Datenbank (keine Migrations-SQL und keine Tabelle
enthält `enrollment`; die Aufnahme läuft über den Voice-Dienst).

Frische Läufe dieser Arbeitseinheit:

| Nachweis | Ergebnis |
|---|---|
| `pnpm --filter @friday/contracts check` | `ok lint`, `ok validate`, `ok check-generated`, `ok breaking` - passed |
| `vitest run --project node contract settings approvals audit migrate` | 21 Dateien / 495 Tests grün |
| `vitest run --project node settings-shared-action db-migrate-repeatable` | 3 + 2 Tests grün |
| `tsc -p apps/control-api/tsconfig.json --noEmit` | 0 Fehler |

## 5. Was noch offen ist

- **DASH-02.05** — Vor einer Migration entsteht **keine** Sicherung (kein `.bak`, kein Backup-Aufruf in
  `openDatabase`/`migrate`), und eine dokumentierte Lesbarkeit alter Vertragsversionen zur Laufzeit fehlt
  (`CONTRACT_VERSION` wird nur gesendet, es gibt keine Kompatibilitätsprüfung mit klarer Ablehnung). Beides ist
  Umsetzungsarbeit samt geprüfter Rückspielanleitung; Ledger `N-043`.
- `packages/contracts/test/breaking.test.ts` und die Baseline beweisen weiterhin die Erkennung von
  Vertragsbrüchen; `acceptance-environment.md` beschreibt den Snapshot-Rollback, nicht den Vertragsversionswechsel.