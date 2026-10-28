# Finalization progress — session handoff

Last updated: 2026-10-23 04:05 (Europe/Paris). Branch `feat/friday-finalization-20261021`, base `e98cbf5`.
Read `baseline.md` first, then this page. Every status below is backed by a file in this folder.

## Status board

| Task | State | Evidence |
|---|---|---|
| BASE-01 Basis festhalten | PASS | `baseline.md` |
| BASE-02 Delta inventarisieren | PASS | `requirements.csv`, `issue-ledger.csv`, `inventory.md` |
| BASE-03 Verträge/Schreibbereiche fixieren | PASS | `contract-freeze.md`, `pnpm contracts:check` exit 0 |
| BASE-04 Abnahmeumgebung | PASS (Umgebung) | `acceptance-environment.md`, 35/35 hashgleich |
| DASH-01.01–.05 Istbestand einfrieren | PASS | `inventory.md`, `installer-inventory.csv` |
| INS-01 Bestands- und Fehler-ID-Matrix | PASS | `issue-ledger.csv` |
| DASH-03 Produktionspfad ohne Simulation | PASS | `dash-03-production-path.md`, `live-empty-sources.test.ts`, Rollback-Drill |
| INS-05 Laufkennung/Stillstand | TEIL (Kennung + Meldung + Transportfix, Ereignisformat offen) | `ins-05-run-tracking.md`, `gui-run-tracker.Tests.ps1` |
| INS-04 Stimmen | TEIL (drei Optionen + Dateipruefung, Hoerprobe offen) | `ins-04-voice-choice.md`, `voice-reference.Tests.ps1` |
| INS-03 Anbieterfaehigkeiten | TEIL (Sonde+Katalogcheck, echte Authnachweise offen) | `ins-03-provider-capabilities.md`, `hermes_provider_auth.py`, `setup_hermes.sh`, `hermes_config_bridge.py` |
| INS-02 Installer-Vertraege | PASS | `ins-02-installer-io.md`, `installer-io-contract.Tests.ps1`, `gui-installer.Tests.ps1` (Renderprobe 8 Reiter) |
| INS-06 State/Resume/Mutex | TEIL (Sperre, Zustandssicherung, Fortsetzung und resume.bat belegt; echter WSL-Lauf und halb erledigte Schritte offen) | `ins-06-state-atomic.md` 6/7/8, `installer-lock.Tests.ps1`, `installer-single-instance.Tests.ps1`, `state-recovery.Tests.ps1`, `installer-resume-distro.Tests.ps1` |
| INS-05 Ereignisstrom | TEIL (Protokoll 2 mit konservativem Rueckweg belegt; harte Zeitlimits und Abschlussereignis offen) | `ins-05-event-stream.md`, `gui-protocol.Tests.ps1` |
| INS-05 Abschluss/Warmup | TEIL (genau ein Abschlussereignis mit Exitcode, Warmup start/done um die Modellbereitschaft; Voice-/TTS-Warmup offen) | `ins-05-event-stream.md` 4, `gui-protocol.Tests.ps1` |
| INS-05 Voice-Warmup/Lastfall | TEIL (voice-Warmup als Ereignis, 10 000 Zeilen in 0,68 s korrekt getrennt; Oberflaeche unter Last nur interaktiv pruefbar) | `ins-05-event-stream.md` 3, `gui-protocol.Tests.ps1` |
| INS-04 Stimmplaetze | TEIL (Kette komplett verdrahtet und strukturell belegt; es fehlen Audio-Messung und echter Installationslauf mit Option 3 -> INS-13) | `ins-04-voice-slots.md` 6 |
| INS-08 Assistentenoberflaeche | TEIL (Layoutvertrag, Originalbild per Hash, rechte Flaeche mit 94 %, Kontrast am gerenderten Fenster gemessen, acht Seiten auf dem Rahmen, genau ein Balken, Details im Dialog, Skalierung 125/150/200 % am gezeichneten Fenster gemessen, Tastaturdurchlauf je Seite) | `ins-08-wizard-surface.md` 2-7, `gui-shell-layout.Tests.ps1`, `gui-wizard-pages.Tests.ps1`, `gui-dpi.Tests.ps1` |
| INS-09 Grafische Aufnahme | TEIL (Aufnahme fordert jede Aktion als Datei an; Assistentenseite mit Aufforderung, Fortschritt, "Jetzt sprechen", "Anhören", "Überspringen" und Abbruch; Wiederaufnahme je Block; Profil vor der Aufnahme mit Pruefsummen gesichert; echte Mikrofonaufnahme offen) | `ins-09-voice-enrollment.md`, `gui-interaction.Tests.ps1`, `voice-profile-backup.Tests.ps1`, `gui-wizard-pages.Tests.ps1` (Selbsttest interaction=visible:True ok:True), `test_gui_interaction.py` |
| INS-10 Installerregressionen | PASS (wslpath-Filterung, 503 als Laden, Keepalive als Prozess, 900/120/60/3600 s getrennt, Pruefsummen mit Loeschung, Kindprozess-PATH, WSL-Update begrenzt und abschaltbar; je Regression eine isolierte Probe) | `ins-10-installer-regressions.md`, `installer-regressions.Tests.ps1` (60), `wsl-timeout.Tests.ps1`, `warmup-cancel.Tests.ps1` |
| INS-11 Creator Studio im Command Center | TEIL (Lieferung, Menue und Sicherung belegt: Sync-Modul mit Hash, Creator-Studio-Artefakte im Ziel, Build-Ausgaben ausgeschlossen, Menue standardmaessig aktiv, Sicherung mit Manifest und lesbarer SQLite-Datenbank; physischer Lauf im frischen Zielordner -> INS-13) | `ins-11-dashboard-creator-studio.md`, `dashboard-sync-backup.Tests.ps1` (72), vitest content-studio (18) |
| DASH-02.03/02.04 Vertraege || DASH-04.03/04/05 Skillkonten-Master-Detail | PASS (links Skill mit Quelle und Zustand, Suche und Zustandsfilter, rechts nur die Konten des gewaehlten Skills, geteilte Schluessel benannt statt doppelt abgefragt; kaputter Katalog isoliert; Browser: zwei Skills, Tastatur, 390/1024/1920 px) | `dash-04-settings.md` Abschnitt 6, `skillAccountPlan.test.ts` (6), `SkillAccountWorkbench.test.tsx` (5), `SkillAccountsResilience.test.tsx` (2), Playwright 4/4 |
| DASH-02.05 Recovery | PASS (Sicherung vor Migration mit WAL-Checkpoint und drei Staenden, Restore nur nach `integrity_check`/`schema_migrations`, beschaedigte Kopie abgelehnt, keine Neuanlage; Vertragsversion: 409 bei fremder Hauptversion ohne Aenderung, 400 bei unlesbarer Version) | `dash-02-migration-recovery.md`, `db-migration-backup.test.ts` (4), `contract-version-compat.test.ts` (4) |
 PASS (UI und Sprachdialog ueber denselben Handler mit gemeinsamer Auditaktion und Revisionsschritt, 409 bei veralteter Revision, Bindung an gestagten Inhalt; contracts:check ok, 21 Dateien / 495 Tests, Migration zweimal ohne Doppelanwendung und mit erhaltenen Daten) | `dash-02-contracts.md`, `settings-shared-action.test.ts`, `db-migrate-repeatable.test.ts` |
| INS-12 Starter und Abbruch | TEIL (Doppelklick startet die Oberflaeche, CLI-Modus dokumentiert, Parameter kommen durch cmd und cscript unveraendert an, Abbruch der Windows-Abfrage ohne Aenderung, Simulation nur im Testmodus; echter Dialog und Start aus dem ZIP -> INS-13) | `ins-12-launcher.md`, `launcher.Tests.ps1` (49) |
| DASH-10.02 Skillinventar | **PASS** (Live-Inventar 159 Skills: 53 builtin, 106 external mit `origin`/`trust`; Version ehrlich unbekannt, weil die CLI keine Spalte fuehrt; Detail laedt `SKILL.md` erst bei Auswahl als Text ohne HTML; Filter Suche/Quelle/Kategorie/Herkunft/Status und 60er-Seiten; 35 Web-Tests) *(PASS 2026-10-23)* |
| DASH-10.03 per-Skill-Schalter | PASS (Schalter = `skills.disabled`, nur ueber `save_disabled_skills`/`PUT /api/skills/toggle`; `opt-in/opt-out` sind Seeding-Schalter; Readbackprobe im wegwerfbaren Profil 72->71->72 mit Zeile `arxiv disabled`, Default-Profil unveraendert; Friday bestaetigt jede Aenderung durch erneutes Lesen, Test fuer ausbleibende Bestaetigung) | `dash-10-03-skill-enable.md`, `skills-onboarding.test.ts` (21) |
| DASH-10.04 Skill-Operationen | **PASS** (13 der 14 Befehle typisiert: `search`/`list-modified` mit striktem JSON-Parser, `inspect`/`audit`/`diff`/`browse`/`check`/`tap-list` als unveraenderter Text, `install`/`update`/`uninstall` ueber DASH-10.07, `trust`/`untrust`/`tap add|remove`/`reset` ueber `POST /api/v1/skills/governance`; `config` ist nachweislich nur interaktiv und wird bewusst nicht exponiert (N-059); fehlende Skill-Wurzel wird gemeldet; 282 Operationen; live belegt in wegwerfbaren Profilen) | `dash-10-04-skill-operations.md`, `test_hub_search.py`, `test_skill_report.py`, `test_skill_command.py` (12), `test_skill_governance.py` (16), `skills-command-route.test.ts` (3), `skills-governance-route.test.ts` (3) |
| DASH-10.05 Registry-Flaeche | **PASS** (Treffer mit Quelle/Trust/Kennung/Beschreibung; Quellen- und Pruefbefund je Treffer ueber `inspect`/`audit` mit Name **oder** Kennung; lokal geaenderte Skills mit Diff-Ansicht und CLI-Begruendung im Fehlerfall; kein Installationsknopf ohne Bestaetigungspfad; offen bleibt nur der gefuehrte Wiederverwendungsschritt fuer vorhandene Referenzen, der zu DASH-07/08 gehoert) | `dash-10-05-skill-registry-ui.md` (Abschnitt 7 und 8), `SkillRegistryPanel.test.tsx` (7), `skills-report-reason.test.ts` (3), `test_skill_report.py` (13), Live: `inspect` mit Kennung rc 0 und mit Name rc 0 plus Resolved-to-Zeile |
| DASH-10.06 Abnahme Skill-Lebenszyklus | TEIL (CLI-Abnahme im wegwerfbaren Profil: Builtin, Friday- und Hub-Skill angesehen und verwaltet, Readback in neuem Prozess, modifizierter Builtin nur mit `--force` ueberschrieben; API-Laufzeitnachweis: 159 Skills mit `origin`/`trust`, `diff`/`inspect`/`tap-list` live, Zustand nach Prozessneustart identisch, fehlende Distribution mit benanntem Fehler [N-064..N-071]. Offen: Hub-Skill ueber die API, fehlendes externes Laufwerk, Katalogseite am Operator-System) *(TEIL 2026-10-23: `dash-10-06-skill-verwaltung-live.md`)* |
| INS-05/INS-07 Ueberwachte Unterprozesse | TEIL (Quotierung, Zeitlimit und gezieltes Beenden mit echten Kindprozessen belegt; keine Job-Objekte, wsl-Aufrufe offen) | `supervised-processes.md`, `process-supervisor.Tests.ps1` |
| INS-07 Kooperativer Abbruch | TEIL (Abbruchbitte, Schrittgrenzen und GUI-Bitte belegt; harter Notausstieg nur nach Wartezeit) | `ins-07-cooperative-cancel.md`, `installer-cancel.Tests.ps1` |
| DASH-07 Hermes-Paritaet | 07.01/07.02 PASS, 07.03-07.06 offen | `dash-07-hermes-inventory.md`, Live-Inventar Hermes 0.22.2 |
| DASH-02 Vertraege | 02.01/02.02 PASS, 02.03/02.05 offen, 02.04 teilweise | `dash-02-contracts.md`, `authorization-contract.test.ts` (4 gruen), 176 Handler-/Event-Tests gruen |
| DASH-04 Einstellungen ehrlich | 04.01/04.02 PASS, 04.04 Adapter-Haelfte PASS; 04.03/04.05 offen | `dash-04-settings.md`, `tests/e2e/settings-acceptance.spec.ts` (3 gruen), 92 Settings-Tests |
| all other INS/DASH/KEEP/REL | OPEN | owner rows in `requirements.csv` |

## Task records (format from master §3.3)

### BASE-01

- requirement_ids: BASE-01; predecessor: none
- base_revision: `e98cbf548cbf5b65369c97aae335d6883855eb7e`; result_revision: same (docs only)
- write_scope: `docs/agent-work/finalization/`
- implementation_paths: `baseline.md`
- test_command: `git status --short`, `git rev-parse HEAD`, `Get-NetTCPConnection`, `Invoke-WebRequest /api/v1/health`,
  `wsl -l -v`, `hermes --version`, registry read of `HKCU:\…\Lxss`
- expected: clean checkout, recorded runtime, no secret in the document
- observed: clean tree, live runtime D:\Dokumente\F.R.I.D.A.Y on FRIDAY-2, 5 ports, 19 health components, Hermes 0.22.2
- evidence_paths: `baseline.md`; status: PASS; remaining_work: none

### BASE-02

- requirement_ids: BASE-02, REQ-01, REQ-22; predecessor: BASE-01
- base_revision: `e98cbf5`; result_revision: `e98cbf5` (docs only)
- implementation_paths: `requirements.csv` (168 rows), `issue-ledger.csv` (80 rows), `inventory.md`,
  `installer-inventory.csv` (16 rows)
- test_command: `py -3 tools/check_ledgers.py` equivalent (ad-hoc script, see below), master checkbox count
- expected: 154 checklist points, no orphan master ID, no duplicate ledger ID
- observed: 154 checkboxes (141 bold + 13 INS), 0 orphan IDs, 0 duplicates, both CSVs parse
- evidence_paths: `inventory.md` §1–2; status: PASS
- remaining_work: field-level *re-proving* of `settings-runtime-map.csv` on `e98cbf5` stays with KEEP-04 —
  the rows are inventoried, their acceptance cells are still `NOT_RUN`

The check used for the ledgers is reproducible with:

```powershell
py -3 -c "import csv,collections; rows=list(csv.DictReader(open(r'docs/agent-work/finalization/requirements.csv',encoding='utf-8'))); print(len(rows), [k for k,v in collections.Counter(r['req_id'] for r in rows).items() if v>1])"
```

### INS-01

- requirement_ids: INS-01; predecessor: BASE-02
- implementation_paths: `issue-ledger.csv`
- expected: each journal ID assigned to regression, outstanding implementation or historical operation
- observed: 62 journal rows + 12 collection-list rows + 6 session findings; no historical deletion
  (I-002/I-037/I-039) turned into an install task
- status: PASS; remaining_work: INS-10 has to close the `FIXED_NEEDS_REGRESSION` rows with a real run

### DASH-01

- requirement_ids: DASH-01.01–.05; predecessor: BASE-01/02
- implementation_paths: `installer-inventory.csv`, `inventory.md`
- observed: four inventories exist and are named with their source revision; the installer inventory proves
  13 of 16 rows against the live installation and marks 15b (data mode) as FAIL
- status: PASS for the inventory; the defect itself is DASH-03

### INS-02

- requirement_ids: INS-02; predecessor: INS-01
- implementation_paths: `installer/install-friday-gui.ps1` (Reiter KI-Zugang, Transport, Selbstpruefung),
  `installer/install-friday.ps1` (kein stiller Standardanbieter), `installer/tests/installer-io-contract.Tests.ps1`
  (neu), `installer/tests/gui-installer.Tests.ps1` (acht Reiter), `docs/agent-work/finalization/ins-02-installer-io.md`
- test_command: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer/tests/installer-io-contract.Tests.ps1`;
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File installer/tests/gui-installer.Tests.ps1`; alle uebrigen
  `installer/tests/*.Tests.ps1` und `installer/test/data-mode.test.ps1`
- expected: jede Backendinteraktion hat eine GUI-Route oder eine vorausgehende Antwort, keine versteckte
  stdin-Abfrage, Vertrag vor der UI eingefroren
- observed: Transportprotokoll 1 mit 28 Antworten und 7 Geheimnissen; 19 `Read-Host`-Stellen ausnahmslos durch
  `$GuiMode` oder `Ask`/`Choose`/`YesNo` gedeckt; vorher fehlende Anbieterroute (OpenAI/Anthropic/Erweitert)
  ergaenzt und der stille Kimi-Standard durch einen Abbruch ersetzt; AST-Waechter und Renderprobe (8 Reiter,
  DPAPI, Exitcodes 0/1/10) gruen; alle 11 Installer-Testskripte gruen
- evidence_paths: `ins-02-installer-io.md`; status: PASS
- remaining_work: INS-03 (echte Auth-Pruefung je Anbieter, Custom-Endpoint, OAuth-Ablehnung/Timeout),
  INS-04 (voiceChoice 1/2/3 synchron), INS-05, INS-06

### DASH-07 (07.01/07.02)

- requirement_ids: DASH-07.01/07.02; predecessor: DASH-01, DASH-02, DASH-04
- implementation_paths: `docs/agent-work/finalization/dash-07-hermes-inventory.md`; erfasst
  `apps/control-api/src/services/hermes-config.ts` (82 Felder), `handlers/hermes-config.ts` (7 Handler),
  `HermesConfigArea.tsx` (685 Zeilen), 11 Hermes-Vertragsoperationen
- test_command: rein lesende Live-Abfragen in `FRIDAY-2` (`hermes --version`, `hermes auth list/status`,
  `hermes fallback list`, `hermes gateway status/list`, `hermes sessions list`, `hermes cron list`,
  `hermes config get model`, `hermes config check`, `config.yaml`-Struktur, `models_dev_cache.json`) sowie
  `py -3`-Zaehlung der Friday-Felder und `openapi`-Abfrage
- expected: installierte Hermes-Version, CLI-Umfang, Configschema und Plugins real erfassen; jede Faehigkeit des
  alten Paritaetsplans einer Friday-Flaeche mit wirksamer Backendoperation oder einer begruendeten
  Nichtverfuegbarkeit zuordnen
- observed: Hermes 0.22.2 (Schema 50, 232 Provider/9168 Modelle, 58 Skills, 3 Plugins, Gateway aktiv, 1 Session,
  keine Cronjobs, leere Fallback-Kette); 18 Paritaetszeilen zugeordnet, 11 Operationen und 82 Felder als Flaeche
  belegt; Luecken fuer 07.03/07.04 explizit benannt; neue Erkenntnis N-008 (einzige Credential `kimi-coding`
  meldet 403)
- evidence_paths: `dash-07-hermes-inventory.md`; status: PASS fuer 07.01/07.02
- remaining_work: 07.03 (Provider-/Key-Flaeche, Customendpoints, lokale Modelle, `memory.*`), 07.04 (OAuth-Flow
  ueber Hermes, ohne eigenen Client), 07.05 (echter Modellaufruf inkl. N-008, Fallback, zweiter Zugang), 07.06
- (Recovery)

### DASH-02

- requirement_ids: DASH-02.01/02.02 (PASS), DASH-02.03/02.04/02.05 (teilweise bzw. offen)
- predecessor: BASE-03 (gemeinsamer Vertragsmeilenstein)
- base_revision: `15d90af`; result_revision: (offen bis Commit)
- implementation_paths: `apps/control-api/test/authorization-contract.test.ts` (neu),
  `docs/agent-work/finalization/dash-02-contracts.md`
- test_command: `npx vitest run test/authorization-contract.test.ts`, `npx vitest run test/mutations.test.ts
  test/degradation.test.ts test/cloudtalk.test.ts test/contract-gaps.test.ts`, `npx vitest run
  test/himalaya-send.test.ts test/messenger-send-routes.test.ts test/contract.test.ts test/security.test.ts
  test/settings-content-mutation.test.ts test/adapter-settings.test.ts`, `pnpm contracts:check`, `pnpm typecheck`,
  `pnpm lint`
- expected: jede Vertragsoperation deklariert Rolle und Capability, die Durchsetzung entspricht dem Vertrag, und
  Erfolg, Timeout, 403, Konflikt sowie unbekannter Ausgang sind durch gezielte Tests belegt
- observed: 271 Operationen (163 owner, 62 viewer, 44 operator, 2 none), 236 mit Capability; der neue Guard
  vergleicht alle 271 mit der generierten Route-Tabelle (0 Abweichungen); 4 + 81 + 95 = 180 Tests gruen, davon
  176 in den Vertrags-/Handler-Dateien; `contracts:check` und `typecheck` exit 0, `lint` 0 Fehler
- evidence_paths: `dash-02-contracts.md`; status: PASS fuer 02.01/02.02
- remaining_work: 02.03 (Rueckleseprobe pro Feld, KEEP-04), 02.04 Migrationsdrill mit Konten/Entwuerfen/
  Enrollment, 02.05 kontrolliertes Lesen der alten Vertragsversion

### DASH-03

- requirement_ids: DASH-03.01-.05; predecessor: BASE-02/BASE-03
- implementation_paths: `apps/control-api/src/runtime/adapter-wiring.ts`, `apps/control-api/src/handlers/meta.ts`,
  `apps/web/src/features/settings/AdaptersArea.tsx`, `installer/lib/data-mode.ps1`, `installer/install-friday.ps1`,
  `packages/config/src/load.ts`, `scripts/finalization/rollback-drill.ps1`
- test_command: `vitest run test/live-empty-sources.test.ts test/adapter-wiring.test.ts` (control-api),
  `pnpm test:conformance`, `scripts/finalization/rollback-drill.ps1` with and without `-Migrate`
- expected: a live runtime without configured sources creates no mock adapter and shows no simulated data;
  the delivered configuration is honest; a rollback restores the previous behaviour
- observed: live with an empty allowlist lists only the configured `tasks:hermes-tasks` (dead upstream
  `127.0.0.1:9`), no `mock-*` health component, memory/automations/communication/channels/agents answer 4xx,
  `/skills` returns `data: []`; `/api/v1/meta` reports `dataMode: live`, `features.mockData: false`; the
  rollback drill without migration boots 19 components with 15 simulated adapters, with `-Migrate` 4 components
  and 0 adapters; an invalid `dataMode: turbo` is rejected with exit 2
- evidence_paths: `dash-03-production-path.md`, `acceptance-environment.md`; status: PASS; remaining_work: none

### DASH-04

- requirement_ids: DASH-04.01/04.02 (PASS), DASH-04.03/04.04 Skill-Haelfte/04.05 (open)
- predecessor: DASH-02, DASH-03
- base_revision: `5efaac9`; result_revision: `d03527e`
- implementation_paths: `apps/web/src/features/settings/{SettingsPage,AdaptersArea,settings.css,testApi}.tsx`,
  `apps/web/src/i18n/modules/d.{de,en}.ts`, `tests/e2e/settings-acceptance.spec.ts`,
  `tests/e2e/support/fixtures.ts`
- test_command: `npx playwright test tests/e2e/settings-acceptance.spec.ts`, `npx playwright test
  tests/e2e/settings.spec.ts`, `npx vitest run src/features/settings src/i18n` (apps/web), `pnpm typecheck`,
  `pnpm lint`
- expected: master-detail opens the selected adapter, drafts survive or are dropped only after confirmation,
  a saved configuration is read back after a reload, the owner writes while a read-only role cannot, and the
  page works at 390/1024/1920 px and by keyboard alone
- observed: 3 e2e tests green (mock-tasks 111 discarded, mock-memory 333 persisted and read back after reload,
  `dev-viewer` sees "Nur lesend" with a disabled save button and no adapter credentials, no horizontal overflow
  at all three widths, Enter opens and Escape cancels the draft dialog); 6 existing settings e2e tests stay
  green; 92 settings/i18n unit tests green; `If-Match` defect fixed (adapter revision instead of settings
  version), proven by a 409 before and a 200 after
- evidence_paths: `dash-04-settings.md` §4; status: PASS for 04.01/04.02 and the adapter half of 04.04
- remaining_work: 04.03 search over source/status needs the DASH-07 inventory; 04.04 needs a stack with a
  skills catalog and a Hermes bridge for the "two skills" half; 04.05 recovery drill

### DASH-05

- requirement_ids: DASH-05.01/05.02 (PASS), DASH-05.03/05.04/05.05/05.06 (open)
- predecessor: DASH-03, DASH-04
- base_revision: `1f05c65`; result_revision: `9583e00` (Code), `7554f07` (Nachweise)
- implementation_paths: `apps/web/src/features/communication/{channelList.ts,channelList.test.ts,ChannelRail.tsx,
  CommunicationPage.tsx,HimalayaMailbox.tsx,MessengerCompose.tsx,labels.ts,communication.test.tsx}`,
  `apps/web/src/features/memory/kit/channelStatus.tsx`, `apps/web/src/i18n/modules/b.{de,en}.ts`,
  `packages/contracts/schemas/communication/channel-kind.schema.json`, `packages/generated-sdk/src/generated/*`,
  `packages/mock-data/src/seed/{communication.ts,story.ts}`, `tests/e2e/communication.spec.ts`
- test_command: `vitest run --project web communication`, `vitest run --project web --maxWorkers=2`,
  `vitest run --project node --maxWorkers=2`, `tsc -p apps/web`, `tsc -p apps/control-api`,
  `pnpm contracts:check`, `pnpm build:app`, `playwright test tests/e2e/communication.spec.ts`
- expected: die Kommunikation zeigt genau sechs Standardkanaele in der Reihenfolge der Spezifikation, SMS ist kein
  Filter, oberhalb der Kanaele steht kein Mail- oder Messenger-Formular, das Postfach erscheint im E-Mail-Kanal und
  der Messenger-Schritt im Messenger-Kanal
- observed: `channelList.test.ts` 4 Tests (Reihenfolge, Ausblenden, Sortierung, Gruppierung); `communication.test.tsx`
  20 Tests inklusive sechs Eintraegen und Platzierung von Postfach/Messenger; volle Laeufe web 81 Dateien/648 Tests
  und node 191 Dateien/2789 Tests gruen; `contracts:check` inklusive breaking gruen; Browser 2/2 in 23,7 s mit
  390/1024/1920 px ohne horizontalen Overflow
- evidence_paths: `dash-05-communication.md`; status: PASS fuer 05.01 und 05.02
- remaining_work: 05.03 gefuehrter E-Mail-Wizard (heute flaches Formular), 05.04 Mehrkonten/Alias/UIDVALIDITY/
  Sendjournal gegen die Anforderung pruefen, 05.05 zwei echte Testpostfaecher, 05.06 Wizardabbruch und Sendetimeout

### DASH-05.03

- requirement_ids: DASH-05.03; predecessor: DASH-05.02
- base_revision: `57857a3`; result_revision: folgt mit dem Commit dieses Blocks
- implementation_paths: `packages/contracts/schemas/settings/mail-connection-test-{request,response}.schema.json`,
  `packages/contracts/openapi/friday-api.yaml`, `packages/generated-sdk/src/generated/*`,
  `installer/wsl/mail_accounts.py`, `installer/wsl/tests/test_mail_accounts_candidate.py`,
  `apps/control-api/src/{services/mail-accounts.ts,handlers/settings.ts,http/route-table.generated.ts}`,
  `apps/control-api/test/mail-connection-test.test.ts`,
  `apps/web/src/features/settings/{mailPresets.ts,MailAccountWizard.tsx,MailAccountsArea.tsx}` plus Tests,
  `tests/e2e/mail-wizard.spec.ts`, `apps/control-api/src/db/database.ts` (Lint-Korrektur)
- test_command: `py -3.11 installer/wsl/tests/test_mail_accounts_candidate.py`, `pnpm contracts:check`,
  `tsc -p apps/control-api`, `tsc -p apps/web`, `vitest --project node mail-connection-test`,
  `vitest --project web MailAccountWizard`, `vitest --project web mailPresets`, volle web- und node-Laeufe,
  `pnpm lint`, `pnpm typecheck`, `pnpm build:app`, `playwright test tests/e2e/mail-wizard.spec.ts`
- expected: Adresse -> Absendername -> erkannte bearbeitbare Server -> Authentifizierung -> getrennte
  Verbindungstests -> Ordner/Standard -> Zusammenfassung; keine geratenen Server, kein Speichern vor dem
  letzten Schritt, keine Nachricht durch die Tests, ehrlicher Zustand ohne Bruecke
- observed: alle sieben Schritte im Browser belegt; Python 11, API 5, Wizard 6, Vorschlaege 5 Tests;
  web 83 Dateien/659 Tests und node 192 Dateien/2794 Tests (60 skipped) gruen; `contracts:check`, `tsc`,
  `pnpm lint` (0 Fehler), `pnpm typecheck`, `build:app` und Browser 2/2 in 33,2 s gruen
- evidence_paths: `dash-05-email-wizard.md`; status: PASS fuer DASH-05.03
- remaining_work: 05.04 Abnahme, 05.05 echte Testpostfaecher, 05.06 Abbruch-/Timeout-Probe
### DASH-05.04

- requirement_ids: DASH-05.04; predecessor: DASH-05.03
- base_revision: `1f062cf`; result_revision: folgt mit dem Commit dieses Blocks
- implementation_paths: `installer/wsl/mail_accounts.py`, `installer/wsl/tests/test_mail_accounts_bridge.py`
  (neu), `apps/control-api/src/services/mail-accounts.ts`,
  `apps/control-api/test/{mail-accounts-routes,mail-account-errors}.test.ts`,
  `apps/web/src/features/communication/{MailCompose.tsx,MailCompose.test.tsx,HimalayaMailbox.test.tsx}`
- test_command: `py -3.11 installer/wsl/tests/test_mail_accounts_bridge.py`,
  `vitest --project node mail-accounts-routes mail-account-errors mail-bridge mail-action-intent`,
  `vitest --project web MailCompose HimalayaMailbox`, volle web- und node-Laeufe, `pnpm lint`,
  `pnpm typecheck`, `pnpm build:app`, `playwright test tests/e2e/mail-wizard.spec.ts`
- expected: mehrere Konten ohne Vermischung, Alias als Absender, Ordner/UIDVALIDITY, Anhaenge und UTF-8,
  Entwuerfe und Sent-Kopie, Lesen ohne stilles Als-gelesen-Markieren, Versandjournal und kein Doppelversand
- observed: Bridge 24 Zusicherungen inklusive Lesemodus und echter Gegenproben; API-Routen 5 und
  Fehlerabbildung 4; Compose 7 und Postfach-UI 3; web 84/666, node 2800 (60 skipped) gruen; lint 0 Fehler,
  typecheck, build:app und Browser 2/2 in 27,4 s gruen
- evidence_paths: `dash-05-mail-accounts.md`; status: PASS fuer DASH-05.04 (ohne echte Postfaecher)
- remaining_work: 05.05 echte Testpostfaecher und Fehlererklaerung, 05.06 Abbruch/Timeout
### DASH-05.06

- requirement_ids: DASH-05.06 (PASS), DASH-05.05 (TEIL); predecessor: DASH-05.04
- base_revision: `2315b22`; result_revision: folgt mit dem Commit dieses Blocks
- implementation_paths: `apps/web/src/features/settings/MailAccountWizard.tsx`,
  `apps/web/src/lib/api/stagedWrite.tsx`, `apps/web/src/features/communication/MailCompose.tsx`,
  `apps/control-api/src/services/mail-accounts.ts`, Tests: `MailAccountWizard.test.tsx`,
  `MailCompose.test.tsx`, `HimalayaMailbox.test.tsx`, `mail-account-errors.test.ts`,
  `installer/wsl/tests/test_mail_accounts_bridge.py`
- test_command: `py -3.11 installer/wsl/tests/test_mail_accounts_bridge.py`,
  `vitest --project web MailAccountWizard MailCompose HimalayaMailbox`,
  `vitest --project node mail-account-errors`, volle web- und node-Laeufe, `pnpm lint`, `pnpm typecheck`,
  `pnpm build:app`, `playwright test tests/e2e/mail-wizard.spec.ts`
- expected: Abbruch ohne teilaktivierte Verbindung, Timeout als "unbekannt" ohne Wiederholung, kein Loeschen
  bestehender Nachrichten/Entwuerfe; fuer 05.05 zusaetzlich erklaerbare Passwort-/TLS-/Tokenfehler und
  Konten nach UI-Neustart
- observed: Abbruchtest ohne Schreibaufruf; Timeouttest mit genau zwei Send-Aufrufen und "Antwort unbekannt";
  Brueckentest ohne EXPUNGE/Deleted; OAuth-Abbildung in beiden Fehlerpfaden; Neustarttest mit erneuter
  Konten-/Ordnerabfrage. Web 84/669, node 2801 (60 skipped) gruen, lint/typecheck/build 0, Browser 2/2
- evidence_paths: `dash-05-recovery.md`; status: PASS fuer DASH-05.06, TEIL fuer DASH-05.05
- remaining_work: 05.05 zwei echte kontrollierte Testpostfaecher, danach DASH-06
### DASH-06

- requirement_ids: DASH-06.01/06.02/06.03/06.05 (PASS), DASH-06.04 (TEIL); predecessor: DASH-05
- base_revision: `90d383b`; result_revision: folgt mit dem Commit dieses Blocks
- implementation_paths: `apps/web/src/features/settings/CalendarAccountWizard.tsx` (neu),
  `apps/web/src/features/settings/AdaptersArea.tsx`, `apps/web/src/features/calendar/CalendarPage.tsx`
  (Kontoblock entfernt, `CalendarAccounts.tsx` geloescht), `packages/contracts/schemas/integrations/
  calendar-account-action.schema.json`, generiertes SDK, `apps/control-api/src/services/calendar-accounts.ts`,
  `installer/wsl/calendar_accounts.py`, `installer/wsl/test_calendar_accounts.py`,
  `apps/web/src/features/settings/CalendarAccountWizard.test.tsx` (neu)
- test_command: `python3 test_calendar_accounts.py` in WSL, `vitest --project web CalendarAccountWizard`,
  `vitest --project node calendar`, volle web-Suite, `pnpm lint`, `pnpm typecheck`, `pnpm build:app`,
  `playwright test settings.spec.ts settings-acceptance.spec.ts`
- expected: Wizard im Adapterdetail, zwei Kalender mit Rechten, echter CRUD-Fixture, read-only verhindert
  Schreiben, ETag-Konflikt ohne fremden Verlust, DST/Serien/Ganztag, sauberer Schreibtest, Recovery
- observed: 11/11 Fixture-Tests inklusive Schreibtest/Aufraeumen/Kontoentfernen/Recovery, 5/5 Wizard,
  60/60 Kalender-API, web 85/674, lint/typecheck/build 0, Settings-Browser 10/10
- evidence_paths: `dash-06-calendar-accounts.md`; status: PASS ausser 06.04 (TEIL, realer Anbieter fehlt)
- remaining_work: 06.04 realer Anbieter, danach DASH-07
### DASH-07.03-07.06

- requirement_ids: DASH-07.03, 07.04, 07.05, 07.06 (alle TEIL); predecessor: DASH-07.01/07.02
- base_revision: `6ab6376`; result_revision: folgt mit dem Commit dieses Blocks
- implementation_paths: keine neuen Produktpfade; Bestand in `apps/control-api/src/services/hermes-config.ts`,
  `apps/web/src/features/settings/HermesConfigArea.tsx`, Vertrag `packages/contracts/openapi/friday-api.yaml`
- test_command: volle node-/web-Suite, `pnpm lint`, `pnpm typecheck`, `pnpm build:app`; rein lesend
  `hermes --version`, `hermes auth list`, `hermes auth --help`
- expected: Zugaenge anzeigen/hinzufuegen/erneuern/trennen, Abo vs. Key, OAuth-Flow, echter Modellaufruf
- observed: diese Flaechen fehlen; vorhanden sind Konfigfelder, Katalog, MCP-OAuth und Revisionskonflikt.
  Hermes ist lokal erreichbar (v0.20.5), `auth`-CLI-Flaeche vorhanden, aber nicht angebunden; kein
  Modellaufruf ausgefuehrt
- evidence_paths: `dash-07-access-partial.md`, `dash-07-hermes-inventory.md`; status: TEIL (blockiert durch
  fehlende Flaeche, nicht durch Umgebung)
- remaining_work: 07.03 Vertrag+UI, 07.04 Flow, 07.05 Modellaufruf, 07.06 Recovery
### INS-06

- requirement_ids: INS-06; predecessor: INS-02
- implementation_paths: `installer/lib/installer-lock.ps1` (neu), `installer/install-friday.ps1`,
  `installer/install-friday-gui.ps1`
- test_command: `powershell -File installer/tests/installer-lock.Tests.ps1`,
  `installer/tests/installer-single-instance.Tests.ps1`, `installer/tests/state-recovery.Tests.ps1`,
  `installer/tests/state-atomic.Tests.ps1` und die uebrigen `installer/tests/*.Tests.ps1`
- expected: ein zweiter Start aendert nichts und wird als solcher erkannt; eine wiederverwendete PID gilt nicht
  als laufender Installer; eine tote Sperre blockiert nicht dauerhaft; ein unlesbarer Zustand kostet den
  Fortschritt nicht
- observed: Mutex `Global\FRIDAY-Installer` plus Sperrdatei mit PID/Startzeit; zwei echte Prozesse - genau einer
  arbeitet, der andere nennt dessen PID; der echte Einstiegspunkt endet mit Exitcode 20 und schreibt weder
  `resume.bat` noch Protokoll; nach dem Ende ist die Sperre sofort wieder frei; Negativkontrolle ohne `WaitOne`
  laesst beide Prozesse parallel laufen; `install-state.json.bak` wird nach jedem Speichern geschrieben, eine
  abgeschnittene oder strukturell falsche Datei wird aus der Sicherung wiederhergestellt, ohne Sicherung bricht
  der Installer mit Klartext ab; 15/15 Installer-Tests Exit 0
- nachtrag: `installer-resume-distro.Tests.ps1` (neu) belegt zusaetzlich, dass die Fortsetzung ohne `-DistroName`
  Distribution und Ablageort aus dem Zustand uebernimmt, widersprechende Angaben mit Klartext abbricht, den
  Zustand unveraendert laesst und dass `resume.bat` einen Pfad mit Leerzeichen und Umlaut korrekt zitiert und in
  dieser Form laeuft. Dabei zwei Defekte gefunden und behoben: N-018 (resume.bat in Windows-1252 geschrieben,
  cmd liest OEM - Umlaute verstuemmelt) und N-019 (Distro wurde erst nach der Widerspruchspruefung uebernommen,
  resume.bat schlug `Ubuntu` vor). 16/16 Installer-Tests Exit 0.
- nachtrag 2: `fresh-root.Tests.ps1` (neu) sichert die Erstanlage mit eigenem Root ab. Grund: die eigene Sperrdatei
  unter `<Root>\run` entstand vor der Leerpruefung, sodass ein leerer Zielordner als "nicht leer" abgewiesen worden
  waere (N-020, eigene Regression). `Test-FreshRootEmpty` ignoriert nur die eigene Sperrdatei; sechs Funktionsfaelle
  plus echter Einstiegspunkt mit Umlautpfad. 17/17 Installer-Tests Exit 0.
- evidence_paths: `ins-06-state-atomic.md` 6/7/8/9; status: TEIL
- remaining_work: echter WSL-Lauf mit eigener Distro (INS-13), Wiederholbarkeit halb erledigter Schritte,
  systematische Parameterquotierung (Sonderzeichen wie `&`, sehr lange Pfade)
### INS-07 Kooperativer Abbruch (2026-10-22)
- goal: die GUI soll einen laufenden Installer an einer sicheren Grenze anhalten, statt ihn mit taskkill /T zu
  erschlagen; Abbruch darf keine halben Artefakte und keine mitgerissenen Dienste hinterlassen.
- changed: `installer/lib/installer-cancel.ps1` (neu, Abbruchbitte mit Laufkennung), `install-friday.ps1`
  (Vorstart-Abbruch, `Confirm-NotCancelled` an 15 Schrittgrenzen und in `Native`/`Invoke-Pip`/`Download`,
  gemeinsame `$InstallRunId`), `install-friday-gui.ps1` (`Request-GuiCancel`, `Stop-BackendGracefully` mit 25 s
  Wartezeit, `FormClosing` ohne sofortiges taskkill).
- observed: Modul- und Funktionsverhalten, Vollstaendigkeit aller Schrittbloecke und Runner, GUI-Reihenfolge und
  echter Einstiegspunkt (passende Bitte → Exitcode 1 mit `[ABBRUCH]` ohne Schrittarbeit und ohne `resume.bat`;
  fremde Laufkennung → Lauf laeuft weiter bis zur naechsten Pruefung).
- evidence_paths: `ins-07-cooperative-cancel.md` 1-4; status: TEIL
- remaining_work: Job-Objekte fuer gezielte Unterprozessverwaltung, Abbruch mitten in Download/pip belegen,
  Resume-Pruefung unvollstaendiger Artefakte
### INS-05 Ereignisstrom Protokoll 2 (2026-10-22)
- goal: strukturierte Ereignisse statt Status aus Textmustern; Download, Paketinstallation und Schritt getrennt
  benennen; unbekannte oder kaputte Zeilen duerfen die GUI nicht verfaelschen.
- changed: `installer/lib/gui-protocol.ps1` (neu), `install-friday.ps1` (`Enter-Step` meldet `step start`,
  `MarkDone` meldet `step done`, `download`/`pip`/`run`-Ereignisse), `install-friday-gui.ps1`
  (`Receive-BackendLine` fuer stdout und stderr, Anzeigetext nur aus Feldern).
- observed: Erzeugung/Rueckweg inklusive Umlauten, Quotes und Backslash; neun Gegenfaelle bleiben Text;
  alle 15 Schrittbloecke melden den richtigen Namen; echter Einstiegspunkt liefert lesbares Laufereignis.
- evidence_paths: `ins-05-event-stream.md` 1-3; status: TEIL
- remaining_work: harte Schritt-Zeitlimits, Abschlussereignis mit Exitcode, eigener Modell-Warmup-Typ, Lastfall
  mit Paketspam
### INS-05/INS-07 Ueberwachte Unterprozesse (2026-10-22)
- goal: kein unbegrenzter Download und kein 120-Minuten-pip ohne Abbruchweg; Abbruch darf nur den gestarteten
  Prozess treffen.
- changed: `installer/lib/process-supervisor.ps1` (neu: `ConvertTo-WindowsArgument`, `Invoke-SupervisedProcess`),
  `install-friday.ps1` (`DownloadTimeoutSeconds = 3600`, Download ueber Supervisor mit `CancelCheck` und
  `TimedOut`-Warnung, `Invoke-Pip` beendet bei Abbruch gezielt `$proc.Id`).
- observed: Quotierung kommt durch einen echten Kindprozess (Leerzeichen, Umlaut, Anfuehrungszeichen, finaler
  Backslash) unveraendert an; Exitcode 7; Zeitlimit 2 s beendet den Kindprozess, ein fremder Bruderprozess lebt
  weiter; Abbruch via `CancelCheck` ebenso; `Start-Process -PassThru` mit Umleitung liefert in PS 5.1 keinen
  Exitcode (deshalb `ProcessStartInfo` ohne Umleitung).
- evidence_paths: `supervised-processes.md` 1-4; status: TEIL
- remaining_work: Job-Objekte fuer Nachfahren, `wsl.exe`-Aufrufe ueberwachen, Modell-Warmup/Dashboardwechsel
  einzeln belegen, Lastfall Paketspam
### INS-05 Abschluss- und Warmup-Ereignisse (2026-10-22)
- goal: ein Lauf muss im Ereignisstrom sichtbar enden; ein langsamer Modellstart darf nicht als anonymer Teil des
  Schritts verschwinden.
- changed: `gui-protocol.ps1` (`Write-GuiRunDone` mit Einmal-Garantie), `install-friday.ps1` (`Stop-Install` meldet
  `failed`/1, normales Ende `ok` mit `$finalCode`, qwen meldet `warmup start/done`), `install-friday-gui.ps1`
  (`warmup`/`run`-Anzeige, `$script:sawRunDone`, Hinweis bei fehlendem Abschlussereignis).
- observed: zwei Aufrufe erzeugen genau eine Zeile; echter Einstiegspunkt liefert genau ein Abschlussereignis mit
  `state=failed`, `exitCode=1`; Warmup-Ereignisse liegen zwischen Modellstart und Antwortpruefung.
- evidence_paths: `PROJECT_STATUS.md` (Abschnitt 2026-10-22 INS-05 Abschluss/Warmup), `gui-protocol.Tests.ps1`;
  status: TEIL
- remaining_work: Voice-/TTS-Warmup als eigener Typ, Verhalten bei abgestuerztem Prozess ohne Ereignis,
  Lastfall Paketspam
### INS-05 Voice-Warmup und Lastfall (2026-10-22)
- goal: auch die Ladephase des Sprachdienstes sichtbar machen und den Ereignisleser unter Paketspam belegen.
- changed: `install-friday.ps1` (Schritt 14 meldet `warmup start/done` fuer `voice` mit Sekunden),
  `gui-protocol.Tests.ps1` (Lastfall 10 000 gemischte Zeilen, Voice-Warmup-Lage).
- observed: 2 500 Ereignisse und 7 500 Textzeilen korrekt getrennt, 0,68 s; Warmup-Ereignisse liegen zwischen
  Start und der `listening`-Pruefung.
- evidence_paths: `PROJECT_STATUS.md` (2026-10-22 INS-05 Teil 4), `ins-05-event-stream.md` 3; status: TEIL
- remaining_work: Reaktionsfaehigkeit der Oberflaeche unter Last (interaktiv), wsl-Zeitlimit
## Next (in the order of master §8.1)

1. **DASH-07.01/.02** — Hermes inventory (skills, accounts, sources, status) as the base for DASH-04.03 and
   the skill half of DASH-04.04.
2. **INS-02 .. INS-07** — installer follow-ups in the order of master §8.1.
3. **DASH-04.05** recovery drill once a single-area misconfiguration can be staged in the acceptance copy.
4. Parallel while read-only: the Studio comparison for DASH-14/KEEP-05.


### INS-09

- requirement_ids: INS-09; predecessor: INS-08
- base_revision: `5230dc4`; result_revision: working tree (commit follows)
- write_scope: `installer/` (voice, lib, tests, gui), `docs/agent-work/finalization/`
- implementation_paths: `installer/voice/gui_interaction.py`, `installer/voice/enroll_record.py`,
  `installer/lib/gui-interaction.ps1`, `installer/lib/voice-profile-backup.ps1`,
  `installer/install-friday-gui.ps1`, `installer/install-friday.ps1`
- test_command: `powershell -NoProfile -ExecutionPolicy Bypass -File installer/tests/gui-interaction.Tests.ps1`,
  `py -3.11 -m unittest discover -s installer/voice/tests -p 'test_gui_interaction.py'`,
  `... installer/tests/gui-wizard-pages.Tests.ps1`, `... installer/tests/voice-profile-backup.Tests.ps1`,
  alle `installer/tests/*.Tests.ps1`
- expected: Aufnahme ohne eigenes Fenster und ohne stdin; Seite mit Aufforderung/Fortschritt/Aktionen;
  Abbruch beantwortet die Anfrage; altes Profil vor der Aufnahme gesichert
- observed: 34 + 9 + 108 (Selbsttest `interaction=visible:True ok:True`) + 25 Zusicherungen PASS,
  Installer-Suite 32/32 Exit 0 in 188 s
- evidence_paths: `ins-09-voice-enrollment.md`; status: TEIL (echte Mikrofonaufnahme offen, N-037)
- remaining_work: Aufnahme mit Geraet und hoerbarem Start, erzeugte Modelle/Embeddings, Wake-Phrase gegen
  die Metadaten; danach INS-10


### INS-10

- requirement_ids: INS-10; predecessor: INS-05, INS-06, INS-09
- base_revision: `9198cdf`; result_revision: working tree (commit follows)
- write_scope: `installer/` (lib, tests, install-friday.ps1), `docs/agent-work/finalization/`
- implementation_paths: `installer/lib/wait-http.ps1`, `installer/lib/wsl-keepalive.ps1`,
  `installer/lib/download-integrity.ps1`, `installer/lib/wsl-path.ps1`, `installer/install-friday.ps1`
- test_command: `powershell -NoProfile -ExecutionPolicy Bypass -File installer/tests/installer-regressions.Tests.ps1`,
  `... installer/tests/wsl-timeout.Tests.ps1`, `... installer/tests/warmup-cancel.Tests.ps1`, alle
  `installer/tests/*.Tests.ps1`
- expected: jede Regression einzeln nachweisbar; fremde WSL-Konfiguration, Ports und Aufgaben unveraendert;
  Download und Dienstbereitschaft getrennt diagnostizierbar
- observed: 60 Zusicherungen PASS (echter HTTP-Server, echter `cmd /c where`-Kindprozess, Pruefsummen,
  Zeitfenster), Gegenprobe 503 -> Exit 1 und byte-identisch wiederhergestellt, Installer-Suite 33/33 in 453 s,
  laufende Control API antwortet `ready`
- evidence_paths: `ins-10-installer-regressions.md`; status: PASS
- remaining_work: reale Beobachtung der Fenster unter Last gehoert zu INS-13; echter haengender Download
  bleibt bei INS-07

### INS-11

- requirement_ids: INS-11; predecessor: INS-06, INS-10
- base_revision: `279cd12`; result_revision: working tree (commit follows)
- write_scope: `installer/` (lib, tests, install-friday.ps1), `packages/config`, `apps/control-api` (Standard und
  zwei Tests), `config/dashboard.example.yaml`, `docs/agent-work/finalization/`
- implementation_paths: `installer/lib/dashboard-sync.ps1`, `installer/lib/dashboard-backup.ps1`,
  `installer/install-friday.ps1`, `packages/config/src/schemas/dashboard.schema.json`,
  `apps/control-api/src/services/settings.ts`
- test_command: `powershell -NoProfile -ExecutionPolicy Bypass -File installer/tests/dashboard-sync-backup.Tests.ps1`,
  `node node_modules/vitest/vitest.mjs run --project node content-studio`, `... packages/config/src/config.test.ts`,
  `... --project node settings`, `... --project web navModel ContentStudioPage`,
  `node packages/contracts/scripts/check.mjs`, alle `installer/tests/*.Tests.ps1`
- expected: Creator Studio kommt aus dem kanonischen Stand an, ist im frischen Ziel sichtbar, FFmpeg laeuft, die
  Sicherung vor einem Update ist mit Manifest und Datenbank pruefbar
- observed: 72 Zusicherungen PASS (realer robocopy-Lauf, echte SQLite-Datei ueber `node:sqlite` gesichert,
  ueberschrieben, wiederhergestellt und wieder gelesen), content-studio 18 Tests, config 48, settings 72,
  web 5, contracts:check bestanden, `tsc --noEmit` fuer control-api/config/web/contracts je 0,
  Installer-Suite 34/34 Exit 0 in 477 s, FFmpeg real `ffmpeg version ...`
- evidence_paths: `ins-11-dashboard-creator-studio.md`; status: TEIL
- remaining_work: physischer Lauf in einen frischen Zielordner mit Browser (Menue, Route, Plan nach
  Dienstneustart, Produktion mit synthetischen Medien) gehoert zu INS-13/REL-03; Wiederherstellung im laufenden
  Betrieb als Betriebsprobe -> REL

### INS-12

- requirement_ids: INS-12; predecessor: INS-03..INS-11
- base_revision: `0d9ae58`; result_revision: working tree (commit follows)
- write_scope: `installer/` (lib, tests, Starter, ANLEITUNG), `Friday installieren.vbs`, `README.md`,
  `docs/agent-work/finalization/`
- implementation_paths: `installer/lib/elevation.ps1`, `installer/install-friday-gui.ps1`,
  `installer/install-friday.ps1`, `installer/install-friday-gui.bat`, `installer/install-friday-gui.vbs`,
  `Friday installieren.vbs`
- test_command: `powershell -NoProfile -ExecutionPolicy Bypass -File installer/tests/launcher.Tests.ps1`,
  `... gui-installer.Tests.ps1`, `... gui-wizard-pages.Tests.ps1`, alle `installer/tests/*.Tests.ps1`
- expected: Doppelklick startet die Oberflaeche, der CLI-Modus ist dokumentiert, alle Parameter kommen an, ein Abbruch
  der Windows-Abfrage aendert nichts, Simulation nur im Testmodus
- observed: 49 Zusicherungen PASS (echter cmd- und cscript-Lauf, echter Win32-Fehler 1223, Dateibaum mit SHA-256
  vorher/nachher gleich), gui-installer PASS, gui-wizard-pages 108 Zusicherungen PASS, Installer-Suite 35/35 Exit 0
  in 457 s
- evidence_paths: `ins-12-launcher.md`; status: TEIL
- remaining_work: echter Abbruch des UAC-Dialogs per Klick und Start aus dem entpackten ZIP auf sauberem Windows
  gehoeren zu INS-13

### DASH-10.02 (2026-10-23)

- requirement_ids: DASH-10.02; predecessor: DASH-07.01/.02 (Inventar), DASH-02/04 (Skillkonten)
- base_revision: `2356c5e`; result_revision: working tree (Commit folgt)
- implementation_paths: `installer/wsl/hermes_config_bridge.py` (`skills-list`, `parse_skills_list`),
  `installer/wsl/tests/test_skills_list.py` (neu), `packages/contracts/schemas/skills/skill.schema.json`
  (`origin`, `trust`), Beispiel `packages/contracts/examples/skills/catalog-response.json`,
  `apps/control-api/src/services/{hermes-config,skills}.ts`, `apps/control-api/src/runtime/create-runtime.ts`,
  `apps/web/src/features/skills/{SkillsPage.tsx,skillPresentation.ts,SkillMarkdown.tsx}`,
  Tests `apps/control-api/test/{skills-onboarding,skills-inventory-route}.test.ts` und
  `apps/web/src/features/skills/{skillPresentation,SkillsPage,SkillMarkdown}.test.tsx`
- test_command: `python3 tests/test_skills_list.py` + `test_skill_markdown.py` (WSL Friday-Ubuntu),
  `vitest --project node skills-onboarding skills-inventory-route`,
  `vitest --project web skills`, volle Suite, `pnpm contracts:check`, `pnpm typecheck`, `pnpm lint`, `pnpm build`
- expected: Inventar aus der echten CLI mit Quelle/Trust/Kategorie/Status, getrennt angezeigt; Detail laedt
  Markdown erst bei Auswahl und rendert keinen HTML-Pfad; Suche + Quellen-/Herkunfts-/Kategorie-/Statusfilter;
  begrenzte Zeilenzahl mit Nachladen
- observed: `hermes skills list --source all` liefert 191 Skills (119 `local`, 72 `builtin`, 0 `hub`, alle
  `enabled`); Bridge-Parser akzeptiert nur das dokumentierte Fuenf-Spalten-Layout (9 Pruefungen, 6 Fehlformen
  abgelehnt, leere Kategorie bleibt leer); Vertrag erweitert (274 Operationen unveraendert) und Beispiel gueltig;
  Service zieht Herkunft/Trust ausschliesslich aus der CLI, nutzt CLI-Status nur als Fallback und laesst den
  Katalog bei unlesbarem Inventar intakt; UI zeigt Herkunft/Trust/Kategorie/Paket/Status/Quelle getrennt,
  filtert nach Herkunft und blaettert in 60er-Bloecken; volle Suite 291 Dateien / 3681 passed / 60 skipped,
  neue Routendatei einzeln gruen, contracts:check/typecheck/lint/build 0
- evidence_paths: `dash-10-02-skill-inventory.md`, `dash-10-02-skill-inventory.md` Abschnitt 4; status: TEIL
- remaining_work: echter Hub-Skill auf diesem Host (10.06), Version je Hermes-Skill fehlt in der CLI-Tabelle,
  `external` als eigene Quelle existiert in der CLI nicht, Trust-Verwaltung = DASH-10.03/10.04

### DASH-10.03 (2026-10-23)

- requirement_ids: DASH-10.03; predecessor: DASH-10.02
- base_revision: `4ddc977`; result_revision: working tree (Commit folgt)
- implementation_paths: keine Produktpfad-Aenderung noetig; Bestand
  `apps/control-api/src/services/skills.ts` (`toggle`), Nachweis ergaenzt in
  `apps/control-api/test/skills-onboarding.test.ts`, Analyse in
  `docs/agent-work/finalization/dash-10-03-skill-enable.md`
- test_command: `python3` entfaellt; Quellanalyse `sed`/`grep` im Hermes-Checkout, `hermes profile create/delete`,
  `hermes config get/set`, `hermes skills list [--enabled-only]`, `vitest --project node skills-onboarding`
- expected: der echte per-Skill-Schalter ist belegt, `opt-in/opt-out` nicht dafuer gehalten, keine Datei-/DB-Tricks,
  und Friday meldet keinen Erfolg ohne Readback
- observed: Schalter = `skills.disabled` (Menge der deaktivierten Namen), geschrieben von
  `save_disabled_skills` ueber `PUT /api/skills/toggle`; `GET /api/skills` berechnet `enabled` daraus und liefert
  `provenance` (hub > bundled > external > agent); `hermes skills config` ist TUI-only. Readbackprobe im
  wegwerfbaren Profil `friday-probe`: 72 aktivierte Skills -> `skills.disabled=["arxiv"]` -> 71 und Zeile
  `arxiv … builtin builtin disabled` -> Ruecknahme auf `[]` -> 72; Profil und Wrapper geloescht, Default-Profil
  unveraendert (`skills.disabled` nicht gesetzt, 191/191). Neuer Test: Toggle ohne Zustandsaenderung wird als
  "nicht bestaetigt" abgelehnt (21 Tests gruen)
- evidence_paths: `dash-10-03-skill-enable.md`; status: PASS
- remaining_work: Bedienung im Gesamtablauf = DASH-10.06; `origin` aus `provenance` speisen (external/hub) als
  naechste Verbesserung

### DASH-10.04 (2026-10-23)

- requirement_ids: DASH-10.04; predecessor: DASH-10.03
- base_revision: `918cd7d`; result_revision: `8fa986d` (Code), Doku folgt
- implementation_paths: `installer/wsl/hermes_config_bridge.py` (`hub-search`, `modified-list`,
  `parse_hub_search`, `parse_modified_skills`), `installer/wsl/tests/test_hub_search.py` (neu),
  `packages/contracts/schemas/skills/{hub-search,modified-skills}*.schema.json` (neu),
  `packages/contracts/openapi/friday-api.yaml`, `apps/control-api/src/services/hermes-config.ts`,
  `apps/control-api/src/handlers/skills.ts`, `apps/control-api/test/skills-hub-route.test.ts` (neu)
- test_command: `python3 tests/test_hub_search.py` (WSL), `vitest --project node skills-hub-route`,
  `vitest --project node contract.test api.test openapi-additions`, `pnpm contracts:check`, `pnpm typecheck`,
  `pnpm lint`, `pnpm build`
- expected: nur Operationen mit maschinenlesbarer Ausgabe typisiert abbilden, Rich-Tabellen nicht parsen,
  Faehigkeiten je CLI-Version belegen
- observed: Matrix beider installierter Staende (v0.20.5 Windows, v0.22.2 FRIDAY-2) zeigt `--json` nur bei
  `search` und `list-modified`; alles andere ist Tabelle oder Mutation. Umgesetzt: Hub-Suche und Liste lokal
  geaenderter Skills mit strengen Parsern, Eingabepruefung vor dem CLI-Aufruf, ADAPTER_UNAVAILABLE bei Format-
  oder Zeitfehler; 276 Operationen. 9 Python-Pruefungen, 3 Routentests mit Schema-Validierung, Vertragswaechter
  nachgezogen, Gates 0. Live: `search hermes --json --limit 2` lieferte echte Treffer, `list-modified --json` = `[]`
- evidence_paths: `dash-10-04-skill-operations.md`; status: TEIL (Textoperationen und Mutationen offen)
- nachtrag: ein **vorbestehender** roter Test (`messenger-inbound-routes`, 503 "Event ID conflict" beim zweiten
  identischen Empfang) ist reproduzierbar auch auf `2356c5e` und mit geleertem Arbeitsbaum; als **N-051** im
  Ledger offen, nicht durch diesen Block verursacht
- remaining_work: Textdarstellung fuer `inspect/browse/check/audit/diff/tap list`, Mutationen, nicht erreichbares
  `external_dirs`

### DASH-10.05 (2026-10-23)

- requirement_ids: DASH-10.05; predecessor: DASH-10.04
- base_revision: `faf3588`; result_revision: working tree (Commit folgt)
- implementation_paths: `apps/web/src/features/skills/SkillRegistryPanel.tsx` (neu),
  `apps/web/src/lib/api/domains/skills.ts` (`useSkillHubSearch`, `useModifiedSkills`),
  `apps/web/src/features/skills/SkillsPage.tsx` (Panel gemountet), `skills.css`,
  `apps/web/src/features/skills/SkillRegistryPanel.test.tsx` (neu)
- test_command: `vitest --project web SkillRegistryPanel SkillsPage`, volle web-Suite, `pnpm typecheck`, `pnpm lint`
- expected: vor einer Installation Quelle und Trust je Treffer zeigen, lokal geaenderte Skills benennen,
  keinen Installationsknopf anbieten, den Grund nennen
- observed: Registry-Suche mit Name/Quelle/Trust/Kennung/Beschreibung aus der typisierten Operation, ehrliche
  Leer- und Fehlermeldung, Liste lokal geaenderter Skills mit Warnung (Updates ueberspringen sie), statischer
  Hinweis auf den fehlenden Bestaetigungs-/Recovery-Weg; 3 neue UI-Tests, SkillsPage 4 gruen, web 88/685
- evidence_paths: `dash-10-05-skill-registry-ui.md`; status: TEIL (Voraussetzungen/Auditbefund je Treffer,
  Diff/Konflikt, Installation und gefuehrte Kontowiederverwendung offen)
- remaining_work: `inspect`/`audit` liefern kein JSON (nur Text oder Verzicht), `diff` als Text anzeigen,
  Installation/Aktualisierung = DASH-10.07

### DASH-10.04 Nachtrag (2026-10-23): inspect/audit/diff als Text

- base_revision: `87a2faa`; result_revision: working tree (Commit folgt)
- implementation_paths: `installer/wsl/hermes_config_bridge.py` (`skill-report`, `parse_skill_report`,
  `SKILL_REPORT_LIMIT`), `installer/wsl/tests/test_skill_report.py` (neu),
  `packages/contracts/schemas/skills/skill-report{,-response}.schema.json` (neu),
  `packages/contracts/openapi/friday-api.yaml`, `apps/control-api/src/services/hermes-config.ts` (`skillReport`),
  `apps/control-api/src/handlers/skills.ts` (drei Handler), `apps/control-api/test/skills-report-route.test.ts` (neu)
- test_command: `python3 tests/test_skill_report.py` (WSL), `vitest --project node skills-report-route`,
  `vitest --project node contract.test openapi-additions api.test`, volle node-Suite, Gates
- expected: die drei Berichte unveraendert ausliefern, nichts parsen, leere Berichte als Fehler behandeln
- observed: 279 Operationen, Text auf 65536 Zeichen gekuerzt mit `truncated` und Bytezahl, Leerbericht ->
  `ADAPTER_UNAVAILABLE`, Zeitlimit 60 s; 9 Python-Pruefungen, 4 Routentests, Waechter nachgezogen, Gates 0
- evidence_paths: `dash-10-04-skill-operations.md` (Abschnitt 8); status: TEIL (Mutationen und das Verhalten bei
  nicht erreichbarem `external_dirs` bleiben offen)
- nebenfund: Router prueft Pfadparameter nur auf Laenge, nicht auf das Vertragsmuster -> Ledger N-052

### DASH-10.06 (2026-10-23): Abnahme im wegwerfbaren Profil

- base_revision: `0703ce2`; result_revision: working tree (Commit folgt)
- umgebung: Windows-CLI v0.20.5 (Operator-Profil unveraendert) und WSL v0.22.2; Hub-Fall in `friday-accept`
- ablauf: Profil erzeugt -> `skills search skill-creator --json` -> `skills install ... --yes`
  (Quarantaene + Scan, Verdict CAUTION, `ALLOWED` fuer trusted source, 3 Dateien) -> Readback in neuem Prozess
  (`enabled`) -> lokale Zeile an `SKILL.md` -> `skills update` ueberspringt mit Begruendung -> `--force`
  ueberschreibt bewusst -> Profil und Wrapper entfernt, `hermes profile list` zeigt nur `default`
- observed: Ansehen/Verwalten/Readback fuer alle drei Herkuenfte belegt; modifizierter Skill wird nicht still
  ueberschrieben
- grenzen: `skills diff` nur fuer getrackte Skills (N-054), `list-modified` fuehrt keine Hub-Aenderungen (N-055),
  `inspect` loest weiter gegen die Registries auf und ist bei Namenskollision mehrdeutig (N-053), fehlendes
  externes Laufwerk nicht geprueft
- evidence_paths: `dash-10-06-acceptance.md`; status: TEIL

### DASH-10.07 (2026-10-23): wiederherstellbarer Schnappschuss statt Transaktion

- base_revision: `f63eac1`; result_revision: `67d5661`
- implementation_paths: `installer/wsl/hermes_config_bridge.py` (`skill-mutate`, `snapshot_skill`, `restore_skill`,
  `skill_directories`), `installer/wsl/tests/test_skill_mutate.py` (neu),
  `packages/contracts/schemas/skills/skill-mutation{,-request,-response}.schema.json` (neu),
  `packages/contracts/openapi/friday-api.yaml`, `apps/control-api/src/services/hermes-config.ts` (`mutateSkill`),
  `apps/control-api/src/handlers/skills.ts`, `apps/control-api/test/skills-mutation-route.test.ts` (neu)
- test_command: `python3 tests/test_skill_mutate.py` (WSL), `vitest --project node skills-mutation-route`,
  Vertragswaechter, volle node-Suite, Gates
- expected: keine Mutation ohne Pruefung, Schnappschuss vor dem CLI-Lauf, alter Zustand bei jedem Fehler
- observed: 280 Operationen; Erfolg meldet `installed`/`enabled`/`snapshot` aus einem erneuten Lesevorgang; Fehler
  spielt den Schnappschuss zurueck und meldet `restored`/`previousPresent`; 15 + 4 neue Tests gruen, Suite
  200/2829 gruen, Gates 0
- evidence_paths: `dash-10-07-skill-mutation.md`; status: TEIL (echter CLI-Lauf und der Nachweis „keine geteilten
  Accounts angetastet" fehlen)
- nebenfund: vitest-Default von 5 s reichte fuer die Routen-Sweeps unter zwei Workern nicht (Ledger **N-056**,
  behoben durch `testTimeout`/`hookTimeout` 20 s)

| DASH-10.07 Recovery | **PASS** (Bridge kopiert das Skill-Verzeichnis vor jeder Mutation in `~/.hermes/friday-snapshots`, liest den Zustand nach dem CLI-Lauf erneut und spielt den Schnappschuss bei jedem Fehler zurueck; `POST /api/v1/skills/{name}/mutations` mit Audit, 280 Operationen; live im wegwerfbaren Profil belegt: Install mit Quarantaene/Scan, Update, Uninstall mit Schnappschuss-Payload, `.env`-Hash unveraendert; fehlgeschlagene Aktivierung meldet den alten Zustand als 409 mit `observed`) | `dash-10-07-skill-mutation.md`, `test_skill_mutate.py` (15), `skills-mutation-route.test.ts` (4) |
### DASH-10.04 Nachtrag (2026-10-23): fehlende Skill-Wurzel

- base_revision: `aac703c`; result_revision: `e1729b6`
- implementation_paths: `installer/wsl/hermes_config_bridge.py` (`installed_skills(..., report_missing=True)`),
  `installer/wsl/tests/test_skill_roots.py` (neu)
- expected: ein konfiguriertes, aber fehlendes `external_dirs` wird gemeldet statt still uebersprungen
- observed: `skill_root_missing` in `inventory.reasons`, `skillsComplete: false`, gesunde Wurzeln liefern weiter;
  12 Pruefungen gruen, `typecheck` und die 38 Hermes-Konfigurationstests unveraendert gruen
- evidence_paths: `dash-10-04-skill-operations.md` Abschnitt 8.2; status: TEIL (die Skills selbst bleiben
  natuerlich unsichtbar, solange das Laufwerk fehlt)

## Open risks / notes for the next session

- The running installation must not be rebuilt or restarted from this branch without a rollback plan
  (`D:\Dokumente\F.R.I.D.A.Y` belongs to the operator).
- `dataMode: live` already exists and creates **no** adapters for unconfigured categories
  (`adapter-wiring.ts:241`); the fix direction is therefore to make the delivered configuration honest instead
  of inventing a fourth mode.
- Windows PATH quirk still applies: `$env:Path = $env:Path.Replace('"','')` before every `pnpm` command.
- The 13 `FIXED_PROVEN_CODE` rows prove source presence only, never runtime behaviour.

### DASH-10.04 Nachtrag (2026-10-23): browse, check und tap list als Text
- requirement_ids: DASH-10.04; predecessor: DASH-10.03
- evidence_paths: `dash-10-04-skill-operations.md` Abschnitt 8.2; `test_skill_command.py` (12 Pruefungen);
  `skills-command-route.test.ts` (3 Tests); status: TEIL (typisiert sind jetzt acht der vierzehn Befehle; offen
  bleiben `trust`/`untrust`/`reset`/`tap add|remove`/`config`)
- live: `tap-list` "No custom taps configured. Using default sources only.", `check` "No hub-installed skills to
  check.", `browse` 200 Skills aus skills-sh in 65 s; `tap-list` brauchte mehr als die alten 30 s, Budget jetzt 90 s
- verifiziert: 281 Operationen, node-Suite und Gates gruen

### DASH-10.04 Abschluss (2026-10-23): Governance und Nicht-Exponierung
- requirement_ids: DASH-10.04; predecessor: DASH-10.03
- evidence_paths: `dash-10-04-skill-operations.md` Abschnitt 8.3; `test_skill_governance.py` (16 Pruefungen);
  `skills-governance-route.test.ts` (3 Tests); status: **PASS** (13 von 14 Befehlen typisiert, `config` als
  nicht headless belegt, `reset --restore` gehoert zum Schnappschusspfad aus DASH-10.07)
- live: trust/untrust, tap add/remove, unbekannter Tap (rc 6), Verzeichnis ohne Projektskills (rc 6) im
  wegwerfbaren Profil `friday-gov`
- verifiziert: 282 Operationen, node-Suite 202 Dateien / 2836 Tests, Gates 0

### DASH-10.05 Abschluss (2026-10-23): Trefferbefunde und Diff
- requirement_ids: DASH-10.05; predecessor: DASH-10.04
- evidence_paths: `dash-10-05-skill-registry-ui.md` Abschnitte 7 und 8; status: **PASS** fuer alles, was die
  Registry-Flaeche selbst leistet; der gefuehrte Wiederverwendungsschritt bleibt bei DASH-07/08, weil er Konto- und
  Referenzdaten braucht, die es hier nicht gibt
- live: `inspect` mit Kennung (rc 0, `Source: official`) und mit blossem Namen (rc 0, `Resolved to: ...`)
- verifiziert: node 203 Dateien / 2839 Tests, web 88 / 689, Gates 0

### DASH-10.06 (2026-10-23): API-Laufzeitnachweis der Skill-Verwaltung

- requirement_ids: DASH-10.06; predecessor: DASH-10.05
- umgebung: echte Control API (`apps/control-api/dist/main.js`), `dataMode: live`, eigenes Datenwurzelverzeichnis mit
  `config/install-state.json` (`FRIDAY-2`/`ubuntu`) und Brueckenkopie; Sitzung als `owner` ueber die Ersteinrichtung
- ablauf: `GET /skills` (67,3 s, 159 Skills, 53 builtin / 106 external, `observationSource: hermes-cli`) ->
  `GET /skills/modified` -> `GET /skills/arxiv/diff` -> `GET /skills/<kennung>/inspect` (2,3 s) ->
  `GET /skills/arxiv/inspect` (110,6 s, Namensauflösung gegen die Registries) ->
  `GET /skills/reports?command=tap-list` -> `command=config` (400) -> ohne Sitzung (401)
- observed: Inventar, Berichte und Ablehnungstexte kommen unveraendert aus der CLI; eine nicht angebotene Operation
  wird als Schemafehler abgewiesen statt still zu wirken
- fixed nebenbei: Origin-Vokabular `external` (N-064), Runner-Limit 35 s (N-065), Inventar-Budget (N-066),
  CLI-Budget der Bruecke (N-067), BOM auf stdin (N-068), Fehlertexte ohne Grund (N-069), zwei Budgets ohne Ordnung (N-070)
- grenzen: kein Hub-Skill auf diesem Profil installiert; Neustart-Gleichheit und fehlendes Laufwerk noch nicht live
  erhoben; `FRIDAY_SKILLS_CATALOG_PATH`/Dashboard-URL sind am Operator-System nicht gesetzt (`catalogError`), deshalb
  ist nur die CLI-Katalogseite, nicht die gepackte Katalogseite belegt
- evidence_paths: `dash-10-06-skill-verwaltung-live.md`, `scripts/finalization/live-skills-proof.mjs`,
  `docs/agent-work/finalization/issue-ledger.csv` (N-064..N-070); status: TEIL

### DASH-14.04 Veroeffentlichung und Status trennen (2026-10-23)
- goal: manuelle Planung darf keine bestaetigte externe Veroeffentlichung behaupten; fehlender Publisher bleibt offene
  Implementierung statt erfolgreichem Knopf.
- changed: `plan-document.schema.json` (+ generierte Typen), `packages/generated-sdk/src/content-plan.ts`
  (Publication-Typ und Parserregel), `ContentStudioPage.tsx` (ein gemeinsamer Statuspfad schreibt die Herkunft),
  `PostingCalendar.tsx` (Beschriftung "Manuell markiert"), `settings-content-actions.ts` (Textbefehl schreibt die
  Herkunft), Tests in web und node.
- observed: live 422 ohne Herkunft, 422 bei art=bestaetigt/quelle=manuell, 200 bei manueller Markierung, Readback mit
  art=manuell; web content-studio 11/11, node content 61/61, contracts:check/typecheck/lint/build gruen.
- evidence_paths: `dash-14-04-veroeffentlichung.md`, `scripts/finalization/live-studio-publication-proof.mjs`.
- status: PASS

### DASH-14.03 Studio standardmaessig ausliefern (2026-10-23)
- goal: Studio ohne manuellen Checkout bauen und im Menue zeigen, bestehende Navigationspraeferenzen achten, ohne
  Zugang ehrlich bleiben statt Mockproduktion.
- changed: `navModel.test.tsx` (drei Tests fuer Reihenfolge-Anhang, versteckte Seiten, Feature-Schalter),
  `scripts/finalization/live-studio-access-proof.mjs`.
- observed: Build enthaelt `content-studio.html` (11 915 B); live `contentStudioEnabled: true`; ohne Schluessel
  503 "kie ist nicht konfiguriert." und "elevenlabs ist nicht konfiguriert."; unbekannter Auftrag 404; Providerkette
  inkl. Artefakt-Download und Idempotenz durch 7 Produktionstests belegt; kein bezahlter Testlauf.
- evidence_paths: `dash-14-03-studio-standard.md`, `navModel.test.tsx`, `content-studio-production.test.ts`.
- status: PASS

### DASH-14.05/14.06 Studio-Abnahme und Recovery (2026-10-23)
- goal: neue Zielinstallation ohne manuellen Checkout, Plan/Medienjobs ueber Neustart, ruecksetzbare Integration,
  unklarer Produktionsausgang ohne Doppelung.
- changed: `apps/control-api/test/content-studio-restart.test.ts` (zwei API-Laeufe auf demselben Datenwurzelverzeichnis),
  `scripts/finalization/live-studio-restart-proof.mjs`.
- observed: Neustart-Test gruen (Plan-Revision 1, genau eine Auftragszeile `completed`, Artefakt-Bytes identisch); live
  Plan-Revision 3 nach Prozessneustart identisch, Auftrag ohne Schluessel 503 ohne Phantomzeile; Studio aus -> 403,
  wieder an -> dieselbe Revision; Idempotenz/`provider_unknown` verhindern Doppelauftraege; Installer baut `build:app`.
- evidence_paths: `dash-14-05-14-06-studio-abnahme.md`, `content-studio-restart.test.ts`,
  `live-studio-restart-proof.mjs`.
- status: PASS (14.05 und 14.06)

### DASH-14.02/14.01 Funktionsmatrix und Integrationsflaeche (2026-10-23)
- goal: Studio-Worktree gegen Completion vergleichen, nur tatsaechlich fehlende Verbesserungen uebernehmen, keinen
  aelteren Stand ueber juengeren Code mergen.
- observed: neun Funktionsflaechen verglichen (Ideen/Plan, Postingkalender, Medienwerkstatt, Produktionsworkspace,
  Provider/Keys, Onboarding, Skills, Persistenz, Betrieb/Build); Completion ist in jeder Flaeche Obermenge, kein
  Schlüsselwort kommt nur im Studio vor, kein Merge noetig. Route, Module, Services, Vertraege und Build liegen im
  Completion-Baum (14.01).
- evidence_paths: `dash-14-02-studio-matrix.md`, Dateilisten in beiden Baeumen.
- status: PASS (14.02 und 14.01)

### DASH-15.02/15.05 Domain-Agenten als echte Profile (2026-10-23)
- goal: sieben stabile Domain-Profile als echte Workerrollen statt sieben Karten; ein ungueltiges Profil darf nur
  sich selbst deaktivieren.
- changed: sieben Hermes-Profile (`tasks`, `communication`, `calendar`, `automations`, `research`, `alerts`, `audit`)
  mit `config.yaml` (Modellroute, Turns, Timeout, Tool-Call-Grenze) und `SOUL.md` (Rolle, erlaubte/verbotene
  Domaenen, Datenzugriff, Eskalation, Ergebnisformat); Skript `scripts/finalization/live-agent-profiles-proof.mjs`.
- observed: `hermes profile list` zeigt alle sieben mit Modell `k3`; `hermes profile show` liest Modell und SOUL.md.
  Mit absichtlich zerstoertem `alerts/config.yaml` meldet Hermes "Skipping broken secondary profile", zeigt `alerts`
  ohne Modell und laesst die uebrigen sechs unberuehrt; nach Wiederherstellung ist `alerts` wieder gesund. Ohne
  Hermes-API-Server antwortet `/api/v1/agents` mit 403 CAPABILITY_MISSING statt erfundener Agenten.
- evidence_paths: `dash-15-domain-agenten.md`.
- status: 15.05 PASS, 15.02 TEIL (Skill-Allowlist je Domaene, explizites Arbeitsverzeichnis offen)

### DASH-15.02 vollstaendig (2026-10-23)
- changed: domaenenspezifische Skill-Sets je Profil als Symlinks in den gemeinsamen Friday-Skillbaum (tasks 26,
  communication 12, calendar 19, automations 17, research 22, alerts 10, audit 16 Skills) und explizites
  `terminal.cwd` auf das jeweilige Profil-`workspace/`.
- observed: `hermes profile show calendar` meldet `Skills: 19`; `hermes --profile tasks config get terminal` liest
  `cwd: /home/ubuntu/.hermes/profiles/tasks/workspace`. Keine Kopien, eine Quelle.
- evidence_paths: `dash-15-domain-agenten.md`.
- status: PASS (15.02)

### DASH-15.01 Integrationsflaeche (2026-10-23)
- goal: Agenten-Integrationsflaeche (Adapter, Mapping, Clients, UI, Job-/Taskservices) belegen statt behaupten.
- observed: alle genannten Dateien vorhanden; `adapters/hermes/test/agents.test.ts` 12 Tests, `features/agents` 15
  Tests bestanden (Statusableitung, Offline bei gestopptem Gateway, Betrieb ohne API-Key, Paging/Versionen,
  run-scoped Stop, Status-/Heartbeat-Events).
- evidence_paths: `dash-15-01-agenten-integrationsflaeche.md`.
- status: PASS

### DASH-17 Voruntersuchung (2026-10-23)
- observed: Automations-Port im Vertrag vollstaendig; kein Live-Adapter (`adapters/` ohne automations), `mock-automations`
  nur in Mock-Welt, Beispielkonfiguration und Vertragsbeispielen. Reale Quelle waere `hermes cron` (list/create/edit/
  pause/resume/run/runs/incidents/tick), aber `cron list`/`cron runs` haben keinen JSON-Modus - Adapter braucht erst
  eine belastbare Datenquelle statt Textparsing.
- evidence_paths: `dash-17-status.md`.
- status: offen (17.01-17.05), Audit-Seite von 17.03 durch 23 Audit-Tests belegt

### DASH-18.06 Intentaufloesung fragt nach (2026-10-23)
- goal: fehlerhafte Intentaufloesung darf nachfragen, aber keine Kontakte/Konten/Termine raten und keine versteckte
  zweite Sprachaktion ausloesen.
- observed: zwoelf Negativsaetze im Kalender-Intent ergeben `null` (auch "Loesche den Termin das" und "Verschieb den
  Termin auf irgendwann"); `validRef()` lehnt Pronomen/Artikel ab; Sprachbestaetigung ist zweistufig mit Token an
  Anfrage + `targetId` + `version` gebunden und antwortet bei geaendertem Ziel mit 409 "Bitte erneut vorlesen lassen";
  Voice-Mail verlangt ein praezises vorhandenes Ziel, sendet einmal und blockt Tampering.
- tests: voice-calendar 2, voice-mail 2, calendar-action-intent 28, mail-action-intent 19 (51), messenger-action-intent
  + read-command-intents 26.
- evidence_paths: `dash-18-06-intent-recovery.md`.
- status: PASS

### DASH-18.02 Pflichtmatrix erzeugt (2026-10-23)
- goal: Pflichtmatrix fuer alle Bereiche aus §9 aus dem Repository belegen statt aus Erinnerung.
- changed: `scripts/finalization/build-area-matrix.mjs` erzeugt `dash-18-02-matrix.md` aus NAV_PAGES,
  `route-table.generated.ts`, `database.ts`, `port-spec.ts` und den Testdateien.
- observed: 18 Seiten, 20 Bereiche, 244 API-Pfade, 282 Operationen, 33 Tabellen, 15 Ports, 67 Scopes,
  83 Web-/117 Node-/8 Adapter-Tests; Onboarding ist eine App-Route, Standort/Wetter liegt in den Einstellungen.
  Die Datei benennt ausdruecklich, was sie NICHT belegt (Runtime, Rolle, Fehlerpfad, Sprachaktion pro Funktion = 18.03).
- evidence_paths: `dash-18-02-matrix.md`, `scripts/finalization/build-area-matrix.mjs`.
- status: PASS (18.02)

### KEEP-05 Studio-Paritaet geprueft (2026-10-23) - TEIL
- observed: 11 von 12 Anforderungen belegt (Werkzeuguebersichten, Formate, Workflow, Ordnerhinweise, Kanban,
  Wochenplan, Postingformular, Plan mit Revision via If-Match, Migration nur bei echten Browserdaten, Produktionsjob
  Vorschau/Start/Status/Cancel, kie/ElevenLabs/FFmpeg, Socialziele). Ausgefuehrt: 11 Web- + 19 Node-Tests.
- gap: Skill-Bridge fehlt nachweislich - weder `handlers/skills.ts` noch `handlers/commands.ts` enthalten einen
  Studio-Bezug, es gibt keinen Studio-Skill-Bridge-Service. Nur der Voice-Teil (ElevenLabs-Sprachroute) existiert.
- evidence_paths: `keep-05-studio-paritaet.md`.
- status: TEIL (kein Haekchen)

### KEEP-05 abgeschlossen (2026-10-23) - PASS
- changed: Skill-Bridge contract-first eingefuehrt (Schema `skill-production-request`, Pfad
  `POST /api/v1/content-studio/skill-production-jobs`, operationId `createSkillContentProductionJob`,
  `x-capability: meta.read`, `x-required-role: owner`); Handler `createSkillContentProductionJob` delegiert an den
  bestehenden Produktionsservice, Idempotenzschluessel pro Skill namensraeumig, Audit
  `content_studio.skill_production_started` mit `jobId`/`ideaId`/`skillId`.
- tests: neue `content-studio-skill-bridge.test.ts` 5 Tests (Idempotenz/Replay, 409 stale revision, 404 unknown idea,
  422 malformed skillId, 401 ohne Sitzung, 422 ohne Bestaetigung, Audit-Eintrag durabel). Zusaetzlich 19 Node-Studio-,
  11 Web-Studio-Tests, 381 Contract-/Auth-/OpenAPI-Tests, `pnpm contracts:check`, `typecheck`, `lint`,
  `test:conformance` (415) bestanden.
- contract: Operationszahl bewusst 282 -> 283 (`openapi-additions.test.ts`, `contract.test.ts`), Mock-Plattform
  fuehrt die Route als live-only.
- evidence_paths: `keep-05-studio-paritaet.md`.
- status: PASS

### DASH-17.02 Hermes-Cron-API verifiziert (2026-10-23)
- goal: belastbare Datenquelle fuer den Automations-Adapter statt CLI-Textparsing.
- observed: auf FRIDAY-2 laeuft der Hermes-Dashboard-Dienst (PID 427, 127.0.0.1:43791); `/api/health` 200,
  `/api/cron/jobs?profile=all` 401 ohne Credential. Endpunkte: Liste/Detail/Runs/Create/Update/Pause/Resume/Trigger/
  Delete/Delivery-Targets; Payload `CronJobCreate` mit schedule/deliver/repeat/skills/workdir/no_agent.
- blocked: produktiver Adapter braucht ein Web-Credential (401); Laufzeitabnahme 17.04 bleibt damit offen.
- evidence_paths: `dash-17-02-hermes-cron-api.md`, `dash-17-status.md` (korrigiert).
- status: Befund dokumentiert, DASH-17.02 weiterhin offen

### DASH-17.02 Datenquelle erprobt: Hermes-Cron-API mit Dashboard-Token (2026-10-23)
- observed: `GET /` liefert `__HERMES_SESSION_TOKEN__`; `X-Hermes-Session-Token` macht `/api/cron/jobs` von 401 zu 200.
  Adapterbasis kann das schon (`scrapedTokenCredential`, `dashboardAuth: "scrape"`).
- lifecycle (live, `no_agent`-Skriptjob, danach geloescht): create 200 (`state:"paused"`, "awaiting operator approval"),
  get 200, trigger 200 (`last_status:"ok"`, `repeat.completed:1`, `next_run_at` gesetzt), runs 200 (ein Lauf,
  preview `friday-probe-ok`), pause 200, resume 200, delete 200 `{"ok":true}`, danach Liste `[]`.
- decision: Automations-Adapter geht gegen die Dashboard-HTTP-API (kein CLI-Parsing, kein state.db-Zugriff).
- evidence_paths: `dash-17-02-hermes-cron-api.md` (Abschnitte 4-6).
- status: Befund + Datenquelle belegt; Adapterimplementierung und Abnahme 17.04 offen

### DASH-17.02 abgeschlossen (2026-10-23) - PASS
- changed: `CronApi` + `HermesAutomationsAdapter` (AutomationPort) auf der Hermes-Cron-Dashboard-API; vierte Kategorie
  `automations` in Manifest und Factory `hermes-automations`; Allowlist in beiden Beispielkonfigurationen und im
  Installer; Cron-Endpunkte im Fake-Hermes (Jobs starten pausiert wie im Original).
- tests: neue `automations.test.ts` 7 Tests (Contract-valid via `validatePortResult`, Trigger/Aktionen/Paused, Filter,
  NOT_FOUND, Run-Historie nach Trigger, Anlegen+Resume nur bei enabled, Testlauf dryRun false, Pause/Resume,
  CONFLICT bei altem If-Match, leerer Zustand). `adapters/hermes` gesamt 200 bestanden; `real-adapters` 11 bestanden
  (automations -> hermes-automations). typecheck + lint gruen.
- contract: keine neuen Operationen (Port und Schemata existierten); Capabilities `automations.*` nur fuer belegte
  Vorgaenge, `versions` und `pauseAll` bewusst nicht angeboten.
- evidence_paths: `dash-17-02-automations-adapter.md`, `dash-17-02-hermes-cron-api.md`.
- status: PASS (Abnahme 17.04 weiter offen)

### DASH-17.04 abgeschlossen (2026-10-23) - PASS
- changed: neue Abnahme `apps/control-api/test/automations-live-hermes.test.ts` (2 Tests, selbst-ueberspringend ohne
  erreichbaren Hermes), Fake-Hook `state.cronStatus` fuer die 429-Abbildung, zusaetzlicher Unit-Test
  "maps a rate-limited upstream to RATE_LIMITED".
- runtime: echte Control-API im Modus live gegen Hermes 0.22.2 (127.0.0.1:43791); echte Skript-Automationen
  (`no_agent`), damit die Kette ohne Modellaufruf belegt ist: anlegen (nach Vorschau-Bestaetigung), ausloesen
  (dryRun false, succeeded), Laufhistorie (genau ein Lauf), deaktivieren, API-Neustart und Wiederfinden (paused true).
  Fehlerfall: Skript mit Exitcode 3 -> Lauf failed. DST-kritischer Ausdruck 30 2 * * * kommt byte-identisch zurueck.
  429 -> RATE_LIMITED im Fake. Aufraeumen: Hermes-Jobs danach entfernt, Liste leer.
- tests: live 2 bestanden, adapters/hermes 8 Automations-Tests, gesamt 214 bestanden / 4 uebersprungen (11 Dateien),
  typecheck + lint gruen.
- findings: Automations-Schreibzugriffe sind zweistufig (403 APPROVAL_REQUIRED mit previewId, dann
  `x-action-preview-id`); der Contract hat kein DELETE fuer Automationen (405) - deaktivieren ist der Produktweg;
  Hermes fuehrt Trigger synchron aus, Agentenjobs brauchen einen hoeheren Timeout als 10 s.
- evidence_paths: `dash-17-04-acceptance.md`, `dash-17-02-automations-adapter.md`.
- status: PASS

### DASH-17.05 abgeschlossen (2026-10-23) - PASS
- changed: `listAutomations` bildet pro Job ab und ueberspringt unlesbare Eintraege (Log mit ID/Grund); sind alle
  defekt, meldet der Adapter INTERNAL mit den IDs statt einer leeren Liste. `CronApi.trigger` laeuft mit `retry: false`
  (genau ein Versuch). Fake: `cronTriggerAttempts`, `cronTriggerDelayMs` (synchroner Sleep), `cronStatus` bereits aus
  17.04.
- tests: adapters/hermes/test/automations.test.ts 12 (neu: "skips an unreadable job...", "reports the defect instead of
  an empty list...", "reports an unknown trigger outcome once...", "restores the previous configuration by reapplying
  it"); live 3 (neu: "restores an earlier configuration over the real API" - Version nach Rueckschreiben identisch).
- runtime: live gegen Hermes 0.22.2; PATCH 10 5 * * * -> 20 6 * * * -> 10 5 * * * ergibt wieder die Ausgangsversion.
- gates: typecheck + lint 0 Fehler, adapters/hermes 205 bestanden / 4 uebersprungen.
- evidence_paths: `dash-17-05-recovery.md`.
- status: PASS

### DASH-17.03 abgeschlossen (2026-10-23) - PASS
- finding: die Audit-Lesewege (Liste, Detail, Export) wurden vom Audit-Adapter beantwortet - im Testbetrieb
  mock-audit mit 80 Fixtures, im Live-Betrieb gar kein Adapter. Der echte hashverkettete Verlauf war ueber die API
  nicht sichtbar.
- changed: `services/audit-trail.ts` (liest audit_log, Filter wie im Contract, neueste zuerst, Cursor s<offset>,
  Hash/prevHash aus den Spalten), `handlers/audit.ts` als Override fuer listAuditEvents/getAuditEvent/exportAudit,
  `services/audit-redaction.ts` (Secrets -> [redigiert], qr*/embedding/voiceprint entfernt), `shape()` exportiert,
  read-query-intent liest denselben Trail (Direktaufruf und Sprachbefehl liefern identische Eintraege).
- tests: neu `audit-governance.test.ts` (5: Redaktion Unit 2, Export redigiert + Speicher unveraendert + Kette gueltig,
  Export owner-only mit 403 fuer operator/viewer, keine erfundenen Alarme); read-command-intents 7, audit 25,
  contract 30; control-api + mock-data gesamt 1354 bestanden / 128 Dateien; typecheck + lint gruen.
- evidence_paths: `dash-17-03-audit-verlauf.md`.
- status: PASS

### DASH-17.01 abgeschlossen (2026-10-23) - PASS
- gemacht: Verdrahtungsnachweis statt Umbau. `automations-ui-wiring.test.ts` vergleicht UI-Pfade mit der generierten
  Route-Tabelle (12/12 vorhanden), prueft sieben Capability-Gates und dass das Hermes-Manifest nur die fuenf
  implementierten Faehigkeiten deklariert (kein versions, kein pauseAll).
- live: `POST /automations/pause-all` und `GET /automations/{id}/versions` antworten 403 CAPABILITY_MISSING statt 500;
  die bestehende Live-Suite belegt Anlegen/Test/runs/disable/Neustart/Restore/Fehlerlauf auf denselben Routen.
- tests: Verdrahtung 4, live 4, web automations 32, typecheck/lint gruen.
- grenze: kein Browser in dieser Umgebung -> keine visuelle Abnahme, nur Quell- und Fetch-Ebene.
- evidence_paths: `dash-17-01-verdrahtung.md`.
- status: PASS

### DASH-18.01 abgeschlossen (2026-10-23) - PASS (Inventar)
- neu: `scripts/finalization/build-voice-parity.mjs` erzeugt die Paritaetsmatrix aus Intent-Kinds, Dispatcher und
  eingebauten Intents; `--check` meldet Drift. `apps/control-api/test/voice-parity.test.ts` (3 Tests) haelt Matrix und
  Quellen synchron und prueft die 20 Bereiche.
- befund: 11 Intent-Dienste, alle verdrahtet. Lesbar nur Aktivitaet/Benachrichtigungen/Freigaben/Audit/Einstellungen/
  Studio-Plan; schreibbar 11 Bereiche; ohne Sprachweg: Skills, Studio, System, Onboarding, Standort/Wetter. Fuer
  Aufgaben/Kalender/Kommunikation/Memory/Dateien/Agenten/Automationen/Recherche fehlt ein deterministischer Lese-Intent
  -> Freitext-/Modellpfad. Nicht hier behoben, sondern an 18.03 uebergeben.
- evidence_paths: `dash-18-01-voice-parity.md`, `dash-18-01-befunde.md`.
- status: PASS

### DASH-18.03 TEIL (2026-10-23) - Lese-Intent fuer Aufgaben
- Luecke aus 18.01 geschlossen: `tasks.list`/`tasks.get` in `read-query-intent.ts` (Familie `tasks`, Statuswhitelist,
  "offen" = todo|ready|running|waiting|review, expliziter Status 1:1, fremder Status -> Rueckfrage, Lesen+Aendern
  gemischt -> Rueckfrage, Rolle viewer, `listTasks` limit 5 sort priority).
- Wortliste akzeptiert meine/meinen/mein/my und die Flexionen offenen/laufenden/wartenden/erledigten/abgebrochenen/
  abgeschlossenen (entspannt auch die bestehenden Lesebereiche, deren Zuordnung unveraendert bleibt).
- Nachweis: `read-tasks.test.ts` (3) vergleicht die Sprachantwort mit `GET /api/v1/tasks`; `task-read-intent.test.ts` (6);
  bestehender Parser-Test um die tasks-Spalte ergaenzt (5). Paritaetsmatrix neu erzeugt: Aufgaben = lesen + schreiben.
- Vollsuite parallel: 2 Fehlschlaege (messenger-inbound-routes, secrets) - beide unter Last; seriell 4 Dateien/22 Tests
  gruen. Serienlauf der Gesamtsuite laeuft.
- status: TEIL (18.03 bleibt offen: Kalender-Lesepfad, weitere Lese-Intents, Persistenz-/Fehlerfallspalten je Funktion)

### DASH-18.03 TEIL 2 (2026-10-23) - Terminabfrage
- `calendar.list` (heute/morgen) ueber `calendar-day-range.localDayRange`: Wanduhr-Mitternacht in der Profilzeitzone,
  DST-korrigiert, beide Enden getrennt berechnet. Ohne Zone -> Hinweis statt geratenem Zeitraum.
- Rueckfragen statt Naeherung: kein Tageswort, "diese Woche", "uebermorgen", Uhrzeit im Satz, Lesen+Aendern gemischt.
- Nachweis: `calendar-day-range.test.ts` (3), `calendar-read-intent.test.ts` (4), `read-calendar.test.ts` (3, vergleicht
  mit `GET /api/v1/calendar/events`), Kalender-/Befehlsumfeld 21 Tests. Paritaetsmatrix: Kalender = lesen + schreiben.
- Zwischenbefund: Mock-Welt laeuft auf festem Startzeitpunkt (`2026-10-14T08:15Z`, realTimeWorld false) - der erste
  Testentwurf mit injizierter Uhr hat die Tagesgrenze gegen die Seeds verschoben; Test nutzt jetzt `runtime.nowMs()`.
- status: TEIL (18.03 bleibt offen)

### DASH-18.03 TEIL 3 (2026-10-23) - Unterhaltungsabfrage
- `communication.list` mit Status (open/waiting/replied/archived) und `needsReply` ueber `listThreads`, Rolle viewer.
- Kein Text in der Antwort (nur Kennung/Kanal/Status/Betreff); Test prueft gegen echte Seed-Texte und Zusammenfassungen.
- Rueckfragen statt Naeherung: "ungelesen" (kein Routenfilter), Zeitraum, zwei Status, Status+needsReply kombiniert,
  Schreibverben im Satz.
- Nachweis: `communication-read-intent.test.ts` (4), `read-communication.test.ts` (4, vergleicht mit der Route inkl.
  needsReply=false-Ausschluss). Paritaetsmatrix: Kommunikation = lesen + schreiben.
- Testinfrastruktur: `secrets.test.ts` (Lese-Endpunkt-Scan) brauchte ein explizites Timeout 120 s - er lief einzeln in
  16,5 s, im Serienlauf der Gesamtsuite lief er in die Vorgabe. Kein Retry, sondern ein realistisches Limit fuer einen
  echten End-to-End-Scan.
- status: TEIL (18.03 bleibt offen)

### DASH-18.03 TEIL 4 (2026-10-23) - Agentenabfrage
- `agents.list`/`agents.get` ueber `listAgents`/`getAgent`, Rolle viewer; Wortformen je Status in `AGENT_STATUS_WORDS`.
- "aktive Agenten" = idle/starting/working/waiting (nicht pausiert/offline/fehlerhaft) - dokumentierte Mengensemantik.
- Rueckfragen: zwei Status, Kennung plus Statusfilter, Lesen+Aendern gemischt, zwei Bereiche in einem Satz.
- Nachweis: `agent-read-intent.test.ts` (4), `read-agents.test.ts` (4, Mengengleichheit mit der Route fuer "aktiv").
  Paritaetsmatrix: Agenten = lesen + schreiben.
- Regression unterwegs: der Agenten-Zweig fing "Zeige Activity fuer meinen Agenten Alpha" ab. Behoben mit einer
  Vorpruefung auf weitere Lesefamilien; Kommunikation hat dieselbe Vorpruefung bekommen.
- status: TEIL (18.03 bleibt offen)
