# Finalization progress — session handoff

Last updated: 2026-10-22 18:58 (Europe/Paris). Branch `feat/friday-finalization-20261021`, base `e98cbf5`.
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

## Open risks / notes for the next session

- The running installation must not be rebuilt or restarted from this branch without a rollback plan
  (`D:\Dokumente\F.R.I.D.A.Y` belongs to the operator).
- `dataMode: live` already exists and creates **no** adapters for unconfigured categories
  (`adapter-wiring.ts:241`); the fix direction is therefore to make the delivered configuration honest instead
  of inventing a fourth mode.
- Windows PATH quirk still applies: `$env:Path = $env:Path.Replace('"','')` before every `pnpm` command.
- The 13 `FIXED_PROVEN_CODE` rows prove source presence only, never runtime behaviour.