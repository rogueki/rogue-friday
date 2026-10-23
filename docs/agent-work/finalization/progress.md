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
| DASH-10.02 Skill-Inventar | TEIL (191 Skills live aus `hermes skills list`: 119 local / 72 builtin / 0 hub; Herkunft und Trust als eigene Vertragsfelder, Service-Merge mit CLI-Fallback, Detail laedt Markdown erst bei Auswahl als Text, Filter fuer Suche/Quelle/Herkunft/Kategorie/Status, 60er-Blocks mit Nachladen; echter Hub-Skill fehlt auf diesem Host) | `dash-10-02-skill-inventory.md`, `test_skills_list.py` (9), `skills-onboarding.test.ts` (20), `skills-inventory-route.test.ts` (1), `SkillsPage.test.tsx` (4) |
| DASH-10.03 per-Skill-Schalter | PASS (Schalter = `skills.disabled`, nur ueber `save_disabled_skills`/`PUT /api/skills/toggle`; `opt-in/opt-out` sind Seeding-Schalter; Readbackprobe im wegwerfbaren Profil 72->71->72 mit Zeile `arxiv disabled`, Default-Profil unveraendert; Friday bestaetigt jede Aenderung durch erneutes Lesen, Test fuer ausbleibende Bestaetigung) | `dash-10-03-skill-enable.md`, `skills-onboarding.test.ts` (21) |
| DASH-10.04 Skill-Operationen | TEIL (Faehigkeitsmatrix beider CLI-Staende: nur `search` und `list-modified` liefern `--json`; beide typisiert, zusaetzlich `inspect`/`audit`/`diff` als unveraenderter Text mit Kuerzung und Leerbericht-Fehler, 279 Operationen; Mutationen und `external_dirs`-Verhalten offen) | `dash-10-04-skill-operations.md`, `test_hub_search.py` (9), `test_skill_report.py` (9), `skills-hub-route.test.ts` (3), `skills-report-route.test.ts` (4) |
| DASH-10.05 Registry-Flaeche | TEIL (Panel zeigt Treffer mit Quelle/Trust/Kennung/Beschreibung und die lokal geaenderten Skills, die Updates ueberspringen; kein Installationsknopf, Grund genannt. Voraussetzungen/Auditbefund je Treffer, Diff/Konflikt und Installation offen) | `dash-10-05-skill-registry-ui.md`, `SkillRegistryPanel.test.tsx` (3), web 88/685 |
| DASH-10.06 Abnahme Skill-Lebenszyklus | TEIL (Builtin, Friday- und Hub-Skill angesehen und verwaltet, Zustand ueberlebt neuen Prozess; Hub-Installation real in wegwerfbarem Profil mit Quarantaene und Scan, lokale Aenderung wird ohne `--force` nicht ueberschrieben, mit `--force` bewusst schon; fehlendes Laufwerk und Fehlertexte offen) | `dash-10-06-acceptance.md`, Befunde N-053/N-054/N-055 |
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

## Open risks / notes for the next session

- The running installation must not be rebuilt or restarted from this branch without a rollback plan
  (`D:\Dokumente\F.R.I.D.A.Y` belongs to the operator).
- `dataMode: live` already exists and creates **no** adapters for unconfigured categories
  (`adapter-wiring.ts:241`); the fix direction is therefore to make the delivered configuration honest instead
  of inventing a fourth mode.
- Windows PATH quirk still applies: `$env:Path = $env:Path.Replace('"','')` before every `pnpm` command.
- The 13 `FIXED_PROVEN_CODE` rows prove source presence only, never runtime behaviour.