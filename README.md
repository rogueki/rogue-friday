# F.R.I.D.A.Y. — persönliches Command Center (öffentliche Beta)

F.R.I.D.A.Y. ist ein lokales Command Center für den Hermes Agent: ein Windows-Installer richtet Sprachsteuerung und Dienste ein; das Dashboard bündelt Aufgaben, Aktivität, Agenten, Freigaben und Systemstatus. Das Projekt ist **Beta-Software**. Einzelne Ansichten können noch simulierte Daten zeigen und optionale Integrationen brauchen eigene Konten und Einrichtung.

## Schnellstart

1. Lade das vollständige Repository als ZIP herunter und entpacke es. Starte nicht nur den Ordner `installer`: Dashboard-Quellordner müssen daneben liegen.
2. Lies [Installation und Ersteinrichtung](installer/ANLEITUNG.md). Prüfe Windows/WSL2, Speicherplatz, Mikrofon und API-Zugangsdaten, bevor du startest.
3. Doppelklicke auf `installer/install-friday.bat` und bestätige die Windows-Administratorabfrage. Folge den Fragen zur Assistenten-Persona, Stimme, Wake Word und lokalen Linux-Anmeldung.
4. Nach einem nötigen Windows-Neustart wird die Installation fortgesetzt. Nimm dein Wake Word auf und warte, bis Installer und erster Build abgeschlossen sind.
5. Öffne das Command Center unter <http://127.0.0.1:3100>. Beim ersten Besuch legst du den lokalen Dashboard-Zugang selbst an und durchläufst die Einführung. Das Hermes-Dashboard liegt standardmäßig unter <http://127.0.0.1:43691>. Bei einer benutzerdefinierten Installation gelten die im Installationsbericht genannten Ports.

Der Installer lädt das separate Repository `friday-skills` nach `<InstallRoot>\skills\friday-skills`, prüft die 105 Skill-Dateien gegen die Registry und meldet den Ordner bei Hermes an. Für optionale Dienste richte anschließend nur die Konten und lokalen Werkzeuge ein, die du wirklich nutzen willst; der Katalog nennt die jeweiligen Voraussetzungen.

Die ausführlichen Voraussetzungen, Dauer, Wiederaufnahme nach Fehlern, Update- und Fehlersuchschritte stehen in der [Installationsanleitung](installer/ANLEITUNG.md) und [Deployment-Dokumentation](docs/DEPLOYMENT.md).

## Was F.R.I.D.A.Y. derzeit kann

- Das Dashboard bietet eine gemeinsame Oberfläche für Übersicht, Aufgaben, Aktivität, Agenten, Freigaben, Gedächtnis, Benachrichtigungen, Kommunikation, Kalender, Automationen, Recherche, Dateien, Sprache, System und Audit. Das Verhalten und die verfügbaren Aktionen hängen vom verbundenen Adapter ab.
- Im Installer-Standardmodus sind Aufgaben, Aktivität und Agenten mit Hermes verbunden; Sprach- und Systemstatus kommen von den lokalen Diensten. Andere Bereiche können als Simulation angezeigt werden. Die Oberfläche kennzeichnet Datenquellen und eingeschränkte Fähigkeiten.
- Das Dashboard nutzt eine lokale Control API und Adapter. Hermes, Qwen, Sprache und Windows/WSL werden durch den Server angesprochen; der Browser erhält keine Zugangsschlüssel.
- Einstellungen umfassen unter anderem Profil und Sprache, Dashboard-Darstellung, Theme und Orb, Navigation, Modellrouting, Stimme, Benachrichtigungen, Anmeldung/Sicherheit, Freigaben, Aufbewahrung, Backups und Entwickleranzeige. Verfügbare Änderungen hängen vom installierten Stand ab. Eine [Beispieldatei für den Settings-Export](packages/contracts/examples/settings/settings-export.json) zeigt das Datenformat; sie ist kein Versprechen, dass jede Einstellung in der Beta-Oberfläche bereits bearbeitbar ist.
- Die Sprachsteuerung und persönliche Wake-Word-Einrichtung kommen aus dem Windows-Installer. Ein Kimi-Zugang wird bei der Einrichtung abgefragt; lokale Funktionen und Cloud-Aufgaben haben unterschiedliche Laufzeit- und Kontoanforderungen.

### Skills und optionale Werkzeuge

Es gibt zwei getrennte Repositories:

- Dieses Repository, [rogue-friday](https://github.com/rogueki/rogue-friday), enthält Installer, Command Center, Control API und Integration.
- [friday-skills](https://github.com/rogueki/friday-skills) enthält **105 eigenständige Friday-Skills**. Sie werden nicht dadurch ausführbar, dass sie im Repository liegen; der jeweilige Hermes-Skill, Host, Konto und nötige Berechtigungen müssen installiert und eingerichtet sein.

Beide Repositories sind MIT-lizenziert. Hermes bringt zusätzlich eigene integrierte Skills mit. Auf dem aktuellen Testrechner meldete Hermes **53 integrierte Skills aktiviert**. Das ist ein Messwert dieser konkreten Installation, keine Anzahl, die der Installer auf jedem Rechner garantiert.

PowerPoint, Computer Use, Obsidian, OpenCode, Codex und Claude Code hängen von konkreten lokalen Voraussetzungen ab. Im aktuellen Testprofil waren die Hermes-Skills für PowerPoint, Computer Use, Obsidian und diese Coding-CLIs gelistet; das bedeutet allein noch keine nutzbare Integration: PowerPoint benötigt eine passende Python-Umgebung, Computer Use eine unterstützte grafische Sitzung und Freigaben, Obsidian einen eingerichteten Vault. Coding-CLIs können einzeln und optional mit [setup-coding-cli.ps1](installer/setup-coding-cli.ps1) nativ in Friday-Ubuntu installiert werden; Versionsprüfung, Anbieteranmeldung und erfolgreicher Coding-Auftrag sind getrennte Zustände. **Telefonie ist nicht installiert und wird derzeit nicht als nutzbare Funktion angeboten.** Konten, Anbieterzugänge und Berechtigungen sind nicht enthalten.

Das Dashboard zeigt unter **Skills** die Friday-Skills und die in der laufenden Hermes-Instanz gefundenen Standardskills. Suche, Filter und Details erklären Aktivierung, Voraussetzungen und Einrichtungsorte. Nach dem ersten Besitzer-Login führt eine fortsetzbare Einführung durch Profil, Ziele, interessante Skills und benötigte Konten. Unter **Einstellungen → Skill-Konten** stehen die Hinweise zu Integrationen. Dort kann der Besitzer auch einen bestehenden Windows-Obsidian-Vault mit `.obsidian`-Ordner verbinden; Friday prüft dessen WSL-Zugriff und startet Hermes neu. Der Katalog zeigt ehrlich an, wenn Laufzeit oder Verbindung nicht geprüft wurden. Ein aktivierter Skill ist noch kein Nachweis, dass sein externer Dienst funktioniert. Siehe [Einstieg und Bedienung](docs/START_HERE.md) und [Skills-Onboarding-Plan](docs/SKILLS_ONBOARDING_PLAN.md).

## Was noch geplant ist

Die Beta deckt nicht alle Planziele ab. Mail- und Kalender-Provider sind Platzhalter; Telefonie und echte Anbieterintegrationen für alle 105 Friday-Skills sind noch nicht allgemein verfügbar. Die Einführung dokumentiert Interessen und erklärt die Einrichtung, sie verbindet keine Konten automatisch. Auch bei vorhandenen Ansichten können Daten oder Aktionen simuliert sein. Prüfe den Status der jeweiligen Schnittstelle in [Projektstatus](docs/PROJECT_STATUS.md), [Deployment](docs/DEPLOYMENT.md) und der Integrationsdokumentation, bevor du sie für reale Abläufe einsetzt.

## Entwicklung

Für die Dashboard-Entwicklung brauchst du Node.js 22.13 oder neuer und pnpm 10:

```sh
pnpm install
pnpm dev
```

Das startet Control API und Web im Entwicklungsmodus; Ports und Modi sind in [Deployment](docs/DEPLOYMENT.md) beschrieben. Nützliche Befehle: `pnpm build`, `pnpm typecheck`, `pnpm test`, `pnpm contracts:check`. Weitere technische Einstiegspunkte:

- [Architektur](docs/ARCHITECTURE.md)
- [Adapter-SDK](docs/ADAPTER_SDK.md) und [Konformität](docs/ADAPTER_CONFORMANCE.md)
- [Contract-first und Codegenerierung](docs/CONTRACT_FIRST.md)
- [Modellrouting](docs/MODEL_ROUTING.md)
- [Einstieg: Installation und Einstellungen](docs/START_HERE.md)

## Lizenz

Dieses Repository steht unter der [MIT-Lizenz](LICENSE). Das separate Repository [friday-skills](https://github.com/rogueki/friday-skills) enthält ebenfalls eine MIT-Lizenz. Drittanbieter, Modelle, Skills und externe Dienste können eigenen Bedingungen unterliegen.
