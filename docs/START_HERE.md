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

Das Dashboard bündelt Übersicht, Aufgaben, Aktivität, Agenten, Freigaben, Gedächtnis, Benachrichtigungen, Kommunikation, Kalender, Automationen, Recherche, Dateien, Sprache, Systemstatus und Audit. Die Oberfläche soll zeigen, woher Daten kommen und ob ein Adapter eine Aktion tatsächlich unterstützt. Im Installer-Standardmodus sind Aufgaben, Aktivität und Agenten für Hermes vorgesehen; Stimme und Systemstatus kommen von lokalen Diensten. Echte Mail- und Kalenderanbieter fehlen; diese Bereiche können simulierte Daten zeigen.

Der Orb visualisiert den Zustand des Assistenten. Die Stimme und Wake-Word-Erkennung richten sich nach den Installer-Einstellungen. Das lokale Dashboard ist kein eigenständiger Ersatz für Hermes, Kimi oder weitere Anbieterzugänge.

### Skills und Voraussetzungen

Die aktuelle Installer-Testumgebung hatte 53 Hermes-Built-ins als aktiviert gemeldet. Darunter waren `powerpoint`, `computer-use`, `obsidian`, `opencode`, `codex` und `claude-code`. Das belegt nur den Skillstatus in dieser einen Installation. Es belegt nicht, dass alle Tools, Konten, Hosts oder Berechtigungen vorhanden sind.

- **PowerPoint:** Ein Hermes-Skill ist keine PowerPoint-Lizenz oder installierte Python-Bibliothek. Eine passende Office-Umgebung und die benötigte Python-Abhängigkeit müssen vorhanden sein; `python-pptx` fehlte auf dem aktuellen Testrechner.
- **Computer Use:** benötigt eine unterstützte grafische Sitzung, verfügbare Eingabegeräte und passende Freigaben. Ein Headless- oder nicht interaktiver Host bietet diese Voraussetzung nicht automatisch.
- **Obsidian:** benötigt einen erreichbaren, vom Nutzer eingerichteten Vault. Ein Vault war in der aktuellen Testumgebung nicht verifiziert.
- **OpenCode, Codex und Claude Code:** sind externe Kommandozeilenwerkzeuge. Sie müssen in der Umgebung, in der Hermes läuft (beim Installer in WSL), installiert, angemeldet und ausführbar sein. OpenCode war dort vorhanden; Codex zeigte auf einen nicht ausführbaren Windows-Shim und Claude Code war nicht im WSL-PATH.
- **Telefonie:** ist auf der aktuellen Testinstallation nicht eingerichtet und derzeit keine verfügbare Endnutzerfunktion.

Für all diese optionalen Funktionen können zusätzliche Anbieter-Konten, Abonnements, Zugangsdaten und Berechtigungen nötig sein. Der Installer installiert oder finanziert sie nicht automatisch. Im Dashboard öffnet **Skills** den Katalog mit Suche, Status, Voraussetzungen und Einrichtungshinweisen. **Einstellungen → Skill-Konten** fasst auch die Voraussetzungen wichtiger Hermes-Standards zusammen. Nach dem ersten Besitzer-Login fragt die Einführung nach Name, Zielen und interessanten Friday- **und** Hermes-Skills. Der gewählte Name wird als Dashboard-Anzeigename gespeichert; Ziele bleiben zunächst Präferenzen der Einführung. Sie lässt sich überspringen und später fortsetzen. Eine Auswahl aktiviert keinen Skill und verbindet kein Konto. Der Kontenschritt bleibt ohne echten Verbindungstest als ungeprüft markiert, auch wenn die Einführung abgeschlossen wird. Der [Onboarding-Plan](SKILLS_ONBOARDING_PLAN.md) dokumentiert die Grenzen.

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

Noch nicht allgemein verfügbar sind echte Mail-/Kalenderadapter, Telefonie sowie automatische Einrichtung und Funktionsprüfung sämtlicher 105 Friday-Skills. Das integrierte Onboarding speichert den Fortschritt; seine Konto- und Skill-Auswahl ist eine Planungshilfe, keine Live-Verbindung. Der Skills-Katalog gleicht Erkennung und Aktivierung mit Hermes ab und zeigt fehlende Laufzeitdaten als unbekannt. Siehe [Projektstatus](PROJECT_STATUS.md) und [Skills-Onboarding-Plan](SKILLS_ONBOARDING_PLAN.md).
