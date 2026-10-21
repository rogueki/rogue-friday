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

## 4. Was noch offen ist

- **DASH-02.03** — Einstellungsänderung aus UI und Sprachdialog auf dieselbe Aktion: der Intent-Layer
  (`settings-content-actions.ts`) berechnet `expectedVersion` selbst; die Rückleseprobe pro Feld gehört zu
  KEEP-04 und ist dort noch nicht erbracht.
- **DASH-02.04 (Migrationshälfte)** — Wiederholbarkeit ist für Idempotenz-Journale und Neustarts belegt, nicht
  für eine echte Schema-Migration mit vorhandenen Konten, Entwürfen und Enrollment. Dafür fehlt ein Drill auf
  einer Kopie mit Migrationsvorgängerversion.
- **DASH-02.05** — `packages/contracts/test/breaking.test.ts` und die Baseline beweisen die Erkennung von
  Vertragsbrüchen; das kontrollierte *Lesen* einer alten Vertragsversion zur Laufzeit und die geprüfte
  Rückspielanleitung vor einer Migration stehen noch aus (`acceptance-environment.md` beschreibt den
  Snapshot-Rollback, nicht den Vertragsversionswechsel).