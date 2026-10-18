> **Implementation reference (2026-10-19):** This document preserves the original product requirements and acceptance detail. Its historical planning-only status and Astra/Flash execution workflow are superseded by the current [`execution-plan.md`](execution-plan.md) and the user's later implementation authorization. Apply the current execution plan for phase ownership, worker routing, publication, and operational constraints; this file remains authoritative for product scope and detailed requirements. No claim of implementation or acceptance follows from this specification.
>
> **Publication note:** Machine-specific usernames and absolute workspace locations in examples are replaced with reusable paths/placeholders. This sanitization does not remove product or acceptance requirements; host-specific locations are installation inputs, not product behavior.

# F.R.I.D.A.Y. – vollständige Dashboard- und Hermes-Integration

Stand: 18.10.2026. Status: **Planung, noch nicht implementiert oder abgenommen.**

## 1. Auftrag und verbindliches Ergebnis

Friday muss vollständig über das eigene Dashboard und natürliche Sprache bedienbar werden. Jede verfügbare Funktion benötigt eine echte Einrichtung, persistente Konfiguration, wirksame Laufzeitanbindung und nachvollziehbare Fehlerzustände. Ein gespeichertes Formular, ein gestarteter Dienst oder ein installierter Skill allein bedeuten nicht, dass die Funktion funktioniert.

Prioritäten:

1. Obsidian als standardmäßiges, dauerhaftes Gedächtnis für alle Interaktionen mit dem Benutzer.
2. Vollständige Kommunikationswege: anbieterunabhängiges Mail Postfach, WhatsApp, Telegram und sämtliche weiteren im verwendeten Hermes verfügbaren Kanäle.
3. Bestehende Kalender nativ einrichten, einschließlich tatsächlich verfügbarem Schreibzugriff.
4. Sämtliche Hermes-Einstellungen im Friday-Dashboard zugänglich machen; Mock-Einstellungen durch echte Funktionen ersetzen.
5. Jede Dashboard-Funktion über natürliche Sprache erreichen und ausführen können.
6. „Stop“ beendet unmittelbar den aktiven Sprachdialog und die Ausgabe; danach reagiert Friday erst wieder auf das Wake Word oder einen ausdrücklichen manuellen Start.
7. Der Pause-Button entfällt vollständig in der Übersicht. Start/Stop erhalten eine eindeutige Zustandsführung.
8. Alle Einstellungen werden Feld für Feld auf tatsächliche Funktionsfähigkeit geprüft und überarbeitet; insbesondere muss das angeschlossene Headset als echtes Ein-/Ausgabegerät auswählbar und im Sprachdienst wirksam sein.

Dieser Auftrag erstellt den Plan. Er beinhaltet jetzt keine Installation, Codeänderung, Veröffentlichung, Live-Konfigurationsänderung oder Nachricht an externe Empfänger. Die spätere Umsetzung folgt dem unten beschriebenen Astra-/Flash-Verfahren.

## 2. Geprüfte Ausgangsbasis und Grenzen der Bestandsaufnahme

Maßgeblicher aktueller Quellcheckout: `rogue-friday-clean/`, Commit `6e168d1e276e168f93c3bd141fd0aa9fb5bcf6c3`; Arbeitsbaum vor Planerstellung sauber. Live-Installation laut Projektgedächtnis: `D:\Kali\Friday`, WSL `Friday-Ubuntu`. Ältere V1-SCOPE-Angaben „nur Mock/Platzhalter“ beschreiben nicht das hier beauftragte Ziel.

Read-only geprüft: installierter Hermes-Quellbaum `~/.hermes/hermes-agent` in Friday-Ubuntu, Git-Beschreibung `v0.22.2`, Commit `d923a5eb487a17c0a68801bba9ef0f56c81040a8`. Tag und SHA bilden die Planungsreferenz; Versionsanzeige allein garantiert keine vollständige Aussage über lokale Änderungen. Phase P0 erfasst deshalb zusätzlich den Arbeitsbaumstatus und die tatsächlich geladenen Plugins.

Graphify lieferte einen gespeicherten Snapshot mit queued-Aktualisierung. Die folgenden Feststellungen beruhen auf gezielt gelesenen Quelldateien, nicht auf angenommener Aktualität des Graphen. Keine persönlichen Postfachinhalte oder Secret-Dateien wurden für diesen Plan gelesen.

| Bereich | Nachweis im aktuellen Quellbaum | Konsequenz |
|---|---|---|
| Dashboard | `apps/web/src/app/(dashboard)/` enthält Übersicht, Kommunikation, Kalender, Memory, Tasks, Agents, Skills, Automations, Research, Files, Content Studio, Voice, Activity, Alerts, Approvals, Audit, System, Settings, Onboarding | Alle Bereiche müssen in die Abdeckungsmatrix; keine Beschränkung auf die ausdrücklich genannten vier Integrationen |
| Einstellungen | `apps/web/src/features/settings/SettingsPage.tsx`, `BasicAreas.tsx`, `SkillAccountsArea.tsx` | Viele Formulare existieren; ihre tatsächlichen Runtime-Consumer müssen einzeln nachgewiesen werden |
| Mail | `HimalayaAccountSetup.tsx`, `installer/wsl/configure_mail_bridge.py`, `installer/voice/mail_voice.py` | Echte IMAP-/SMTP-Einrichtung und Sprachlogik erweitern und vereinheitlichen, nicht neu erfinden |
| Mail-Namen | `packages/mock-data/src/seed/communication.ts` enthält „GMX Postfach“; weitere GMX-Bezeichnungen in Seed-/Szenariodaten | Produktweite Benennung und Bestandsmigration prüfen; ein bloßer Frontend-Textaustausch reicht nicht |
| WhatsApp | `MessagingGatewaySetup.tsx` bietet Modus/Allowlist, verweist für QR-Kopplung auf Hermes | Kopplung, Erneuerung, Status und Trennen vollständig nativ in Friday ergänzen |
| Telegram | `TelegramGatewaySetup.tsx`, `services/telegram-gateway.ts`, `installer/wsl/configure_telegram.py` | Einrichtung vorhanden; echte Zustellung, Empfang, Rechte und Neustart müssen Bestandteil der Abnahme werden |
| Kalender | `services/local-calendar.ts`, `adapters/calendar-placeholder/src/fetch-caldav.ts`, `put-caldav.ts`, `CalDavCreateDialog.tsx` | Lokale Kalender und vorhandene echte CalDAV-Teile wiederverwenden; Paketname „placeholder“ beweist allein keinen Mockbetrieb |
| Obsidian | `services/obsidian-vault.ts`, `installer/wsl/configure_obsidian.py` | Der geprüfte Pfad setzt `OBSIDIAN_VAULT_PATH`, prüft Verzeichniszugriff und startet Gateway neu. Das beweist noch keine automatische Gesprächsspeicherung oder Erinnerung |
| Hermes-Einrichtung | `SkillAccountsArea.tsx` enthält für mehrere Hermes-Integrationen nur Einrichtungs-/CLI-Hinweise und unbekannten Verbindungsstatus | Native Einrichtung und echte Prüfungen je Integration ergänzen |
| Runtime | `runtime/adapter-wiring.ts`, `create-runtime.ts` verbinden Live- und Mock-Bausteine | Herkunft pro Funktion verfolgen; leere Demo-Daten beseitigen keine simulierte Implementierung |
| Sprach-Stop | `installer/voice/friday_voice.py`: `STOP_WORDS` wird nach mehreren Fachcontrollern geprüft und ruft dort nur `tts.interrupt()` auf | Stop muss priorisiert und mit der zentralen Abbruchlogik vereinheitlicht werden |
| Button-Stop | Dieselbe Datei, `/control/stop`: Cancellation, Generation, Dialog-/Jobzustände werden zurückgesetzt | Bestehenden Ablauf als Ausgangspunkt verwenden; vollständige Controller-Abdeckung und verspätete Ergebnisse zusätzlich prüfen |

Nicht behauptet: vollständiges Hermes-Inventar, aktuelle Funktionsfähigkeit sämtlicher Provider, vollständig geprüfter Mikrofonweg oder existierende persistente Obsidian-Gesprächspipeline. Diese Punkte sind explizite Arbeit und Abnahmekriterien.

## 3. Vollständigkeit messbar machen

### 3.1 Verbindliche Inventare

Phase P0 erzeugt im Quellrepo unter `docs/agent-work/hermes-full-integration/`:

- `hermes-feature-inventory.json`: jede Funktion, jeder Kanal, jedes Toolset, jeder installierte/bündelte Skill, jedes Plugin und jeder Konfigurationsschlüssel des festgelegten Hermes-Stands.
- `dashboard-coverage.csv`: Zuordnung zu Dashboard, Formular, API, Runtime-Consumer, Sprachaktion und Test.
- `settings-runtime-map.csv`: jedes existierende Friday-Einstellungsfeld mit Speicherung, Anwendung, Rücklesen und Neustartverhalten.
- `mock-gap-register.md`: jeder Produktionspfad mit Mock, hartcodiertem Erfolg, wirkungsloser Einstellung oder Platzhalter.
- `acceptance-ledger.md`: Kriterien-ID, Test, Ergebnis, Datum, Revision und Beleg; nicht ausgeführte Tests ausdrücklich `NOT_RUN`.

Quellen sind Hermes-Konfigurationsdefaults und -validierung, CLI-/Setup-Funktionen, Dashboard-Routen und Formulare, Gateway-Provider, Tool-/Skill-/Plugin-Manifeste sowie die effektiv installierte Version. Secrets werden nur als Referenz/Belegungsstatus erfasst. Keine pauschalen Dumps der privaten Konfiguration.

Jeder Inventareintrag enthält: stabile ID, Quelle mit Revision, Typ, Standard, Wertebereich, Geheimnisstatus, Abhängigkeiten, verfügbarer Plattformumfang, UI-Pfad, Lese-/Schreibschnittstelle, Runtime-Consumer, Apply-/Restart-Verhalten, Sprachaktionen, Rechte, Test-ID und Status.

### 3.2 Abdeckung ist eine Release-Bedingung

- 100 % der anwendbaren Hermes-Funktionen und Konfigurationsschlüssel sind einer nativen Einrichtung zugeordnet.
- 100 % der angebotenen Friday-Funktionen besitzen einen realen Ausführungspfad und einen Zustand für fehlende Einrichtung.
- Kein offener Eintrag `mock`, `unmapped`, `TODO` oder `unsupported` wird als „vollständig integriert“ gezählt.
- Externe Voraussetzungen wie Anbieteraccount, kostenpflichtiger Tarif, Smartphone-QR oder OAuth-Zustimmung werden im Ablauf erklärt. Ohne diese Voraussetzung bleibt die Integration sichtbar als nicht eingerichtet; keine erfundene Erfolgsanzeige.
- Für neue Hermes-Versionen wird die Inventardifferenz geprüft. Neue Schlüssel/Funktionen erzeugen Abdeckungslücken statt stiller Unsichtbarkeit.
- Nicht übertragbare Hermes-Betriebsoptionen benötigen eine konkrete Begründung und sichtbare Behandlung. Sie dürfen nicht still aus dem Nenner verschwinden.

## 4. Gemeinsame Architektur für Einstellungen und Aktionen

### 4.1 Eine verbindliche Ausführungsschicht

Dashboard, Chat, Windows-Sprache und Messenger verwenden dieselben Domänenaktionen. Kein zweiter Mailversand, Kalender-Schreibweg oder Memory-Speicher nur für Sprachbefehle.

Fluss: UI/Text/Sprache → authentifizierter Kontext → validierte Aktion → Berechtigungs-/Freigabeprüfung → Domänendienst → echter Adapter → Ergebnisereignis → UI und Gedächtnis.

Ein Capability-Katalog beschreibt verfügbare Aktionen und erforderliche Einrichtung. Fehlt ein Zugang, führt „Richte mein Postfach ein“ zum passenden Formular und erhält den begonnenen Dialog. Der Katalog ist kein frei ausführbarer Shell- oder HTTP-Proxy.

### 4.2 Einheitlicher Einstellungsvertrag

Geplanter Vertrag, vor Implementation mit bestehenden OpenAPI-Schemas abzugleichen:

- `CapabilityDescriptor`: ID, Version, unterstützte Aktionen, Einstellungen, erforderliche Berechtigungen, Abhängigkeiten.
- `IntegrationAccount`: stabile Konto-ID, Art, Anzeigename, Eigentümer, Secret-Referenzen, Konfigurationsrevision.
- `IntegrationStatus`: installiert, konfiguriert, authentifiziert, verbunden, lesbar, schreibbar, letzter Check, Fehlercode, angewandte Revision.
- `ConfigChange`: erwartete Revision, typisierte Änderungen, geänderte Secret-Referenzen; keine beliebigen Befehle.
- `ApplyResult`: gespeichert, angewandt, verifiziert, Neustart nötig, Fehler oder unvollständige Kompensation.
- `ActionRequest`: Aktion, Konto-/Objekt-ID, Eingaben, Idempotency-Key, Dialog-ID, Cancellation-Generation.
- `ActionResult`: tatsächliches Ergebnis, externe Objekt-ID, Ausführungsstatus und geeignete Memory-Ereignisreferenz.

Vorhandene Verträge werden erweitert; neue Endpunkte werden erst in der Vertragsphase festgelegt. Vorgeschlagene Typnamen sind keine Behauptung vorhandener APIs.

### 4.3 Native Einstellungen

Suchbare Kategorien: Allgemein/Profil, Modelle und Hermes, Sprache, Gedächtnis/Obsidian, Mail Postfach, Messenger, Kalender, Skills/Tools/MCP, Automationen, Dateien/Recherche, Content Studio, Benachrichtigungen, Sicherheit/Freigaben, Daten/Backups, System/Updates, Darstellung.

Jeder Funktionsbereich erhält „Einrichten/Einstellungen“ direkt auf seiner Seite. Standardansicht verständlich; erweiterte Hermes-Optionen vollständig und typisiert. Keine rohe JSON-Eingabe als einzige Lösung für normale Benutzereinstellungen.

Jedes Formular unterstützt Laden, Bearbeiten, Validieren, Speichern, Anwenden, Verbindung prüfen, wirksamen Zustand zurücklesen, Konflikte anzeigen, Verbindung trennen und Fehlerbehebung. Ungespeicherte Änderungen bleiben erkennbar. Erfolgsanzeigen unterscheiden „gespeichert“ von „aktiv und geprüft“.

Secrets sind write-only, lokal verschlüsselt bzw. im vorhandenen OS-geschützten Speicher. Leeres Feld bedeutet beibehalten; Löschen ist eine eigene Aktion. Keine Passwörter in Sprachtranskripten, Memory, Exporten, URLs oder Logs. Bestehende Owner-/CSRF-/Revision-Prüfungen bleiben erhalten.

### 4.4 Hermes-Parität

Neben Kommunikation/Memory müssen Inventar und Oberfläche insbesondere Modelle/Provider, Authentifizierung, Fallbacks, Routing, Reasoning, Budgets, Kontext/Kompression, Sessions, Profile/Persona, Toolsets, Skills, Plugins, MCP, Browser/Terminal, Arbeitsverzeichnisse, Sandbox, Freigaben, Zeitpläne/Cron, Hooks, Gateway, Logging, Backups und verfügbare Import-/Exportfunktionen erfassen.

Diese Kategorien sind Startgruppen, kein Ersatz für das versionsgebundene Inventar. Auch seltene Optionen aus `hermes_cli/config_defaults.py` und Plugin-Schemas müssen zugeordnet werden. Nötige Browser-/OAuth-/Device-Code-Anmeldungen werden im Dashboard geführt; Anbieterzustimmung darf extern stattfinden, das lokale Einstellen und Prüfen bleibt in Friday.

## 5. Obsidian als standardmäßiges dauerhaftes Gedächtnis

### 5.1 Definition von „alles merken“

Standard: alle an Friday gerichteten Benutzerbeiträge, Friday-Antworten, relevante Aktionsergebnisse, Korrekturen und Entscheidungen dauerhaft als durchsuchbaren Text speichern – unabhängig davon, ob sie über Mikrofon, Dashboard, Hermes oder einen zugeordneten Messenger eingingen.

„Alles“ bedeutet keine garantierte fehlerfreie Antwort aus beliebig großen Datenmengen. Verbindlich sind vollständige Erfassung der unterstützten Interaktionsereignisse, dauerhafte Speicherung, nachvollziehbarer Abruf und Fehleranzeige. Roh-Audio wird standardmäßig nicht archiviert; das Transkript schon. Kein Gesprächsarchiv für passives Wake-Word-Audio. Zugangsdaten und ausdrücklich private/nicht zu merkende Inhalte sind ausgenommen.

Bestehende Interaktionen werden nur aus tatsächlich vorhandenen Archiven importiert. Verlorene oder nie gespeicherte Gespräche können nicht nachträglich erfunden werden.

### 5.2 Installation und Standardkonfiguration

1. Obsidian-Anwendung unter Windows erkennen und bei Neuinstallation als Standardkomponente einrichten; unterstützten Installationsweg und Version vor Umsetzung prüfen.
2. Vorhandenen Vault anbieten oder standardmäßig `<InstallRoot>\memory\Friday` anlegen; keine hartcodierte Laufwerksannahme.
3. Vault-Struktur und Obsidian-Konfiguration einrichten, vorhandene Notizen/Plugins erhalten.
4. Windows- und WSL-Pfade auf denselben Vault abbilden, inklusive Leerzeichen/Unicode; Lesen und Schreiben mit eigener temporärer Testnotiz prüfen.
5. Hermes-Obsidian-Skill und notwendige Werkzeuge installieren/erkennen; bestehende Konfiguration migrieren.
6. Gedächtnis muss ohne geöffnetes Obsidian-Fenster arbeiten. Obsidian Sync ist optional; lokale Funktion darf keinen Cloud-Sync-Tarif voraussetzen.
7. Dienststart, Rechte, persistente Queue, Index und Backup prüfen. Erst danach Status „Gedächtnis bereit“.

### 5.3 Speicherstruktur und Zuständigkeiten

Geplante Vault-Struktur:

```text
Friday/
  Conversations/YYYY/MM/        vollständige Dialogtexte nach Sitzung
  Daily/                       Tagesübersichten mit Quellen
  People/                      zugeordnete Personen und Präferenzen
  Projects/                    Projekte, Aufgaben, Entscheidungen
  Knowledge/                   bestätigte Fakten und Wissen
  Decisions/                   datierte Entscheidungen/Korrekturen
  Attachments/                 bewusst übernommene Anhänge
```

Der Vault ist die dauerhafte, menschenlesbare Inhaltsbasis. Technische Queue und Suchindex liegen getrennt im Friday-Datenverzeichnis und sind aus dem Vault rekonstruierbar. Bestehendes Hermes-Memory wird mit klarer Richtung eingebunden: Hermes erhält eine abgeleitete kompakte Kontextsicht und Abrufwerkzeuge; kein unkoordiniertes zweites Langzeitgedächtnis.

Jedes Ereignis erhält stabile ID, Sitzung, zugeordnete Identität, Kanal, Zeit/Zeitzone, Rolle, Aktion/Ergebnis, Quellenbezug und Status. Rohdialog und abgeleitete Zusammenfassung bleiben unterscheidbar. Modellfolgerungen werden nicht als bestätigte Benutzerfakten gespeichert.

### 5.4 Zuverlässige Schreibpipeline

- Interaktion zuerst lokal dauerhaft in einer Outbox sichern, dann idempotent in den Vault schreiben.
- Ereignis-IDs verhindern Duplikate bei Retries, Neustarts und Kanalüberbrückung.
- Streaming-Antworten sauber finalisieren; abgebrochene Antworten kennzeichnen. Keine nicht ausgeführten Aktionen als erledigt merken.
- Einzelner koordinierter Writer, atomare Dateiersetzung und Konflikterkennung; Benutzeränderungen in Obsidian nicht überschreiben.
- Bei fehlendem Laufwerk, Schreibschutz, voller Platte oder Sync-Konflikt: Queue erhalten, Warnung anzeigen, Wiederaufnahme ermöglichen. Bei nicht dauerhaft sicherbarem Eingang offen einen Speicherfehler melden.
- Anzeigen: letzte gesicherte Interaktion, ausstehende Ereignisse, letzter Fehler, Indexzustand und letzter erfolgreicher Restore-Test.
- Keine stillen Speicherlimits oder automatische Löschung alter Gespräche; Standardaufbewahrung unbegrenzt, Kapazität überwachen. Änderungen an der Aufbewahrung ausdrücklich sichtbar machen.

### 5.5 Erinnerung im Gespräch

- Vor relevanten Antworten hybride Suche aus Volltext, Metadaten und optional lokalem semantischem Index.
- Aktueller Dialog, bestätigte Benutzerpräferenzen und passende langfristige Quellen werden unter begrenztem Kontextbudget zusammengestellt.
- Fragen wie „Was haben wir letzte Woche zum Projekt beschlossen?“ liefern konkrete Quellen/Datum und unterscheiden Widersprüche bzw. spätere Korrekturen.
- „Merk dir …“, „Was weißt du über …?“, „Das stimmt nicht mehr …“, „Vergiss …“ und „Dieses Gespräch nicht speichern“ werden als echte Memory-Aktionen unterstützt.
- Editieren/Löschen in Dashboard und Obsidian synchronisieren; Index aktualisieren, Tombstones verhindern Wiederimport gelöschter Inhalte. Backup-Aufbewahrung und Löschwirkung transparent behandeln.
- Identitätsverknüpfung zwischen Stimme, Dashboard und Messenger nur bei bestätigter Zuordnung. Gruppen-/Fremdnutzertexte nicht ungeprüft als eigene Präferenz übernehmen.
- Inhalte aus Mails, Webseiten und Notizen bleiben Daten; eingebettete Anweisungen erhalten keine Ausführungsrechte.

### 5.6 Einstellungen und Abnahme

Formular: Vault wählen/erstellen/öffnen, Standard-Memory aktiv, erfasste Kanäle, ausgeschlossene Inhalte, privater Modus, Aufbewahrung, Index/Embedding-Modell, lokale Verarbeitung, Synchronisierung, Backupziel, Import/Export, Reparatur/Neuindexierung und Status.

**MEM-01:** Eine Interaktion pro Eingangskanal erscheint mit korrekter Identität und Antwort im Vault. **MEM-02:** Neustart von Voice, API, Hermes und Windows/WSL verliert keine bestätigten Ereignisse. **MEM-03:** Frühere Fakten werden in neuer Sitzung mit Quelle gefunden. **MEM-04:** Korrektur schlägt alten Fakt; Löschen entfernt aktive Abrufbarkeit. **MEM-05:** Crash zwischen Queue und Dateischreiben produziert keinen Verlust/kein Duplikat. **MEM-06:** Laufwerks-/Plattenfehler sichtbar und nach Behebung nachgespeichert. **MEM-07:** Backup in separaten Vault wiederhergestellt, Index daraus neu aufgebaut. **MEM-08:** Credentials/private Eingaben fehlen in Archiv, Index und Diagnoseexport. **MEM-09:** Gedächtnis arbeitet bei geschlossener Obsidian-App.

## 6. Kommunikation: Mail Postfach

### 6.1 Anbieterneutral und mehrere Konten

Sichtbare Standardbezeichnung exakt **„Mail Postfach“**. GMX bleibt höchstens ein optionales Anbieter-Preset. Bestehende selbst vergebene Kontonamen erhalten; nur bisherige Standardnamen migrieren. Navigation, Karten, Kontenauswahl, Sprachtexte, Setup, Fehler, Onboarding und Dokumentation prüfen.

Kontomodell: beliebig mehrere Konten im Rahmen deklarierter Ressourcenlimits; stabile Konto-ID, Name, Adresse, Absendername, Aliasse, Standardkonto und Signatur. Antworten bleiben beim Ursprungskonto. Konto-/Ordner-/UID-Zuordnung verhindert Zugriff aufs falsche Postfach.

### 6.2 Vollständiges Einstellungsformular

- IMAP: Host, Port, Verschlüsselung, Benutzername, Authentifizierungsart, Passwort/App-Passwort bzw. unterstütztes OAuth.
- SMTP separat: Host, Port, TLS/STARTTLS, Login, Authentifizierung, Absender und optionale abweichende Zugangsdaten.
- Ordner automatisch entdecken; Eingang, Gesendet, Entwürfe, Papierkorb, Archiv und Spam eindeutig zuordnen.
- Polling/Sync, Abrufumfang, Anhänge, Größenlimits, Suchumfang, Benachrichtigungen, Standardaktionen und Sendebestätigung.
- Anbieter-Presets sind bearbeitbare Vorschläge. Die generische IMAP-/SMTP-Konfiguration funktioniert ohne GMX-/WEB.DE-Abhängigkeit.
- OAuth-pflichtige Provider erfordern einen passenden Auth-Connector; ein Passwortformular allein erfüllt „jedes IMAP-/SMTP-Postfach“ nicht.

### 6.3 Native Funktionen und Prüfungen

Lesen, Suchen, Ordner, Anhänge, Markieren, Verschieben, Entwurf, Antworten/Allen antworten/Weiterleiten, Senden und Sent-Kopie. Thread-Header, Aliaswahl, UTF-8, UIDVALIDITY und Deduplizierung berücksichtigen. Versandjournal schützt bei Timeouts vor unbemerktem Doppelversand; unklarer Versandstatus wird nicht als fehlgeschlagen mit blindem Retry behandelt.

„Verbindung prüfen“ testet Auth/Lesen und SMTP-Auth getrennt, ohne automatisch eine Mail zu versenden. Ein ausdrücklich gestarteter Sendetest geht an eine kontrollierte Testadresse und wird als solcher angezeigt.

Sprache: „Lies die neueste Mail“, „Nimm mein Geschäftspostfach“, „Antworte ihr, dass ich morgen um zehn Zeit habe“, „Ändere den Betreff“, „Verschieb die zweite ins Archiv“. Kontext, Rückfragen, Diktat und Korrekturen verwenden die gleichen APIs wie die Oberfläche. Kein fester Befehlskatalog als Voraussetzung.

**MAIL-01:** Zwei unterschiedlich konfigurierte Testkonten ohne Überschneidung. **MAIL-02:** Neustart erhält Konfiguration und sichere Secrets. **MAIL-03:** Lesen/Suchen/Antwort/Sent-Kopie am echten Testpostfach. **MAIL-04:** Fehler für falsches Passwort, TLS, Port und abgelaufene Tokens verständlich. **MAIL-05:** Wiederholung/Timeout erzeugt keinen unbemerkten Doppelversand. **MAIL-06:** Name „Mail Postfach“ überall korrekt; eigene Namen erhalten. **MAIL-07:** Natürlicher Mehrschrittdialog mit Pronomen/Ordnungszahlen und nachträglicher Korrektur.

## 7. Telegram, WhatsApp und weitere Hermes-Kommunikationswege

### 7.1 Telegram

Native Einrichtung: Bot-Token, Bot-Identität prüfen, Owner-Zuordnung/Pairing, erlaubte Benutzer/Chats/Gruppen/Topics, Aktivierung, Empfangsmodus soweit vom installierten Connector unterstützt, Zustellziel, Medien/Sprachnachrichten, Antwortverhalten, Benachrichtigungen, Session-/Memory-Zuordnung, Trennen und Reauth.

Echte Statusanzeige unterscheidet Token vorhanden, Bot authentifiziert, Gateway verbunden, letzter Empfang und letzter bestätigter Versand. Long-Poll/Webhook-Doppelbetrieb verhindern. Keine Nachrichten an nicht eingerichtete Empfänger.

### 7.2 WhatsApp

QR-Kopplung direkt im Friday-Dialog: starten, QR anzeigen, Ablauf anzeigen, erneuern, abbrechen, gekoppelte Identität lesen, Verbindung prüfen, neu verbinden und abmelden. Kein Verweis auf das separate Hermes-Dashboard als notwendiger Einrichtungsschritt.

Der Server vermittelt den vorhandenen Hermes-Connector über einen eng begrenzten authentifizierten Integrationsweg. QR und Session bleiben kurzlebig/geschützt. Falls der festgelegte Hermes-Stand keine geeignete API bietet, wird ein versionsgebundener Bridge-Vertrag implementiert; keine erfundene API und kein bloßes iframe als Erfüllung.

Einstellungen: Modus, zugeordnete Nummer/Identität, erlaubte Kontakte/Gruppen, Antwortregeln, Anhänge, Benachrichtigungen, Session-/Memory-Zuordnung und Datenschutz. Falls mehrere WhatsApp-Connectorarten verfügbar sind, werden deren jeweils echte Voraussetzungen separat abgebildet.

### 7.3 Vollständige weitere Kanalabdeckung

Discord ist bereits als Einrichtungskomponente sichtbar und wird einbezogen. Alle weiteren Kanäle werden aus dem installierten Hermes-Gateway-/Plugin-Inventar übernommen, einschließlich ihrer spezifischen Logins, Berechtigungen, Pairing-/OAuth-Flows und Zustelloptionen. Keine ungesicherte Behauptung, welche weiteren Kanäle die konkrete Installation vollständig unterstützt.

Telefonie/CloudTalk/SIP, vorhandene Teams-/Workspace-Integrationen und E-Mail-Triage gehören ebenfalls in die Kommunikationsmatrix, sofern im installierten Funktionsbestand vorhanden. Bestehende Zugangseinrichtungen erhalten dieselben Apply-/Check-/Runtime-Kriterien.

Sprache: „Verbinde WhatsApp“, „Schreib Anna über Telegram …“, „Antworte auf ihre letzte Nachricht“, „Lies mir die neuen Nachrichten vor“, „Schalte Antworten in dieser Gruppe aus“. Bei mehreren Annas oder unbekanntem Kanal Rückfrage statt geratenem Empfänger.

**MSG-01:** Einrichtung vollständig aus Friday erreichbar. **MSG-02:** Empfang und gezielter Testversand real nachgewiesen. **MSG-03:** Tokenablauf, QR-Ablauf, Sessionentzug und Neustart abgedeckt. **MSG-04:** Allowlist/Owner-Zuordnung wirksam. **MSG-05:** Kanalübergreifende Identität und Memory korrekt; keine fremden Gesprächsinhalte in anderem Kontext. **MSG-06:** Freigabe bindet an endgültigen Empfänger, Kanal und Inhalt.

## 8. Kalender: bestehende Kalender mit echten Rechten

Kalender sind eigenständige Verbindungen. IMAP und SMTP richten keinen Kalender-Schreibzugriff ein.

Native Einrichtung:

1. Quelle wählen: lokaler Kalender, CalDAV, lesbarer ICS-Feed oder weiterer im Inventar vorhandener Provider-Connector.
2. Server/Account authentifizieren; CalDAV-Discovery unterstützt Principal/Home-Set/Kalenderliste statt zwingender Kenntnis einer einzelnen Collection-URL.
3. Alle erreichbaren Kalender mit Namen, Farbe, Zeitzone und tatsächlichen Rechten zeigen.
4. Bestehende Kalender auswählen, Sichtbarkeit/Sync und Standard-Schreibkalender festlegen.
5. Schreibrechte erkennen; optional ausdrücklich gestartete Schreibprobe mit eindeutiger Test-ID, Rücklesen und gezieltem Aufräumen.
6. Read-only-Kalender klar kennzeichnen. Friday kann fehlende serverseitige Rechte nicht durch einen lokalen Schalter erteilen; benötigten Provider-Schritt konkret erklären.

Formulare: URL/Discovery, Benutzername, Passwort/App-Passwort/OAuth, Kalenderauswahl, Default, Zeitzone, Syncintervall, Erinnerungen, Konfliktbehandlung, Kontentrennung, Verbindung prüfen, Reauth und Entfernen ohne serverseitiges Löschen.

Funktionen: Lesen, Erstellen, Ändern, Verschieben, Löschen, Ganztagstermine, Serien/Ausnahmen, Teilnehmer und Einladungswirkung soweit vom Connector unterstützt. ICS bleibt lesend. ETag/If-Match schützt vor Überschreiben paralleler Änderungen; Offline-Änderungen bleiben ausstehend und werden nicht als synchronisiert gemeldet.

Sprache: „Was steht morgen an?“, „Trag das in meinen Arbeitskalender ein“, „Verschieb den Termin von vorhin auf Freitag“, „Nur diesen Termin, nicht die Serie“. Relative Daten, Zeitzonen, Sommerzeit und Mehrdeutigkeit explizit auflösen.

**CAL-01:** Mehrere bestehende Kalender werden entdeckt und auswählbar. **CAL-02:** Create/Read/Update/Delete auf kontrolliertem echten Schreibkalender. **CAL-03:** Read-only zuverlässig erkannt und durchgesetzt. **CAL-04:** ETag-Konflikt verliert keine fremde Änderung. **CAL-05:** Serien/DST/Ganztag korrekt. **CAL-06:** UI, Sprache, Hermes und Memory sehen dieselben Ereignisse.

## 9. Vollständige Dashboard-Matrix

Für jede Zeile gilt: echte Daten, persistente Einstellungen, API-/Sprachparität, Rollenprüfung, leere/offline/fehlerhafte Zustände, Neustarttest und sichtbarer Einrichtungspfad.

| Dashboard-Bereich | Verbindliche Funktionen/Einstellungen | Beispiel natürlicher Bedienung |
|---|---|---|
| Übersicht/Orb | reale Statusaggregation, Start/Stop, aktive Sitzung, Widgets/Layout, kein Demo-Warnstatus | „Zeig mir, was gerade läuft“ |
| Kommunikation | Konten, Kanäle, Suche, Lesen, Entwürfe, Versand, Anhänge, Zustellstatus | „Antworte auf die letzte Nachricht von …“ |
| Kalender | Konten, Discovery, Kalenderrechte, Standard, Sync, komplette unterstützte Mutationen | „Plane das nächsten Dienstag ein“ |
| Memory | Obsidian-Installation, Aufnahme, Suche, Quellen, Korrektur/Löschen, Import/Export | „Was hatten wir dazu entschieden?“ |
| Aufgaben | echte Hermes-Boards, Status, Priorität, Zuordnung, Fristen, Ausführung und Stopp | „Mach daraus eine Aufgabe für morgen“ |
| Agenten | echte Profile, Modelle, Tools, Arbeitsverzeichnisse, Grenzen, Start/Stop, Status | „Lass den Recherche-Agenten daran arbeiten“ |
| Skills | Katalog, Installation/Updates, Abhängigkeiten, Konten, Aktivieren, Ausführen, Ergebnis | „Richte den benötigten Skill ein“ |
| Automationen | Trigger, Zeitplan/Zeitzone, Aktionen, Rechte, Testlauf, Historie, Retry/Deduplizierung | „Erinnere mich jeden Montag …“ |
| Recherche | echte Such-/Browserprovider, Keys, Quellen, Limits, Ergebnisablage | „Recherchiere das und speichere die Quellen“ |
| Dateien | erlaubte Ordner, Zugriffsrechte, Suche, Öffnen, Import/Export, Anhangbezug | „Öffne die Datei vom letzten Gespräch“ |
| Content Studio | reale Providerlogins, Vorlagen, Medienjobs, Ziele, vorhandene Publishing-Anbindungen | „Erstelle daraus einen Entwurf“ |
| Sprache | Geräte, Wake Word, Sprecher, STT/TTS, beide realen Stimmen, Lautstärke/Tempo soweit unterstützt, Stop | „Wechsle zur männlichen Stimme“ |
| Aktivität | persistente echte Ereignisse, Filter, Herkunft und Korrelations-ID | „Was hast du gerade geändert?“ |
| Benachrichtigungen | echte Quellen, Kanäle, Ruhezeiten, Priorität, Zustellung, Snooze | „Erinnere mich in einer Stunde daran“ |
| Freigaben | echte ausstehende Aktionen, Ablauf, inhaltliche Bindung, Ablehnen/Ändern | „Zeig mir, was noch meine Freigabe braucht“ |
| Audit | nachvollziehbare Änderungen, redigierter Export, Rechte, Aufbewahrung | „Zeige die letzten Einstellungsänderungen“ |
| System | echte Dienst-/Ressourcenwerte, Diagnose, Versionsstände, sichere Wartungsaktionen | „Warum funktioniert der Kalender nicht?“ |
| Einstellungen | sämtliche normalen und erweiterten Optionen mit Wirkung | „Ändere meinen Standardkalender“ |
| Onboarding | geführte Einrichtung aller Standardkomponenten, wiederaufnehmbar | „Hilf mir beim Einrichten“ |
| Standort/Wetter/Netzwerk | echte Standortwahl, Berechtigung, Ortsname, Wetter, nachvollziehbarer Verbindungsstatus | „Wie wird das Wetter bei mir?“ |
| Updates/Backups | echte Ausführung, Fortschritt, Wiederherstellung, Kompatibilität, Datenerhalt | „Prüfe auf Updates“ |
| Darstellung/Navigation | Layout, Theme, Orb, sichtbare Seiten, Sprache, Accessibility | „Zeig den Kalender auf der Startseite“ |

Noch fehlende Content-Studio-Publishing-Adapter oder andere echte Backends sind Implementierungsarbeit, keine durch Konfiguration lösbare Lücke. Der Inventarstatus muss dies unterscheiden.

## 10. Natürlichsprachliche Vollbedienung

### 10.1 Gemeinsamer Dialog- und Aktionskatalog

Für jede sichtbare Benutzeraktion wird eine typisierte Aktionsbeschreibung registriert: Zweck, Parameter, erforderliche Berechtigungen, Kontextbezüge, Rückfragen, Vorschau/Freigabe und Ergebnis. UI-Klick und Sprachaktion rufen denselben Handler auf.

Verarbeitung: STT/Text → Dialogkontext → deterministische schnelle Erkennung für klare Aktionen plus strukturierte Modellinterpretation → Schema-/Capability-Prüfung → fehlende Angaben erfragen → ausführen → tatsächliches Ergebnis kommunizieren → Memory-Ereignis.

Unterstützen: Synonyme, freie Formulierungen, Pronomen, Ordnungszahlen, „das/ihm/die zweite“, Korrekturen, Abbruch, Themenwechsel, mehrteilige Wünsche, Rückfragen und Fortsetzung. Offene fachliche Auswahlen dürfen begrenzt erhalten bleiben; abgelaufene Freigaben niemals wiederbeleben.

Die Modelle dürfen keine Konto-IDs, Empfänger, erfolgreiche Aktionen oder Zugriffsrechte erfinden. Geringe Sicherheit führt zur konkreten Rückfrage. Lokaler/Cloud-Routingpfad folgt den Einstellungen; kein heimlicher Cloud-Fallback für private Inhalte.

### 10.2 Einstellungen per Sprache

Normale Einstellungen können direkt geändert werden; Wirkung und angewandter Wert werden zurückgemeldet. Sicherheitsrelevante Änderungen und externe Aktionen nutzen die bestehenden vorgesehenen Freigaben. Passwörter werden über einen geschützten Eingabedialog erfasst. „Richte WhatsApp ein“ öffnet den QR-Flow; das physische Scannen bleibt ein nötiger Nutzerschritt.

Bei Dialogentwürfen und Konfigurationsänderungen werden nur die gewünschten Felder geändert. Parallele UI-Änderungen lösen einen Versionskonflikt aus. Sprache darf keine ungespeicherten Dashboard-Drafts unbemerkt überschreiben.

### 10.3 Abnahme natürlicher Sprache

Pro Aktionsfamilie mindestens zehn unabhängig formulierte Varianten, darunter nicht aus Implementierungsbeispielen kopierte Paraphrasen; mehrstufige Dialoge mit Korrektur und Kanalwechsel. Testset getrennt von Trainings-/Promptbeispielen halten.

**NLP-01:** Jede UI-Aktion besitzt eine erreichbare Sprache/Text-Aktion oder einen begründeten geführten physischen Schritt. **NLP-02:** Referenzen werden korrekt aufgelöst. **NLP-03:** Mehrdeutige Empfänger/Kalender führen zur Rückfrage. **NLP-04:** Korrektur invalidiert alte Freigabe. **NLP-05:** Ergebnisbehauptungen stimmen mit dem Backend überein. **NLP-06:** Ende-zu-Ende mit eingespeisten synthetischen Audiofixtures plus separat dokumentiertem realem Gerätepfad. Texttests gelten nicht als Mikrofontests. Weitere Benutzertestschleifen werden nicht zur Voraussetzung der normalen Entwicklung gemacht.

## 11. „Stop“ als sofortiger globaler Dialogabbruch

### 11.1 Gewünschte Semantik

„Stop/Stopp“ ohne erneutes Wake Word beendet den aktiven Dialog auch während Friday spricht, denkt oder auf ein Tool wartet. Anschließend Zustand `wake_only`: keine normale Transkription, keine Dialogaufnahme/-fortsetzung, kein automatisches Nachfragen. Nur lokale Wake-Erkennung bleibt aktiv. Vollständige Mikrofonabschaltung wäre damit unvereinbar und bleibt eine separate Pause-/Mute-Funktion.

Nach erfolgreichem Stop ist ein neues Wake Word oder ausdrücklicher Start erforderlich. „Stop“ wird nicht durch Modellrouting oder einen Fachcontroller verzögert. Vorkommen innerhalb vorgelesener Zitate oder „Stoppschild“ dürfen keinen unbeabsichtigten Abbruch auslösen.

### 11.2 Umsetzung

- Gemeinsame `cancel_active_interaction`-Semantik für Sprach-Stop und Übersicht-Button.
- Priorisierter lokaler Detektor/Barge-in während aktiver Zustände; Echo-/TTS-Unterdrückung und Betrieb mit aktivem Audiogerät prüfen.
- Ausgabequeue und Browser-/Headset-Audiopuffer stoppen/leeren; laufende Generation invalidieren.
- Mikrofon-Dialogpuffer verwerfen, Trusted-Session beenden, alle Controller-Freigaben löschen.
- Ausstehende Netzwerk-/Toolarbeit soweit möglich abbrechen; verspätete Ergebnisse dürfen keine Ausgabe oder Folgeaktion starten.
- Bereits beim Provider verbindlich ausgeführte Aktionen werden nicht als rückgängig bezeichnet. Unklarer externer Status bleibt nachprüfbar.
- Unabhängige geplante Automationen laufen weiter, sofern nicht ausdrücklich „Stoppe alle Automationen“ verlangt wurde; globale Dialogunterbrechung ist kein unkontrollierter Prozess-Kill.
- Gedächtnis erhält einen Abbruchmarker und bereits sicher erfasste Inhalte; Audio nach Stop wird nicht als neues Gespräch archiviert.

### 11.3 Messbare Abnahme

Ziel auf Referenzhardware: nach erkanntem Stop-Ereignis Ende der hörbaren Ausgabe p95 ≤ 250 ms; gesprochenes Wortende bis Stille p95 ≤ 750 ms. Mindestens 30 Messungen pro relevantem Ausgabepfad, einschließlich Bluetooth; Messpunkte/Hardware dokumentieren. Zielverfehlung ist offen zu berichten, nicht durch einen grünen HTTP-Status zu ersetzen.

**STOP-01:** Stop in listening/transcribing/thinking/tool-wait/speaking. **STOP-02:** Keine verspätete Antwort bei langsamem Modell/Tool. **STOP-03:** Pending-Mail/Kalender/Messenger-Freigaben gelöscht. **STOP-04:** Folgesatz ohne Wake Word wird nicht verarbeitet. **STOP-05:** Neues Wake Word funktioniert. **STOP-06:** Button und Sprachweg gleiche Semantik. **STOP-07:** TTS sagt selbst „Stop“ und bricht nicht irrtümlich ab. **STOP-08:** Kein dauerhaftes Audioarchiv im wake_only-Zustand.

## 12. Mock-Ablösung, Migration und Installation

Jeden Produktionspfad auf Seed-Daten, simulierte Adapter, zufällige Werte, lokale Attrappen und Einstellungen ohne Consumer prüfen. Tests/Demos behalten isolierte Fixtures; Produktion lädt sie nicht als Ersatz für ausgefallene Provider. Unkonfigurierte Funktionen zeigen „Einrichtung erforderlich“ mit direktem Einstieg.

Migrationen sind versioniert und wiederholbar. Bestehende Postfächer, Tokens, Kalender, Obsidian-Dateien, individuelle Stimmen, Einstellungen und Historie erhalten. Vor Änderungen Backup; Secret-Referenzen weiterverwenden. Fehlende Schreibrechte, Speicherplatz oder inkompatible Hermes-Version stoppen die betreffende Migration nachvollziehbar.

Installer und inkrementeller Updater müssen sowohl Neuinstallation als auch Upgrade abdecken: Obsidian/Vault, benötigte Hermes-Abhängigkeiten, Bridges, Voice, Verträge, Datenmigrationen, Dienste und Healthchecks. Neue Features dürfen nicht nur in einem Entwicklercheckout funktionieren. Optional kostenpflichtige Dienste werden nicht automatisch gebucht oder getestet.

Rollback trennt Programmdateien, Konfiguration und Benutzerdaten. Kein Zurückkopieren alter Vault-Inhalte über neue Erinnerungen. Rückwärtskompatibilität von Datenformaten und Migrationsgrenzen vor Release festlegen. Lokale Agent-Metadaten gehören nicht in Deployment-Artefakte.

## 13. Astra-/Flash-Ausführungsplan

Astra besitzt Architektur, Verträge, Priorisierung und abschließende Prüfung. Ein nativer `astra_flash_builder` implementiert jeweils ein zusammenhängendes Paket einschließlich gezielter Repository-Erkundung, Tests, Debugging und UI-Prüfung. Route ausschließlich `kourier/deepseek-v4.1-flash` über den installierten Codex Router. Dieser Plan hat keinen Worker und keinen kostenpflichtigen Routentest gestartet; tatsächliche Route ist für eine spätere Ausführung noch zu prüfen.

Die aktuelle ausdrückliche Wahl des Astra-Flash-Skills gilt für diesen Plan trotz älterer anderslautender Memory-Notizen. Ein späteres abweichendes Nutzerverbot hat Vorrang.

| Phase | Inhalt und primäre Ownership | Voraussetzung | Abnahme/Ergebnis | Budget pro Paket |
|---|---|---|---|---|
| P0 | Inventar/Gap-Analyse; `docs/agent-work/hermes-full-integration/`, Hermes-Quellen read-only | aktueller Stand gesichert | vollständige Quellzuordnung, Settings-Consumer-Matrix, reale Mock-Lücken | 60 min + 15 min Korrektur |
| P1 | gemeinsame Contracts/SDK, Capability-/Account-/ConfigApply-Verträge, native Settings-Shell; `packages/contracts`, `generated-sdk`, API/Settings | P0, Astra-Vertragsfreigabe | Versionskonflikte, sichere Secrets, Apply/Rücklesen, keine kosmetischen Erfolgsmeldungen | 90 + 20 min |
| P2 | Stop-Vertikalschnitt; `installer/voice`, Voice-Control/API/UI | P1-Grundvertrag | STOP-01 bis STOP-08; gemessene Latenz | 60 + 15 min |
| P3a | Obsidian-Installation/Vault/Outbox/Writer und Migration; Installer, Memory-Dienst/Adapter | P1 | MEM-01/02/05/06/08/09 | 90 + 20 min |
| P3b | Retrieval/Hermes-Kontext/Memory-UI/Backup/Restore | P3a | MEM-03/04/07, vollständiger Gedächtnisfluss | 90 + 20 min |
| P4 | generische Mehrkonto-Mail, echte Kommunikation-UI und Sprachaktionen | P1, P3a-Ereignisvertrag | MAIL-01 bis MAIL-07 | 90 + 20 min |
| P5 | Kalender-Discovery, Rechte, Mehrkalender-Schreiben, Sprache | P1, P3a | CAL-01 bis CAL-06 | 90 + 20 min |
| P6a | Telegram und WhatsApp nativ einschließlich QR/Status | P1, P3a | MSG-Kriterien für beide Kanäle | 90 + 20 min |
| P6b | weitere inventarisierte Hermes-Kommunikationswege | P6a, jeweiliger Connector-Vertrag | keine offene Kommunikationszeile im Inventar | je Connectorfamilie 90 + 20 min |
| P7 | vollständiger Hermes-Einstellungs-/Skill-/Plugin-/MCP-Umfang | P0/P1 und stabile Fachverträge | jede Inventarzeile nativ zugeordnet und wirksam | je kohärenter Funktionsfamilie 90 + 20 min |
| P8 | übrige Dashboard-Module und echte Runtime-Consumer | P7 sowie Fachabhängigkeiten | komplette Matrix aus Abschnitt 9 | je zusammenhängendem Modulfluss 90 + 20 min |
| P9 | universeller Dialog-/Aktionskatalog, kanalübergreifender Kontext, Einstellungsbedienung | Aktionsverträge ab P1; Abschluss nach P4–P8 | NLP-01 bis NLP-06 und Memory-Kanalparität | je vertikalem Dialogpaket 90 + 20 min |
| P10 | Gesamtintegration, saubere Neuinstallation, Upgrade/Rollback, Regression | P2–P9 akzeptiert | Release-Gates aus Abschnitt 15 | je Installations-/Upgradepaket 90 + 20 min |

Natürliche Bedienung wird bereits in den Fachphasen mitimplementiert; P9 vereinheitlicht und schließt die Abdeckung. Die Budgets sind begrenzte Arbeitsfenster, keine Gesamtdauerzusage. Ein Paket, das nicht hineinpasst, endet mit erhaltenem Checkpoint und wird sachlich neu zugeschnitten. Fehlversuchs-/Repair-Zähler werden nicht zurückgesetzt.

### 13.1 Pflichtinhalt jedes Flash-Briefs

Task-ID, Repo und Baseline, Voraussetzungen, erlaubte Dateien/Verantwortung, nicht anzufassende Bereiche, konkrete Vertragstypen, User-Flows, Fehlerfälle, Kriterien-IDs, genaue Testkommandos, Zeit-/Reparaturbudget und Ergebnisformat. Worker ist nicht allein im Repository, erhält fremde Änderungen und delegiert nicht weiter. Kein automatischer Commit, Push, Deployment oder bezahlter Setup-Smoke.

Spätere Phasen sind erst ausführbar, wenn P0/P1 ihre tatsächlichen Schnittstellen geklärt haben. Kein vager Auftrag „baue alles“ mit unbekannten Verträgen.

### 13.2 Verifikation des Arbeitsverfahrens

Vor erster Delegation Skill-Routingreferenz und `scripts/doctor.py` lesen/prüfen; statische Konfiguration nicht als Laufzeitnachweis ausgeben. `references/execution.md` und `references/review.md` zur jeweiligen Phase laden.

Installierte `scripts/workflow.py`-Helfer verwenden: `baseline`, `check`, `repair/resume`, `changed-paths`, `evidence-index`, `validate-report`, danach Astra-`decision`/`verify-decision`. Exakte Argumente vorher per `--help` ermitteln. Vertrag enthält Task-ID, Version, Acceptance-IDs und Check-IDs. Evidence möglichst außerhalb des Produktrepos halten.

Astra prüft tatsächlichen Diff inklusive unversionierter Dateien gegen die erfasste Baseline und die Belege in einem gebündelten Durchgang: Anforderungserfüllung sowie Qualität/Sicherheit. Standardmäßig eine gebündelte Korrekturrunde. Keine parallelen Writer im selben Arbeitsbaum, keine wiederholte Statusabfrage gesunder Worker, keine identische Volltestwiederholung ohne konkreten Anlass. Fertige Kinder nach Ergebniseingang beenden/als fertig markieren.

## 14. Teststrategie und Belege

Vorhandene Repo-Kommandos: `pnpm contracts:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:conformance`, `pnpm build:app`, `pnpm test:e2e`, `pnpm test:integration`. Pro Paket gezielte Auswahl; exakte Filter anhand der realen Paketmanifeste. Python-/PowerShell-Prüfungen für Installer/WSL/Voice ergänzen. Ein vollständiger Durchlauf erfolgt an der Integrationsgrenze.

Testebenen:

1. Vertrag und Validierung: alle Felder, Rechte, Versionskonflikte, Secret-Redaction.
2. Domänenintegration: reale Persistenz, Queue, Cancellation, Retries und Neustarts.
3. Native Browser-Flows: Einrichtung/Ändern/Prüfen/Trennen, Tastatur, mobile Darstellung, Fehler und Rücknavigation.
4. Providerintegration: kontrollierte Konten, synthetische Nachrichten/Termine, keine fremden Daten verändern. Ohne Zugang Ergebnis `BLOCKED_EXTERNAL`, nicht `PASS`.
5. Gedächtnis-Dauertest: sequenzierte Ereignisse, kontrollierte Abbrüche, Reparatur, Deduplizierung und Restore.
6. Sprache: Paraphrasen, Mehrturn-Dialoge, strukturierte Modellinterpretation und separat Audio-/Geräteweg.
7. Installation: frische isolierte Windows-/WSL-Umgebung und Upgrade vorhandener Konfiguration; Restart/Reboot, Rollback, Obsidian ohne geöffnetes Fenster.
8. Mock-Ausschluss: Standardinstallation kann keine Mock-Provider als echte Funktionen melden; Ausfall erzeugt Fehlerstatus, keine Demo-Antwort.

Pflichtnegative: falsche Credentials, abgelaufenes OAuth/QR, falsche Identität, volle Platte, Vault offline, Provider-Timeout nach möglichem Versand, ETag-Konflikt, Sessionablauf, doppeltes Ereignis, parallele Änderung, Wake nach Stop, verspäteter Tool-Callback, fremde Anweisung im importierten Dokument.

Jeder Beleg enthält Commit/Runtime-Version, Testfall-ID, tatsächlichen Ausführungspfad, Resultat, Grenzen und redigierte Artefakte. Screenshot beweist UI, nicht Backend-Wirkung; HTTP 200 beweist Erreichbarkeit, nicht vollständige Integration.

## 15. Definition of Done und Übergabe

- [ ] Inventar des festgelegten Hermes-Stands vollständig; alle Funktionen und Einstellungen zugeordnet.
- [ ] Jede angebotene Funktion nativ einrichtbar und über einen echten Backend-Pfad nutzbar.
- [ ] Keine Produktions-Mocks und keine Einstellungen ohne Runtime-Consumer.
- [ ] Obsidian standardmäßig eingerichtet; Interaktionen kanalübergreifend dauerhaft gesichert und abrufbar.
- [ ] Neustart-/Crash-/Restore-Nachweise für Memory vorhanden.
- [ ] „Mail Postfach“ anbieterneutral, Mehrkonto und vollständige IMAP-/SMTP-Einrichtung.
- [ ] WhatsApp einschließlich QR und Telegram vollständig nativ eingerichtet und real geprüft.
- [ ] Weitere inventarisierte Kommunikationswege samt spezifischer Einstellungen integriert.
- [ ] Bestehende Kalender entdeckt; tatsächlicher Schreibzugriff eingerichtet und geprüft.
- [ ] Gesamte Dashboard-Matrix mit realen Aktionen und passenden Einstellungen abgenommen.
- [ ] Natürliche Sprache deckt alle Aktionsfamilien ab, inklusive Dialogkontext und Änderungen.
- [ ] Sprach-Stop und Button erfüllen denselben Abbruchvertrag; nur Wake Word aktiviert erneut.
- [ ] Secrets, vorhandene Daten und benutzerdefinierte Einstellungen bleiben geschützt und erhalten.
- [ ] Neuinstallation und Upgrade auf sauberer Umgebung sowie Rollback verifiziert.
- [ ] Relevante lokale Checks und abschließende CI erfolgreich; bekannte offene Regressionen sichtbar erledigt.
- [ ] README/Bedienhilfe, Architektur-/Betriebsdoku, Versionsmatrix und Projektgedächtnis aktualisiert.

Übergabe liefert die ausgefüllte Abdeckungsmatrix, Test-/Runtime-Belege, Migrations-/Rollback-Anleitung und eine konkrete Liste externer noch fehlender Zugänge. Fehlt ein notwendiger realer Provider- oder Audio-Nachweis, wird der betreffende Teil als nicht vollständig verifiziert ausgewiesen. „Zu 100 % funktioniert“ wird erst innerhalb des dokumentierten Versions- und Testumfangs zugesagt, nicht aus einem grünen Formular abgeleitet.

## 16. Nächster ausführbarer Schritt

P0 auf dem dann aktuellen, gesicherten Quellstand durchführen: Hermes- und Friday-Inventare vollständig erzeugen, bestehende Setup-Felder bis zum Runtime-Consumer verfolgen, Produktions-Mock-Pfade erfassen und die genauen P1-Verträge daraus ableiten. Danach Umsetzung in der Abhängigkeitsreihenfolge oben; Schwerpunkt zuerst auf Stop, Obsidian-Gedächtnis und Kommunikation.

## 17. Verbindlicher Nachtrag: Pause entfernen, alle Einstellungen praktisch überprüfen

Dieser Nachtrag nimmt die Nutzerpräzisierung während der Planerstellung auf und ist Teil der Abnahme, keine optionale Erweiterung.

### 17.1 Übersicht ohne Pause-Button

Den Sprach-Pause-Button aus Übersicht, zugehörigen responsiven Varianten, Tastaturreihenfolge und Hilfetexten entfernen. Übersicht bietet klaren Start/Stop und einen verständlichen Zustand „Warte auf Wake Word“. Nach Stop wird keine dauerhafte Pause erzeugt, die eine weitere Bedienung zum Aufwecken verlangt. Bestehende Pause-Funktionen für Automationen oder explizite Mikrofon-Stummschaltung werden nicht versehentlich mitentfernt; der Auftrag betrifft den Pause-Button der Übersicht.

Ergänzung zu P2: UI-Entfernung zusammen mit Stop-Zustandsvertrag implementieren. **UI-STOP-01:** Kein Sprach-Pause-Button in Desktop-/Mobilübersicht oder Accessibility-Tree. **UI-STOP-02:** Stop → Wake-Bereitschaft → neues Wake Word → normaler Dialog. **UI-STOP-03:** Keine verwaisten Tastenkürzel, Tooltips oder inaktiven Resume-Abhängigkeiten.

### 17.2 Konkreter Gerätefehler und belegter Ausgangspunkt

Nutzerbeobachtung: Verbundenes Headset ist in anderen Anwendungen auswählbar, Friday zeigt beim Eingabegerät nur Systemstandard.

Quellbeleg: `adapters/voice-http/src/adapter.ts`, Methode `listVoiceDevices`, liefert im geprüften Stand grundsätzlich `emptyPage<VoiceDevice>()`. Der Kommentar bestätigt, dass der Dienst keine Geräteliste exponiert. `apps/web/src/features/settings/BasicAreas.tsx`, `VoiceArea`, ergänzt vor dieser leeren Liste immer Systemstandard. Dies erklärt den fehlenden Gerätebestand auf diesem Adapterpfad; eine vollständige Live-Diagnose des konkreten Headsets ist damit noch nicht durchgeführt.

Zusätzlich liefert `listVoiceProfiles` dort eine leere Liste. Auch Sprecherprofile und sonstige vergleichbare Platzhalter müssen in das Gap-Register, selbst wenn sie aktuell keinen sichtbaren Fehler auslösen.

### 17.3 Vollständiger Gerätepfad

1. Aktiven Audiomodus bestimmen: Windows-Hostgerät oder Browser-Audio. Die Liste muss vom Rechner kommen, der tatsächlich Audio verarbeitet; WSL-/Browser-/Windows-Geräte nicht vermischen.
2. Native Ein-/Ausgabegeräte vom Voice-Dienst abfragen. Windows-Endpunkte, verwendetes Audio-Backend, Eingabe-/Ausgabefähigkeit und tatsächliche Verfügbarkeit abgleichen. Kein statischer Gerätename im Frontend.
3. Headset-Mikrofon und Kopfhörerausgabe verständlich darstellen; Bluetooth-Profile, deaktivierte Endpunkte und Mehrfachauflistung durch mehrere Host-APIs berücksichtigen.
4. Stabile Geräteidentität verwenden. Flüchtige PortAudio-Indizes nach Neustart nicht blind wiederverwenden; beim Öffnen gegen aktuellen Bestand auflösen. Gleichnamige Geräte unterscheidbar machen.
5. „Systemstandard“ bleibt eine bewusst wählbare dynamische Option, ergänzt um das aktuell aufgelöste Gerät. Explizite Auswahl bleibt explizit.
6. Auswahl persistent speichern und vom Voice-Dienst bestätigen lassen. Streams sicher neu öffnen bzw. erforderlichen Neustart gezielt ausführen; vorherige funktionierende Konfiguration bei Fehler erhalten und Rückfall sichtbar anzeigen.
7. Aktuell wirksames Gerät samt Applied-Revision zurückmelden. „Gespeichert“ ist keine Bestätigung der aktiven Aufnahmequelle.
8. Geräte-Neusuche sowie Hotplug/Trennen/Wiederverbinden unterstützen. Gewählte fehlende Geräte als „nicht verbunden“ anzeigen, nicht aus der Einstellung löschen oder heimlich durch ein anderes Mikrofon ersetzen.
9. Mikrofon-Berechtigung, exklusiv belegtes Gerät, unterstützte Abtastrate und Kanalzahl prüfen; klare Fehler statt einer scheinbar vollständigen leeren Liste.
10. Im Browser-Modus Berechtigung, Geräteenumeration und Labelverfügbarkeit korrekt führen. Berechtigungsdialog gezielt auslösen; keine falsche Behauptung, der Browser könne ohne Zugriff alle Gerätenamen liefern.
11. Pegelanzeige für das tatsächlich aktive Eingabegerät, gezielt startbarer Aufnahmetest und kurzer Ausgabetest. Tests laufen über denselben Audio-Pfad wie Wake/STT/TTS.
12. Änderungen dürfen das Mikrofon nicht gleichzeitig mehrfach öffnen, bestehende Voice-Prozesse nicht unkontrolliert duplizieren und Stop/Wake nicht außer Kraft setzen.

### 17.4 Neues frühes Paket P2b: Audio-Geräte und tatsächliche Voice-Einstellungen

Nach P1, abgestimmt mit P2: ein zusammenhängender Flash-Vertikalschnitt für Geräteenumeration → API/SDK → Auswahl → geschützte persistente Konfiguration → Runtime-Apply → Status → Hotplug/Fehler → Tests. Primäre Pfade: `adapters/voice-http`, Voice-Verträge/API, `apps/web/src/features/settings`, `installer/voice` und nötige gezielte Installer-Konfigurationsmigration. Budget 90 Minuten plus eine 20-minütige Korrekturrunde; exakte Dateien/Verträge nach P0 festlegen.

**AUDIO-01:** Bekanntes angeschlossenes Headset in echter Geräteabfrage und Dropdown sichtbar. **AUDIO-02:** Auswahl wird vom Dienst als tatsächlich geöffnetes Gerät bestätigt. **AUDIO-03:** Ein-/Ausgabe unabhängig wählbar. **AUDIO-04:** Dienst-/Rechnerneustart erhält Zuordnung trotz geänderter Geräteindizes. **AUDIO-05:** Trennen/Wiederverbinden und Bluetooth-Profilwechsel nachvollziehbar. **AUDIO-06:** Fehler bei fehlender Berechtigung oder belegtem Gerät werden angezeigt. **AUDIO-07:** Synthetisches Signal/Loopback bestätigt die technische Pipeline; echte Headsetaufnahme wird separat belegt und nicht aus einem Mock abgeleitet. **AUDIO-08:** Wake, Stop und TTS funktionieren nach dem Wechsel weiterhin. **AUDIO-09:** Kein stiller Rückfall auf ein anderes Mikrofon. Physische Geräteinteraktion wird nicht durch erfundene Tests ersetzt; weitere wiederholte manuelle Testschleifen beim Benutzer vermeiden.

### 17.5 Jedes Einstellungsfeld benötigt einen Wirkungsnachweis

Für jedes Feld der vollständigen Einstellungen-Matrix sind folgende Prüfungen verpflichtend:

| Prüfung | Erforderlicher Nachweis |
|---|---|
| Datenquelle | Auswahlwerte stammen aus dem zuständigen Runtime-/Provider-Bestand; feste Produktoptionen sind ausdrücklich als solche definiert |
| Lesen | Angezeigter Wert entspricht der realen Konfiguration, einschließlich bereits außerhalb des Dashboards eingerichteter Werte |
| Validierung | Typ, Grenzen, Abhängigkeiten und fehlende Voraussetzungen verständlich geprüft |
| Speichern | Persistenz bestätigt; Secrets nur als gesetzter Zustand sichtbar |
| Anwenden | Zuständiger Dienst verwendet den neuen Wert; erforderlicher Neustart/Apply erfolgt tatsächlich |
| Wirkung | Fachlicher Beobachtungspunkt beweist die Änderung, beispielsweise aktive Geräte-ID, Modellrouting, Benachrichtigung oder Backupausführung |
| Neustart | Wert und Wirkung über API-/Dienst-/Host-Neustart erhalten |
| Parallelität | Änderungen aus zwei Tabs bzw. Sprache und UI überschreiben sich nicht unbemerkt |
| Fehler | Laden, Speichern, Apply und Verifikation haben eigene verständliche Fehlerzustände |
| Zurücknehmen | Verwerfen ändert keine Live-Einstellung; fehlgeschlagenes Apply zeigt tatsächliche Kompensation |
| Bedienbarkeit | Tastatur, Mobilansicht, Labels, Hilfetext, Ladezustand und unerwartet leere Auswahllisten geprüft |
| Sprache | Wert abfragen, passende Einrichtung öffnen und unterstützte Änderung natürlichsprachlich vornehmen |

Besonders prüfen: Wake Word, Push-to-Talk, Sprecherprofil, STT-Sprache/Modell, TTS-Stimme/Tempo, Ein-/Ausgabe, Modellrouting und Fallback, Ruhezeiten, Benachrichtigungskanäle, Session-Timeout, Freigabeablauf, Datenaufbewahrung, Backups, Speicherpfade, Standort, Theme/Layout und sämtliche Providerfelder.

**SETTINGS-ALL-01:** Kein Feld ohne benannten Consumer. **SETTINGS-ALL-02:** Kein funktionierender Status allein aufgrund lokaler Speicherung. **SETTINGS-ALL-03:** Jede Auswahl aus einer externen Geräte-/Konten-/Modellquelle besitzt echten Bestandsabgleich und Fehleranzeige. **SETTINGS-ALL-04:** Vollständige Feldmatrix mit Belegen abgearbeitet. Diese Kriterien sowie AUDIO-01 bis AUDIO-09 und UI-STOP-01 bis UI-STOP-03 ergänzen verbindlich die Definition of Done in Abschnitt 15.
