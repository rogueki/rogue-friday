# Einstieg: Installation, Funktionen und Einstellungen

Diese Seite erklärt, was die Beta enthält und wie du nach der Installation weiterkommst. Für alle Installer-Fragen ist die [Installationsanleitung](../installer/ANLEITUNG.md) maßgeblich.

## Installation in fünf Schritten

1. **Voraussetzungen prüfen.** Verwende Windows 11 mit Administratorzugriff und WSL2. Plane mindestens 40 GB freien Speicherplatz und eine stabile Internetverbindung für die Downloads ein. Für Sprachsteuerung brauchst du Mikrofon und Lautsprecher. Halte einen Kimi-API-Schlüssel bereit, wenn du Cloud-Aufgaben nutzen willst.
2. **Das vollständige Repository laden.** Entpacke den ZIP-Download an einen Ort, der während der Installation bestehen bleibt. Die Installerdateien brauchen die Ordner `apps`, `packages`, `adapters` und `config` im selben Repository-Verzeichnis.
3. **Installer starten.** Doppelklicke `installer/install-friday.bat`, bestätige die Windows-Abfrage für Administratorrechte und beantworte die Fragen. Dazu gehören Assistant-Name, frei gewähltes Wake Word, Stimme, Persona, lokaler Linux-Benutzer und der Kimi-Zugang.
4. **Neustart und Spracheinrichtung abschließen.** Wenn Windows die WSL-Aktivierung abschließen muss, starte neu. Der Installer setzt danach fort. Folge dem Stimmaufnahmefenster und lass Training, Dienstinstallation und Dashboard-Build fertig laufen. Das dauert laut Installer-Anleitung typischerweise 45–90 Minuten.
5. **Erste Anmeldung.** Öffne <http://127.0.0.1:3100> und erstelle beim ersten Besuch dein lokales Dashboard-Konto. <http://127.0.0.1:43691> öffnet das Hermes-Dashboard. Die Sprach- und Dienstzustände lassen sich über die in der Installationsanleitung genannten lokalen Statusseiten prüfen.

Bei einem Abbruch kann der Installer erneut gestartet werden; er überspringt als erledigt gespeicherte Schritte. Details zu Installation, Konten, Updates, Wiederherstellung und Fehlersuche stehen in [installer/ANLEITUNG.md](../installer/ANLEITUNG.md) und [DEPLOYMENT.md](DEPLOYMENT.md).

## Wie das System aufgebaut ist

`rogue-friday` ist das Hauptprojekt: Windows-Installer, Dashboard, Control API und Adapter. Das Frontend ruft die lokale Control API auf. Adapter verbinden diese API mit Diensten wie Hermes, dem Voice-Service und dem lokalen System; ohne echte Verbindung kann der Dashboard-Modus Mock-Daten liefern.

Das separate Repository [friday-skills](https://github.com/rogueki/friday-skills) enthält 105 Friday-Skills, die Hermes ergänzen. Ein Skill im Quellcode ist noch kein eingerichteter oder ausführbarer Skill. Beide Repositories verwenden MIT-Lizenzen. Hermes-eigene eingebaute Skills sind eine weitere, davon unabhängige Quelle: die Zahl 53 wurde auf dem aktuellen Testrechner in der installierten Hermes-Laufzeit beobachtet und ist keine Zusage für andere Installationen.

## Was die Bereiche bedeuten

Das Dashboard bündelt Übersicht, Aufgaben, Aktivität, Agenten, Freigaben, Gedächtnis, Benachrichtigungen, Kommunikation, Kalender, Automationen, Recherche, Dateien, Sprache, Systemstatus und Audit. Die Oberfläche soll zeigen, woher Daten kommen und ob ein Adapter eine Aktion tatsächlich unterstützt. Im Installer-Standardmodus sind Aufgaben, Aktivität und Agenten für Hermes vorgesehen; Stimme und Systemstatus kommen von lokalen Diensten. In Kommunikation kann der Besitzer ein gesondertes Live-Postfach ausdrücklich öffnen und Textmails nach Vorschau senden; die übrige Ansicht verwendet weiterhin einen Platzhalteradapter. Der lokale Friday-Kalender verwaltet Termine sofort nach der Installation: anlegen, anzeigen, bearbeiten und nach Bestätigung löschen. Optional kann er nach ausdrücklicher Einrichtung ICS lesend oder CalDAV lesend und für bestätigte neue externe Termine verwenden.

Der Orb visualisiert den Zustand des Assistenten. Die Stimme und Wake-Word-Erkennung richten sich nach den Installer-Einstellungen. Das lokale Dashboard ist kein eigenständiger Ersatz für Hermes, Kimi oder weitere Anbieterzugänge.

### Skills und Voraussetzungen

Die aktuelle Installer-Testumgebung hatte 53 Hermes-Built-ins als aktiviert gemeldet. Darunter waren `powerpoint`, `computer-use`, `obsidian`, `opencode`, `codex` und `claude-code`. Das belegt nur den Skillstatus in dieser einen Installation. Es belegt nicht, dass alle Tools, Konten, Hosts oder Berechtigungen vorhanden sind.

- **PowerPoint:** Der Installer richtet `python-pptx` in einer eigenen WSL-Python-Umgebung ein und stellt Hermes den Befehl `python` bereit, sofern noch kein eigener `python`-Befehl vorhanden ist. Damit kann der Hermes-Standardskill `.pptx`-Dateien erstellen, lesen und bearbeiten, ohne Microsoft PowerPoint. Für Vorschaubilder und PDF-Export brauchst du zusätzlich LibreOffice (`soffice`) und Poppler (`pdftoppm` oder `pdftocairo`) in WSL; diese größeren Pakete installiert Friday nicht automatisch. Falls du bereits eine eigene Python-Installation in WSL hast, muss `python -c "import pptx"` dort funktionieren. Die Installer-Diagnose zeigt den Zustand an.
- **Computer Use:** Hermes nutzt in Friday-Ubuntu seinen Linux-CUA-Treiber für erreichbare WSLg-Linux-Fenster. Die Diagnose prüft X11, AT-SPI und den Capture-Pfad; eine echte Bildschirmaktion und die Steuerung beliebiger Windows-Fenster sind damit noch nicht belegt. Vor Änderungen einen aktuellen Bildschirm erfassen und die sichtbare Aktion prüfen.
- **Obsidian:** benötigt einen erreichbaren, vom Nutzer eingerichteten Vault. Ein Vault war in der aktuellen Testumgebung nicht verifiziert.
- **OpenCode, Codex und Claude Code:** sind externe Kommandozeilenwerkzeuge. Nach der Grundinstallation lässt sich jede CLI einzeln und optional mit `installer/setup-coding-cli.ps1 -Cli opencode`, `-Cli codex` oder `-Cli claude` nativ für den Friday-Linux-Benutzer einrichten. Mit `-Cli status` siehst du den Linux-Versionscheck. Der Installer lädt dafür bei Bedarf ein anhand der offiziellen SHA-256-Liste geprüftes Node.js in das Linux-Benutzerprofil. Windows-Shims zählen nicht als einsatzfähige WSL-CLI. Für ChatGPT Plus/Pro starte anschließend `-Cli codex -Login`, für Claude Pro/Max `-Cli claude -Login`; die Anmeldung erfolgt interaktiv beim jeweiligen Anbieter und gilt nur für die Coding-CLI, nicht für Fridays allgemeines Modellrouting. Version und Anmeldung beweisen noch keinen erfolgreichen Coding-Auftrag. Nutze bei abweichendem Zielordner zusätzlich `-InstallRoot 'D:\Dein\Friday'`.
- **Telefonie:** ist auf der aktuellen Testinstallation nicht eingerichtet und derzeit keine verfügbare Endnutzerfunktion.
- **E-Mail:** `installer/setup-himalaya.ps1 -Action install` installiert die optionale Himalaya-CLI im Friday-Linux-Benutzerprofil. Unter **Einstellungen → Skill-Konten** kann der Besitzer ein IMAP-/SMTP-Postfach mit Servern, Benutzername und Passwort oder App-Passwort anlegen. Unter **Kommunikation → Live-Postfach öffnen** kann er Nachrichten lesen und eine reine Textmail nach Vorschau ausdrücklich senden. Bei unklarem SMTP-Ergebnis prüfe zuerst das Anbieterpostfach: Friday wiederholt denselben Versand nicht. Nach dem Speichern kann ein manueller IMAP-Lesetest die Ordner beim Anbieter abfragen; SMTP bleibt dabei ungeprüft. OAuth-pflichtige Postfächer benötigen einen anderen Connector. Die übrige Dashboard-Kommunikationsansicht hat weiterhin einen separaten Platzhalteradapter.

Für SMTP gibt es daneben im Kontenformular einen manuellen Verbindungstest. Er prüft TLS beziehungsweise STARTTLS und Anmeldung ohne Nachricht; sein Ergebnis wird nicht dauerhaft gespeichert. Eine erfolgreiche Zustellung verlangt weiterhin eine ausdrücklich bestätigte Sendeprobe.

Für all diese optionalen Funktionen können zusätzliche Anbieter-Konten, Abonnements, Zugangsdaten und Berechtigungen nötig sein. Der Installer installiert oder finanziert sie nicht automatisch. Im Dashboard öffnet **Skills** den Katalog mit Suche, Status, Voraussetzungen und Einrichtungshinweisen. **Einstellungen → Skill-Konten** fasst auch die Voraussetzungen wichtiger Hermes-Standards zusammen. Nach dem ersten Besitzer-Login fragt die Einführung nach Name, Zielen und interessanten Friday- **und** Hermes-Skills. Der gewählte Name wird als Dashboard-Anzeigename gespeichert; Ziele bleiben zunächst Präferenzen der Einführung. Sie lässt sich überspringen und später fortsetzen. Eine Auswahl aktiviert keinen Skill und verbindet kein Konto. Für einen von Hermes gefundenen Skill mit bekanntem Zustand kann der Besitzer in der Einführung einzeln **Aktivieren** oder **Deaktivieren** wählen; Friday zeigt danach den bestätigten Zustand. Der Kontenschritt bleibt ohne echten Verbindungstest als ungeprüft markiert, auch wenn die Einführung abgeschlossen wird. Per Sprache nennt Friday für ausgewählte Skills die im aktuellen Katalog verzeichneten Konten und deren bekannten Einrichtungs- und Verbindungsstatus. Frage dazu: „Welche Konten brauche ich für meine Skills?“ Friday liest dabei keine Zugangsdaten vor und richtet keine Konten per Sprache ein. Der [Onboarding-Plan](SKILLS_ONBOARDING_PLAN.md) dokumentiert die Grenzen.

## Einstellungen verstehen

Die Einstellungen sind lokale Anwendungsdaten und werden nicht alle in der Benutzeroberfläche konfiguriert. Die Schema-Beispieldatei [settings-export.json](../packages/contracts/examples/settings/settings-export.json) veranschaulicht den möglichen Umfang; sie ist ein Formatbeispiel, keine Garantie, dass jede Option im Beta-Dashboard schaltbar ist.

| Gruppe | Beispiele | Wirkung |
| --- | --- | --- |
| Profil | Anzeigename, Assistant-Name, Sprache, Zeitzone | Beschriftungen und Darstellung lokaler Zeit |
| Dashboard und Theme | Layout, Kompaktheit, Aktualisierung, Farben, Transparenz, Orb | Darstellung und Anordnung |
| Navigation | Reihenfolge, ausgeblendete Bereiche, Startseite | Welche Dashboard-Bereiche zuerst erreichbar sind |
| Modellrouting | Standardmodell, Aufgabenrouten, Fallback, Budgetwert | Vorgesehene Zuordnung von Aufgaben zu Modellen; Zugang und Abrechnung bleiben beim jeweiligen Anbieter |
| Stimme | Wake Word, Push-to-talk, Stimmenprüfung, TTS und Geräte | Spracheingabe/-ausgabe; Aufnahmeaufbewahrung lässt sich getrennt steuern |
| Benachrichtigungen | Kanäle, Priorität, Ruhezeiten, Eskalation | Wann und über welche Kanäle Hinweise erscheinen |
| Sicherheit und Freigaben | Sitzungsdauer, Fernzugriff, erneute Bestätigung, Ablauf | Zugriffsschutz und Anforderungen an Aktionen |
| Aufbewahrung und Backups | Aufbewahrungsfristen, Speicherort, Zeitplan, Zahl der Sicherungen | Lokale Datenhaltung und Sicherungsroutine |
| Entwickleroptionen | Debug-Modus, Rohdaten, Szenario-Konsole, Orb-Messwerte | Diagnosefunktionen für Entwicklung und Fehlersuche |

Ändere keine Secret-Dateien direkt und teile lokale Zugangsdaten nicht. Hinweise zu Konfiguration, lokalen Ports und Geheimnissen: [Deployment](DEPLOYMENT.md).

## Was Beta bedeutet

Vorhanden sind das Command Center, die lokale Control API, Adapterverträge, Mock-Betrieb sowie die Installer-Anbindungen für Hermes-Aufgaben/Aktivität/Agenten und lokale Stimme/Systemdaten. Das ist der überprüfbare Rahmen der Beta; nicht jeder im Menü sichtbare Bereich stellt eine echte Provider-Verbindung dar.

Die optionale Himalaya-Einrichtung stellt einen IMAP-/SMTP-Pfad für Hermes und ein ausdrücklich zu öffnendes Dashboard-Postfach mit Lesezugriff und bestätigtem Textversand bereit; die übrige Kommunikationsansicht nutzt weiterhin Platzhalterdaten. Die Anbieterhilfe in **Einstellungen → Adapter → Kalender verbinden** führt durch Google, Outlook.com, Windows Kalender, andere ICS-Quellen und CalDAV. Sie zeigt Anleitungen; der Zugang wird separat gespeichert und ausdrücklich getestet. Öffne **Kalender → Jetzt Termin anlegen**, um ohne Anbieter-Konto einen lokalen Termin zu speichern. Ein iCalendar-Feed kann den Kalenderbereich zusätzlich lesend mit externen Terminen versorgen. Mit einem ausdrücklich eingerichteten CalDAV-Zugang kann der Besitzer außerdem einen neuen Termin nach Vorschau bestätigen. Bei einem unklaren Schreibstatus prüfe den Kalender beim Anbieter; Friday sendet denselben Versuch nicht automatisch erneut. Bestehende externe CalDAV-Termine ändern oder löschen, direkte OAuth-Anbindungen für Google und Microsoft, Telefonie sowie automatische Einrichtung und Funktionsprüfung sämtlicher 105 Friday-Skills sind noch nicht allgemein verfügbar. Das integrierte Onboarding speichert den Fortschritt und kann einzelne bestätigte Skills ausdrücklich schalten; seine Kontoauswahl verbindet keine Anbieter automatisch. Der Skills-Katalog gleicht Erkennung und Aktivierung mit Hermes ab und zeigt fehlende Laufzeitdaten als unbekannt. Siehe [Projektstatus](PROJECT_STATUS.md) und [Skills-Onboarding-Plan](SKILLS_ONBOARDING_PLAN.md).
