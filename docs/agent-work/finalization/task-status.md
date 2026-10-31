# Aufgabenstatus aus dem Masterplan (DASH-20.02)

Erzeugt am 2026-10-31 aus dem lokalen `FRIDAY_FINALER_UMSETZUNGSPLAN.md` (Stand nach #159-#166).
Status: `PASS` = abgehakt mit Nachweis; `BLOCKED` = Code/Tests vorhanden oder Aufgabe vollstaendig, Rest nur mit
Owner, echten Konten, Hardware oder sauberer Windows-VM abnehmbar; `NOT_RUN` = ohne Owner machbar, noch offen;
`SAMMEL` = Kopfzeile ohne eigenen Arbeitsschritt. `FAIL` kommt nicht vor: bekannte Fehler stehen als Ledger-Zeile
(`issue-ledger.csv`) mit Fix-PR. Nachweis = PRs, Ledger-IDs, Belegdateien aus der Plannotiz; die ausgefuehrten
Pruefungen stehen in der jeweiligen PR-Beschreibung und Ledger-Zeile. Datenmigrationen: nur Schemaguard/Backup aus
DASH-19.06 (#50) und Voice-Formatversion (#157); sonst keine. Rueckweg: wie im Planpunkt, sonst Revert der PRs.

Summe: BLOCKED 59, NOT_RUN 1, PASS 71, SAMMEL 10 (gesamt 141).

| Task | Status | Inhalt | Nachweis | Grenze / offen | Rueckweg |
|---|---|---|---|---|---|
| BASE-01 | PASS | Vorgänger: keiner. | rogue-friday-completion/docs/agent-work/finalization/baseline.md | - | nur neu erstellte Dokumentation revidieren. |
| BASE-02 | PASS | Vorgänger: BASE-01. | inventory.md issue-ledger.csv requirements.csv | - | Bestandsdateien unangetastet. |
| BASE-03 | PASS | Vorgänger: BASE-02. | contract-freeze.md | - | Vertragsänderung zusammen mit Consumern zurücknehmen, keine isolierte inkompatible SDK-Version ausliefern. |
| BASE-04 | PASS | Vorgänger: BASE-03. | acceptance-environment.md scripts/finalization/prepare-acceptance-env.ps1 | BLOCKED_EXTERNAL-Anteil: siehe Notiz | ausschließlich eigene Testressourcen entfernen, deren Pfade/IDs verifiziert wurden. |
| KEEP-01 | BLOCKED | Vorgänger: BASE-03 und reale Ereignisverträge. | #164 configure_obsidian.py | Offen (Owner | Writer stoppen, vorherige kompatible DB/Vault-Kopie wiederherstellen; neuere Events exportieren statt verliere |
| KEEP-02 | BLOCKED | Vorgänger: Voice-Status-/Cancellation-Vertrag. | #62 | Offen: Latenzmessung live (STOP p95 | vorherigen funktionierenden Voicepfad mit Konfiguration wiederherstellen, Sicherheitsabbruch nicht entfernen. |
| KEEP-03 | BLOCKED | Vorgänger: jeweilige Domänenhandler und Jobrouting. | #137 #150 #151 #152 #156 | TEIL 2026-10-30 #156: Kanalwechsel-Regel getestet und in IMPLEMENTATION_CONVENTIONS festgeschrieben - zweiter Owner-Tab darf die identische Vorschau abschliessen, geaende | Aktionskatalogversion zusammen mit Handlern zurücknehmen. |
| KEEP-04 | BLOCKED | Vorgänger: DASH-Fachmodule. | #79 #80 | Offen: Laufzeit-Matrix mit echten Konten. | Modulweise, Datenmigrationen berücksichtigen. |
| KEEP-05 | BLOCKED | Vorgänger: Studio-Bestandsvergleich und aktuelle Contracts. | #93 #110 I-047 I-054 keep-05-studio-paritaet.md | 2026-10-30: I-054 FIXED_PROVEN_CODE - #110 Hermes-Plugin friday-studio-plan liest/speichert den Plan über eigenen Loopback-Schlüssel (nur GET/PUT Plan mit Revision, bezah | Plan-/Jobdaten sichern, Versionen gemeinsam zurücksetzen, angenommene Providerjobs weiter abgleichen.  , I-049 |
| KEEP-06 | BLOCKED | Vorgänger: BASE-02, Settings und Fachhandler. | #142 keep-06-hermes-paritaet.md | offen. | Konfigurationssnapshot der passenden Hermes-Version, keine unkontrollierte Downgrade-Migration. |
| DASH-01.01 | PASS | Abhängigkeit: BASE-01; Inventare aus BASE-02 erweitern, nicht doppelt erzeugen. | - | - | Revert der genannten PRs |
| DASH-01.02 | PASS | Revision, Dirty-Status, tatsächlich installierte Build-ID und Laufzeitversionen getrennt e | - | - | Revert der genannten PRs |
| DASH-01.03 | PASS | Inventare als maschinenprüfbare Tabellen erstellen: UI-Seite→Datenquelle→Consumer→Status;  | - | - | Revert der genannten PRs |
| DASH-01.04 | PASS | Abnahme: jede Nutzeranforderung dieses Dokuments hat Inventarzeile; Quell- und Installatio | N-001 inventory.md | - | Revert der genannten PRs |
| DASH-01.05 | PASS | Fehler/Recovery: WSL aus → Offlineinventar plus offener gezielter Read-only-Schritt; keine | - | - | Revert der genannten PRs |
| DASH-02.01 | PASS | Abhängigkeit: DASH-01. | - | - | Revert der genannten PRs |
| DASH-02.02 | PASS | Vorhandene APIs, Eventsequenz und Job-/Auditstores wiederverwenden. | - | - | Revert der genannten PRs |
| DASH-02.03 | PASS | Einstellungsänderungen UI/Sprachdialog auf dieselbe Aktion führen; Bestätigung an endgülti | apps/control-api/test/settings-shared-action.test.ts rogue-friday-completion/docs/agent-work/finalization/dash-02-contracts.md | - | Revert der genannten PRs |
| DASH-02.04 | PASS | Abnahme: Contractcheck/SDKprüfung und gezielte Handler-/Eventtests decken Erfolg, Timeout, | db-migrate-repeatable.test.ts | - | Revert der genannten PRs |
| DASH-02.05 | PASS | Recovery: alte Vertragsversion kontrolliert weiter lesbar; vor Migration Sicherung mit gep | contract-version-compat.test.ts dash-02-migration-recovery.md db-migration-backup.test.ts | - | Revert der genannten PRs |
| DASH-03.01 | PASS | Abhängigkeit: DASH-02. | - | - | Revert der genannten PRs |
| DASH-03.02 | PASS | Jeden Produktivpfad inklusive Automationen, Kanäle, Agenten und Skillkatalog bis zur Quell | - | - | Revert der genannten PRs |
| DASH-03.03 | PASS | Einstellungen führen reale Adapteridentität, verbundenen Zustand und echte Konfiguration s | adapter-wiring.test.ts dash-03-production-path.md | - | Revert der genannten PRs |
| DASH-03.04 | PASS | Abnahme: Neuinstallation mit leeren echten Quellen zeigt 0 fachliche Einträge, Ausfall zei | - | - | Revert der genannten PRs |
| DASH-03.05 | PASS | Recovery: falsche Zuordnung → Snapshot rückspielen/Quarantäne rückführen; Dienst bei fehle | - | - | Revert der genannten PRs |
| DASH-04.01 | PASS | Abhängigkeit: DASH-02, DASH-03. | - | - | Revert der genannten PRs |
| DASH-04.02 | PASS | Master-Detail nach §3.2 bauen; „Adapter konfigurieren“ öffnet exakt ausgewählten realen Ad | - | - | Revert der genannten PRs |
| DASH-04.03 | PASS | Skillkonten links nach Skillname/Quelle/Status suchen und auswählen; rechts nur benötigte  | SkillAccountWorkbench.test.ts dash-04-settings.md settings-acceptance.spec.ts | - | Revert der genannten PRs |
| DASH-04.04 | PASS | Abnahme: zwei Adapter und zwei Skills nacheinander einrichten, Draft erhalten/verwerfen, N | - | - | Revert der genannten PRs |
| DASH-04.05 | PASS | Recovery: Fehlkonfiguration einer Seite isoliert; alle anderen Einstellungen bleiben errei | SkillAccountsResilience.test.ts | - | Revert der genannten PRs |
| DASH-05.01 | PASS | Abhängigkeit: DASH-03, DASH-04. | HimalayaAccountSetup.ts MailAccountsArea.ts b.de.ts | - | Revert der genannten PRs |
| DASH-05.02 | PASS | Obere Doppelblöcke entfernen. | channelList.test.ts communication.test.ts dash-05-communication.md | - | Revert der genannten PRs |
| DASH-05.03 | PASS | E-Mail-Wizard: Adresse → Absendername → erkannte bearbeitbare IMAP-/SMTP-Vorschläge → pass | MailAccountWizard.ts docs/agent-work/finalization/dash-05-email-wizard.md mailPresets.ts | - | Revert der genannten PRs |
| DASH-05.04 | PASS | Mehrere Konten, eigene Namen, Alias-/Antwortkonto, Ordner/UIDVALIDITY, Anhänge, UTF-8, Ent | docs/agent-work/finalization/dash-05-mail-accounts.md | - | Revert der genannten PRs |
| DASH-05.05 | BLOCKED | Abnahme: UI enthält genau sechs Filterlabels, keinen SMS-Filter, keine oberen Formulare. | docs/agent-work/finalization/dash-05-recovery.md | offen: zwei echte kontrollierte Testpostfaecher, in dieser Umgebung ohne Zugangsdaten nicht moeglich. `docs/agent-work/finalization/dash-05-recovery.md` | Revert der genannten PRs |
| DASH-05.06 | PASS | Recovery: Wizardabbruch hinterlässt keine teilaktivierte Verbindung; Sendetimeout → Status | docs/agent-work/finalization/dash-05-recovery.md | - | Revert der genannten PRs |
| DASH-06.01 | PASS | Abhängigkeit: DASH-04. | dash-06-calendar-accounts.md | - | Revert der genannten PRs |
| DASH-06.02 | PASS | `CalendarAccounts` aus Fachseite entfernen, in Kalender-Adapterdetail integrieren; Ansicht | - | - | Revert der genannten PRs |
| DASH-06.03 | PASS | CalDAV Principal/Home-Set entdecken; ICS als read-only kennzeichnen. | - | - | Revert der genannten PRs |
| DASH-06.04 | BLOCKED | Abnahme: kein Kontoeingabeblock auf Kalenderseite; mindestens zwei bestehende Kalender ent | dash-06-calendar-accounts.md | TEIL 2026-10-23: lokaler CalDAV-Fixture belegt zwei Kalender, CRUD, read-only, ETag-Konflikt und Serien/Ganztag/DST; echter Anbieter mit Zugangsdaten fehlt in dieser Umge | Revert der genannten PRs |
| DASH-06.05 | PASS | Recovery: fehlgeschlagene Discovery erhält bisherigen aktiven Account; Offlineänderung ble | - | - | Revert der genannten PRs |
| DASH-07.01 | PASS | Abhängigkeit: DASH-01, DASH-02, DASH-04. | - | - | Revert der genannten PRs |
| DASH-07.02 | PASS | Tatsächlich installierte Hermesversion/CLI-Hilfe/Configschema/Plugins erfassen; Fähigkeite | - | - | Revert der genannten PRs |
| DASH-07.03 | BLOCKED | OpenAI/Anthropic als Hauptauswahl, „Erweitert“ für tatsächliche weitere Provider. | dash-07-access-partial.md | TEIL 2026-10-23: Leseweg belegt - Bridge `auth-list` mit Parser, Vertrag GET /settings/hermes-access, Anzeige im Hermes-Bereich samt Tests; Hinzufuegen/Erneuern/Trennen u | Revert der genannten PRs |
| DASH-07.04 | BLOCKED | OAuth-/Deviceflow asynchron mit URL/Code/Ablauf/Abbruch/Fehler; Browserrückkehr kann ohne  | #165 dash-07-access-partial.md | Offen: echter Login mit Konto (Owner | Revert der genannten PRs |
| DASH-07.05 | BLOCKED | Abnahme: jede Inventarzeile endet mit native Friday-Fläche+wirksamer Backendoperation oder | - | offen: ohne echten Modellaufruf keine wirksame Operation belegbar; Hermes lokal erreichbar (v0.20.5 | Revert der genannten PRs |
| DASH-07.06 | BLOCKED | Recovery: fehlgeschlagener neuer Login verändert funktionierenden Standardzugang nicht; Ab | #66 #94 #165 test_hermes_provider_oauth.py | offen (Owner | Revert der genannten PRs |
| DASH-08.01 | SAMMEL | Abhängigkeit: DASH-04, DASH-07. | - | Sammelzeile; Stand in den Unterpunkten | Revert der genannten PRs |
| DASH-08.02 | BLOCKED | Telegramführung erklärt BotFather/Tokenbeschaffung, prüft echte Botidentität, koppelt Owne | #67 #74 #75 #146 N-174 | Offen: Live-Test mit echtem Token in einer Gruppe. | Revert der genannten PRs |
| DASH-08.03 | BLOCKED | Eingehende Allowlist strikt von ausgehenden Empfängerregistrierungen trennen; gleiche IDs  | messenger-send.ts | Offen: Live-Abnahme DASH-08.04. | Revert der genannten PRs |
| DASH-08.04 | BLOCKED | Abnahme: jedes der drei Kanäle ohne Hermes-UI einrichtbar; tatsächlicher Empfang und ausdr | #69 #70 TELEPHONY.md | offen: Asterisk-Installation und `/etc/asterisk`-Include laut TELEPHONY.md nur manuell (sudo | Revert der genannten PRs |
| DASH-08.05 | BLOCKED | Recovery: Retry nur für nicht ausgeführte Aktionen; keine doppelten Poller, Nachrichten od | #76 #78 | TEIL 2026-10-29 PR #78: CloudTalk trennen löscht die Schlüssel, beendet Terminanrufe, Revisionen bleiben monoton (alte Rufvorschauen ungültig), kaputtes Profil entfernbar | Revert der genannten PRs |
| DASH-09.01 | SAMMEL | Abhängigkeit: DASH-07, DASH-08. | - | Sammelzeile; Stand in den Unterpunkten | Revert der genannten PRs |
| DASH-09.02 | PASS | Verifizieren, welche WhatsApp-Connectorart vorhanden ist und welche konkrete Pairingoperat | installer/wsl/messaging_pairing.py test_messaging_pairing.py | - | Revert der genannten PRs |
| DASH-09.03 | BLOCKED | QR direkt im Fridaydialog mit Ablauf und Erneuern/Abbrechen anzeigen; gekoppelte Identität | #135 #139 | offen. | Revert der genannten PRs |
| DASH-09.04 | SAMMEL | Kontakt-/Gruppenregeln, Antworten, Anhänge, Benachrichtigung und Session-/Memoryzuordnung  | #143 #144 | Sammelzeile; Stand in den Unterpunkten | Revert der genannten PRs |
| DASH-09.05 | BLOCKED | Abnahme: echtes Testkonto koppeln, Ablauf und Neugenerierung, Abbruch, Empfang/bestätigten | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| DASH-09.06 | BLOCKED | Recovery: Browserrefresh liest laufenden Flow autorisiert wieder; abgestürzter Start räumt | #64 | Offen: Live mit Testkonto. | Revert der genannten PRs |
| DASH-10.01 | SAMMEL | Abhängigkeit: DASH-02, DASH-04, DASH-07. | - | Sammelzeile; Stand in den Unterpunkten | Revert der genannten PRs |
| DASH-10.02 | PASS | Builtin/external/Hub dynamisch inventarisieren, Quellen/Version/Trust/Kategorie/Status und | SKILL.md SkillMarkdown.ts SkillsPage.test.ts | - | Revert der genannten PRs |
| DASH-10.03 | PASS | Vor Aktivierung den tatsächlichen per-Skill-Enablemechanismus durch CLI-/Quellcodeanalyse  | agent/skill_utils.py hermes_cli/skills_config.py hermes_cli/web_routers/skills.py | - | Revert der genannten PRs |
| DASH-10.04 | PASS | Unterstützte `inspect/search/browse/install/update/check/audit/uninstall/trust/untrust/res | N-059 | - | Revert der genannten PRs |
| DASH-10.05 | PASS | Vor Installation Quelle, Voraussetzungen und Inspektions-/Auditbefund zeigen. | N-053 N-062 N-063 | - | Revert der genannten PRs |
| DASH-10.06 | BLOCKED | Abnahme: ein Builtin, ein Friday-Skill und ein kontrollierter Hub-Skill lassen sich jeweil | #166 N-053 N-054 SKILL.md | Offen ist nur der Nachweis am laufenden Operator-System (Owner | Revert der genannten PRs |
| DASH-10.07 | PASS | Recovery: Install-/Updatejob atomar oder mit wiederherstellbarem Snapshot ; fehlgeschlagen | - | - | Revert der genannten PRs |
| DASH-11.01 | SAMMEL | Abhängigkeit: DASH-01, DASH-02. | - | Sammelzeile; Stand in den Unterpunkten | Revert der genannten PRs |
| DASH-11.02 | BLOCKED | Pro Voicewidget Quelle→Servicefeld→Adaptermapping→API→Query/Event→UI protokollieren. | #48 | offen | Revert der genannten PRs |
| DASH-11.03 | BLOCKED | Sprecherprüfung enabled/state/confidence/recognizedSpeaker, Trusted Session active/expires | #51 #140 | TEIL 2026-10-29 PR #51: Dienst meldet speaker_decision (Score/Zeit) und trusted_remaining_s; Adapter zeigt Konfidenz, 'Abgelehnt' max. 60 s, expiresAt, 'disabled' bei abg | Revert der genannten PRs |
| DASH-11.04 | BLOCKED | Abnahme: echte Spracheingabe ändert sichtbaren Status inkl. | #73 | offen. | Revert der genannten PRs |
| DASH-11.05 | PASS | Recovery: Streamunterbrechung → stale/offline und Reconnect+Resync; kein alter Sprechersta | #56 #163 | - | Revert der genannten PRs |
| DASH-12.01 | SAMMEL | Abhängigkeit: DASH-11. | - | Sammelzeile; Stand in den Unterpunkten | Revert der genannten PRs |
| DASH-12.02 | BLOCKED | Sprecherprofil, Wake-Word-Kalibrierung und Ausgabestimmklon als drei verschiedene Artefakt | #153 #154 #157 N-179 N-180 N-182 | TEIL 2026-10-31 #157 (N-182): personal_wake.json traegt format 1, Status/Vertrag melden formatVersion; Stimmreferenz-Layout als needsVoiceUpdate - aeltere Artefakte werde | Revert der genannten PRs |
| DASH-12.03 | BLOCKED | Dashboard zeigt vorhandene Profile und echte Kalibrierwerte, aktives Profil, zuletzt geprü | #134 #141 #157 | TEIL 2026-10-31 #157: inkompatibles/aelteres Artefakt ausdruecklich benannt - Wake-Modellformat unbekannt, Stimmen-Update ausstehend. | Revert der genannten PRs |
| DASH-12.04 | BLOCKED | Abnahme: kontrollierte frische Installation mit Training zeigt danach dasselbe Profil im D | #44 | offen | Revert der genannten PRs |
| DASH-12.05 | PASS | Recovery: atomare Profilaktivierung mit vorherigem verifiziertem Profil als Rückweg; kein  | #44 #162 | - | Revert der genannten PRs |
| DASH-13.01 | SAMMEL | Abhängigkeit: DASH-11. | - | Sammelzeile; Stand in den Unterpunkten | Revert der genannten PRs |
| DASH-13.02 | BLOCKED | Dauerhaft genau ein Eingangs- und ein Ausgangsdropdown mit aktiver Fridayauswahl anzeigen. | #49 | offen | Revert der genannten PRs |
| DASH-13.03 | BLOCKED | Stabile Geräteidentität trotz Indexwechsel, getrennte Headset-Ein-/Ausgänge und Browser-/S | #57 | offen | Revert der genannten PRs |
| DASH-13.04 | BLOCKED | Abnahme: aktives Testheadset korrekt nach Neuöffnung/Reboot; alternatives Gerät wählen bew | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| DASH-13.05 | BLOCKED | Recovery: Wechsel scheitert → vorheriges verfügbares Runtimegerät bleibt aktiv; kein unbem | #45 #84 test_apply_audio_rollback.py | offen nur die Probe mit echtem Headset-Ab-/Anstecken | Revert der genannten PRs |
| DASH-14.01 | PASS | Abhängigkeit: DASH-01, DASH-03, DASH-07. | - | - | Revert der genannten PRs |
| DASH-14.02 | PASS | Funktionsmatrix zwischen Studio-Worktree und Completion erstellen: Ideen/Plan, Postingkale | dash-14-02-studio-matrix.md | - | Revert der genannten PRs |
| DASH-14.03 | PASS | Studio standardmäßig installieren/builden und Menü freischalten; vorhandene individuelle N | dash-14-03-studio-standard.md | - | Revert der genannten PRs |
| DASH-14.04 | PASS | Publishing und Status „gepostet“ unterscheiden: manuelle Planung ist keine bestätigte exte | dash-14-04-veroeffentlichung.md | - | Revert der genannten PRs |
| DASH-14.05 | PASS | Abnahme: neue Zielinstallation enthält Studioartefakte/Route/Standardmenü ohne manuellen C | content-studio-restart.test.ts dash-14-05-14-06-studio-abnahme.md | - | Revert der genannten PRs |
| DASH-14.06 | PASS | Recovery: Komponentenintegration rücksetzbar ohne Nutzermedien/Planverlust; unklarer Produ | - | - | Revert der genannten PRs |
| DASH-15.01 | PASS | Abhängigkeit: DASH-07, DASH-10. | adapters/hermes/test/agents.test.ts agent-mapping.ts agents-adapter.ts | - | Revert der genannten PRs |
| DASH-15.02 | PASS | Stabile Profile für `tasks`, `communication`, `calendar`, `automations`, `research`, `aler | SOUL.md dash-15-domain-agenten.md | - | Revert der genannten PRs |
| DASH-15.03 | PASS | Profiles sind echte auszuführende Workerrollen; nicht sieben neue Karten auf einem einzige | dash-15-16-orchestrierung.md | - | Revert der genannten PRs |
| DASH-15.04 | PASS | Abnahme: sieben Profile aus echter Konfiguration sichtbar, jedes erhält eigene passende Te | #35 #104 #106 #112 N-094 N-145 dash-15-16-orchestrierung.md | - | Revert der genannten PRs |
| DASH-15.05 | PASS | Recovery: ungültiges einzelnes Profil deaktiviert nur dieses; keine Ersatzkarte mit erfund | dash-15-domain-agenten.md | - | Revert der genannten PRs |
| DASH-16.01 | SAMMEL | Abhängigkeit: DASH-02, DASH-15. | - | Sammelzeile; Stand in den Unterpunkten | Revert der genannten PRs |
| DASH-16.02 | BLOCKED | Hauptmodell nimmt Gespräch an, zerlegt/routet und startet Domainjobs asynchron. | #33 #159 N-184 chat-domain-delegation.test.ts | Offen: Live-Abnahme FRIDAY-2 (Owner | Revert der genannten PRs |
| DASH-16.03 | BLOCKED | Globale/per-Provider/per-Agent-Parallelitätslimits, faire Queue, Budget-/Kostenlimits, max | #32 #36 dash-15-16-orchestrierung.md | Offen: Grenze je Anbieter und maximale Kindtiefe gibt es in Hermes nicht; Kostenlimit. `dash-15-16-orchestrierung.md` — 2026-10-29 PR #36: Kindtiefe/-anzahl/Schrittbudget | Revert der genannten PRs |
| DASH-16.04 | BLOCKED | Stopp unterscheidet sofortigen Dialog-/Audioabbruch und benannten Task-/Workerabbruch. | #32 #34 | offen | Revert der genannten PRs |
| DASH-16.05 | BLOCKED | Abnahme: während Recherchelangläufer läuft, per Sprache weitere Kalenderaufgabe und Status | #34 #159 #160 N-185 | Offen (Owner | Revert der genannten PRs |
| DASH-16.06 | BLOCKED | Recovery: Neustart erkennt unterbrochene Leases, gleicht externe Effekte ab und nimmt nur  | #34 | offene Aufträge nach Neustart wieder auf; Live-Abnahme offen | Revert der genannten PRs |
| DASH-17.01 | PASS | Abhängigkeit: DASH-03, DASH-08, DASH-15, DASH-16. | dash-17-01-verdrahtung.md | - | Revert der genannten PRs |
| DASH-17.02 | PASS | `mock-automation`-Herkunft bis Erzeuger entfernen. | dash-17-02-automations-adapter.md | - | Revert der genannten PRs |
| DASH-17.03 | PASS | Meldungen/Alarme und Audit-/Verlaufsagent nutzen echte Ereignisse mit Quelle/Korrelations- | dash-17-03-audit-verlauf.md | - | Revert der genannten PRs |
| DASH-17.04 | PASS | Abnahme: eigene echte kontrollierte Automation erstellen, auslösen, Lauf verfolgen, pausie | dash-17-04-acceptance.md | - | Revert der genannten PRs |
| DASH-17.05 | PASS | Recovery: schadhaftes Scheduling deaktiviert nur betroffene Automation; ausstehende unbeka | dash-17-05-recovery.md | - | Revert der genannten PRs |
| DASH-18.01 | PASS | Abhängigkeit: DASH-05 bis DASH-17 nach jeweiliger Funktion. | dash-18-01-befunde.md dash-18-01-voice-parity.md | - | Revert der genannten PRs |
| DASH-18.02 | PASS | Für sämtliche Zeilen aus §9 des alten Vollintegrationsplans Pflichtmatrix abschließen: Übe | dash-18-02-matrix.md | - | Revert der genannten PRs |
| DASH-18.03 | PASS | Pro tatsächlicher Funktion Quelle/Persistenz/Runtimewirkung/Rolle/Fehler/Sprachaktion über | #113 #114 #119 #122 #123 #124 #125 #126 #127 #129 #132 N-156 N-163 dash-18-03-funktionsnachweis.md dash-18-03-lese-intent-agenten.md dash-18-03-lese-intent-aufgaben.md | - | Revert der genannten PRs |
| DASH-18.04 | BLOCKED | Natürliche Mehrschrittdialoge mit Pronomen, Korrektur und Rückfrage führen auf gleiche Bac | #55 #58 #150 #151 N-177 N-178 | Offen: Folgebezug fuer weitere Bereiche (Gedaechtnis, Dateien, Unterhaltungen | Revert der genannten PRs |
| DASH-18.05 | BLOCKED | Abnahme: jede Inventarzeile besitzt echten Beleg; neue Namen/Navigation in UI und Sprache  | #79 | TEIL 2026-10-29 #79: tote Controls entfernt bzw. an echte Daten gebunden; serverseitig erzwungene Schalter (Remote-Zugriff, Hash-Kette, Passwort-Neuabfrage) als „Immer ak | Revert der genannten PRs |
| DASH-18.06 | PASS | Recovery: fehlerhafte Intentauflösung fragt gezielt nach; kein Erraten von Kontakt/Konto/T | dash-18-06-intent-recovery.md | - | Revert der genannten PRs |
| DASH-19.01 | SAMMEL | Abhängigkeit: DASH-01–18 und INS-01–12 bestanden; INS-13 wird mit DASH-19 gemeinsam im REL | - | Sammelzeile; Stand in den Unterpunkten | Revert der genannten PRs |
| DASH-19.02 | PASS | Tatsächlich vorhandene Scripts in `package.json` verwenden: Contract-/SDKcheck, Typecheck, | #97 #98 #99 #100 N-092 N-111 rel-01-gates.md | - | Revert der genannten PRs |
| DASH-19.03 | BLOCKED | Auf isoliertem sauberem Ziel Standardinstallation mit installierten Artefakten prüfen, ans | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| DASH-19.04 | BLOCKED | Installations-ID, Build-SHA, Hermes-/Voiceversionen und Portzuständigkeit auf Systemseite  | #46 #86 #91 #116 #118 | Offen: Sichtprüfung nach Neuinstallation. | Revert der genannten PRs |
| DASH-19.05 | BLOCKED | Abnahme: alle Anforderungen aus §2 einzeln PASS mit Artefaktpfad/Zeit/Version; UI-/API-/Ru | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| DASH-19.06 | BLOCKED | Recovery: verifizierter Release-/Konfigurationsrollback ohne Verlust neuer fachlicher Date | #50 | offen | Revert der genannten PRs |
| DASH-20.01 | SAMMEL | Abhängigkeit: DASH-19. | - | Sammelzeile; Stand in den Unterpunkten | Revert der genannten PRs |
| DASH-20.02 | PASS | Für jede Task Commit/Dateien, tatsächlich ausgeführte Prüfungen, Ergebnisstatus `PASS|FAIL | N-186 N-190 docs/agent-work/finalization/task-status.md | - | Revert der genannten PRs |
| DASH-20.03 | PASS | Lokales Memory enthält zuletzt tatsächlich verifizierte Installation und offene Betreibera | - | - | Revert der genannten PRs |
| DASH-20.04 | PASS | Abnahme: neue KI kann nach Lesen von Memory/Masterplan den nächsten offenen Task eindeutig | - | - | Revert der genannten PRs |
| REL-01.01 | PASS | Vorgänger: INS-12, DASH-18, KEEP-01 bis KEEP-06. | #161 CLAUDE.md docs/agent-work/finalization/rel-01-gates.md | - | Revert der genannten PRs |
| REL-01.02 | PASS | Aus dem Checkout die tatsächlich vorhandenen Kommandos ausführen: `pnpm contracts:check`,  | #83 rel-01-gates.md | - | Revert der genannten PRs |
| REL-01.03 | PASS | PowerShell-5.1-Parser, Bash-Syntax und gezielte Python-/Installer-/IPCtests nach tatsächli | #79 #82 N-130 ASCII-.ps1 | - | Revert der genannten PRs |
| REL-01.04 | PASS | Regressionen aus allen Issue-Ledger-Zeilen gezielt nachweisen. | N-171 | - | Revert der genannten PRs |
| REL-02.01 | BLOCKED | Vorgänger: REL-01. | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-02.02 | BLOCKED | Mailtest, Kalender-CRUD, WhatsApp-Kopplung, Telegram/Discord/Telefon, Voice-Enrollment/Ger | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-02.03 | BLOCKED | Dashboard Desktop/Mobil/Zoom und alle GUI-Zustände aufnehmen, persönlich identifizierende  | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-02.04 | BLOCKED | Rechte/CSRF, anderer Benutzer, parallele Tabs, abgelaufener Token, 429, Netzwerkabbruch, f | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-03.01 | BLOCKED | Vorgänger: REL-01/02 und INS-01–12, DASH-01–18. | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-03.02 | BLOCKED | Separater Custom-Root mit Leerzeichen/Unicode auf D:, eigener Distro/Location, Portkonflik | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-03.03 | BLOCKED | Fehler/Abbruch/Neustart an den kritischen Punkten Download, pip, Modellstart, Enrollment u | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-03.04 | BLOCKED | Upgrade einer gesicherten Bestandskopie mit Konten, Kalendern, Skillzugängen, Sprecherprof | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-04.01 | BLOCKED | Vorgänger: REL-03. | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-04.02 | BLOCKED | DB-/Vault-/Studio-Backup in separater Umgebung wiederherstellen; aktuelle Daten seit Backu | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-04.03 | BLOCKED | Unklare externe Vorgänge nach Crash über Providerstatus abgleichen. | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-05.01 | BLOCKED | Vorgänger: REL-04. | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-05.02 | BLOCKED | Alle alten Kriterien MEM/MAIL/MSG/CAL/NLP/STOP/UI-STOP/AUDIO/SETTINGS-ALL mit neuem Namen  | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-05.03 | BLOCKED | Review explizit nach Auslassungen: Telefon/Discord ebenso wie WhatsApp; Skillskonten ebens | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-05.04 | BLOCKED | FAIL/BLOCKED/NOT_RUN bei Mussfunktion verhindert „vollständig fertig“. | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-06.01 | BLOCKED | Vorgänger: REL-05. | - | nur mit Owner/echter Umgebung abnehmbar | Revert der genannten PRs |
| REL-06.02 | BLOCKED | Versions-/Kompatibilitätsmatrix, Paketmanifest, aktuelle Revision, Migrationen, Rollback,  | #120 #121 N-146 N-155 docs/RELEASE_COMPATIBILITY.md | Offen: nach REL-05 gegen die abgenommene Version bestätigen. | Revert der genannten PRs |
| REL-06.03 | BLOCKED | Deploymentpaket prüfen: keine lokalen MEMORY/SCOPE/AGENTS/CLAUDE/Arbeitsentwürfe, private  | #115 #131 #133 CLAUDE.md update-dashboard-github.ps1 | TEIL 2026-10-30 #131/#133: eigene Referenzaufnahmen bleiben lokal; Installer-Tests aus Selbstkopie und ZIP ausgeschlossen. | Revert der genannten PRs |
| REL-06.04 | NOT_RUN | Übergabe enthält Dateipfade und tatsächlich ausgeführte Checks, keine pauschale Perfektion | - | noch kein Nachweis | Revert der genannten PRs |
