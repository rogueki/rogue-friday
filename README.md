# F.R.I.D.A.Y. — persönliches Command Center (öffentliche Beta)

F.R.I.D.A.Y. ist ein lokales Command Center für den Hermes Agent: ein Windows-Installer richtet Sprachsteuerung und Dienste ein; das Dashboard bündelt Aufgaben, Aktivität, Agenten, Freigaben und Systemstatus. Das Projekt ist **Beta-Software**. Einzelne Ansichten können noch simulierte Daten zeigen und optionale Integrationen brauchen eigene Konten und Einrichtung.

## Dashboard im Überblick

Die Bilder zeigen den aktuellen Desktop-Build im Vollbildformat 1920 × 1080 mit synthetischen Beispieldaten. Für die Galerie sind alle Dienste der Demo online; kurzlebige Cache-Hinweise, ein optionaler, nicht eingerichteter Modell-Eintrag und der Sammelhinweis zu einem eingeschränkten Kommunikationskanal sind ausgeblendet. Der Telefonkanal bleibt als eingeschränkt gekennzeichnet. Ein Klick öffnet das jeweilige Bild in voller Auflösung. Die Einführung ist nur auf dem letzten Bild zu sehen.

<table>
<tr><td><a href="docs/screenshots/uebersicht.jpg"><img src="docs/screenshots/uebersicht.jpg" width="540" alt="Übersicht"><br>Übersicht</a></td><td><a href="docs/screenshots/aufgaben.jpg"><img src="docs/screenshots/aufgaben.jpg" width="540" alt="Aufgaben"><br>Aufgaben</a></td><td><a href="docs/screenshots/live-aktivitaet.jpg"><img src="docs/screenshots/live-aktivitaet.jpg" width="540" alt="Live-Aktivität"><br>Live-Aktivität</a></td></tr>
<tr><td><a href="docs/screenshots/gedaechtnis.jpg"><img src="docs/screenshots/gedaechtnis.jpg" width="540" alt="Gedächtnis"><br>Gedächtnis</a></td><td><a href="docs/screenshots/agenten.jpg"><img src="docs/screenshots/agenten.jpg" width="540" alt="Agenten"><br>Agenten</a></td><td><a href="docs/screenshots/skills.jpg"><img src="docs/screenshots/skills.jpg" width="540" alt="Skills"><br>Skills</a></td></tr>
<tr><td><a href="docs/screenshots/freigaben.jpg"><img src="docs/screenshots/freigaben.jpg" width="540" alt="Freigaben"><br>Freigaben</a></td><td><a href="docs/screenshots/kommunikation.jpg"><img src="docs/screenshots/kommunikation.jpg" width="540" alt="Mail und Kommunikation"><br>Mail &amp; Kommunikation</a></td><td><a href="docs/screenshots/kalender.jpg"><img src="docs/screenshots/kalender.jpg" width="540" alt="Kalender"><br>Kalender</a></td></tr>
<tr><td><a href="docs/screenshots/automationen.jpg"><img src="docs/screenshots/automationen.jpg" width="540" alt="Automationen"><br>Automationen</a></td><td><a href="docs/screenshots/recherche.jpg"><img src="docs/screenshots/recherche.jpg" width="540" alt="Recherche"><br>Recherche</a></td><td><a href="docs/screenshots/content-studio.jpg"><img src="docs/screenshots/content-studio.jpg" width="540" alt="Content Studio"><br>Content Studio</a></td></tr>
<tr><td><a href="docs/screenshots/dateien.jpg"><img src="docs/screenshots/dateien.jpg" width="540" alt="Dateien und Dokumente"><br>Dateien &amp; Dokumente</a></td><td><a href="docs/screenshots/sprache.jpg"><img src="docs/screenshots/sprache.jpg" width="540" alt="Sprache"><br>Sprache</a></td><td><a href="docs/screenshots/meldungen.jpg"><img src="docs/screenshots/meldungen.jpg" width="540" alt="Meldungen und Alarme"><br>Meldungen &amp; Alarme</a></td></tr>
<tr><td><a href="docs/screenshots/system.jpg"><img src="docs/screenshots/system.jpg" width="540" alt="System"><br>System</a></td><td><a href="docs/screenshots/audit.jpg"><img src="docs/screenshots/audit.jpg" width="540" alt="Audit und Verlauf"><br>Audit &amp; Verlauf</a></td><td><a href="docs/screenshots/einstellungen.jpg"><img src="docs/screenshots/einstellungen.jpg" width="540" alt="Einstellungen"><br>Einstellungen</a></td></tr>
</table>

**Einführung:** <a href="docs/screenshots/einrichtung.jpg"><img src="docs/screenshots/einrichtung.jpg" width="720" alt="Einrichtungsassistent im Dashboard"></a>

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

PowerPoint, Computer Use, Obsidian, OpenCode, Codex und Claude Code hängen von konkreten lokalen Voraussetzungen ab. Im aktuellen Testprofil waren die Hermes-Skills für PowerPoint, Computer Use, Obsidian und diese Coding-CLIs gelistet; das bedeutet allein noch keine nutzbare Integration: PowerPoint benötigt eine passende Python-Umgebung, Computer Use eine unterstützte grafische Sitzung und Freigaben, Obsidian einen eingerichteten Vault. Coding-CLIs können einzeln und optional mit [setup-coding-cli.ps1](installer/setup-coding-cli.ps1) nativ in Friday-Ubuntu installiert werden. Codex lässt sich dort mit einem unterstützten ChatGPT-Konto anmelden, Claude Code mit einem geeigneten Claude-Pro-/Max-Konto. Beide Anmeldungen gelten für die jeweilige CLI; Friday erhält dadurch keinen allgemeinen API-Zugang für andere Modellaufrufe. Versionsprüfung, Anbieteranmeldung und erfolgreicher Coding-Auftrag sind getrennte Zustände. **Telefonie ist nicht installiert und wird derzeit nicht als nutzbare Funktion angeboten.** Konten, Anbieterzugänge und Berechtigungen sind nicht enthalten.

Das Dashboard zeigt unter **Skills** die Friday-Skills und die in der laufenden Hermes-Instanz gefundenen Standardskills. Suche, Filter und Details erklären Aktivierung, Voraussetzungen und Einrichtungsorte. Nach dem ersten Besitzer-Login führt eine fortsetzbare Einführung durch Profil, Ziele, interessante Skills und benötigte Konten. Unter **Einstellungen → Skill-Konten** stehen die Hinweise zu Integrationen. Dort kann der Besitzer auch einen bestehenden Windows-Obsidian-Vault mit `.obsidian`-Ordner verbinden; Friday prüft dessen WSL-Zugriff und startet Hermes neu. Der Katalog zeigt ehrlich an, wenn Laufzeit oder Verbindung nicht geprüft wurden. Ein aktivierter Skill ist noch kein Nachweis, dass sein externer Dienst funktioniert. Siehe [Einstieg und Bedienung](docs/START_HERE.md) und [Skills-Onboarding-Plan](docs/SKILLS_ONBOARDING_PLAN.md).

Für E-Mail kann der Besitzer die optionale [Himalaya-CLI](installer/setup-himalaya.ps1) in Friday-Ubuntu installieren und unter **Einstellungen → Skill-Konten** ein IMAP-/SMTP-Postfach mit Benutzername, TLS-Servern und Passwort oder App-Passwort einrichten. Friday speichert die Passwörter nur lokal im Linux-Benutzerprofil und zeigt sie nicht wieder an. Der Friday-Skills-Installer passt den gebündelten Hermes-Mail-Skill nur bei geprüfter Himalaya- und Hermes-Version an die v2-Befehle an; eine unbekannte Upstream-Version bleibt unangetastet. In **Kommunikation** kann der Besitzer das Live-Postfach ausdrücklich öffnen, Ordner und Nachrichten lesen und es wieder schließen. Nachrichten werden dabei nicht als gelesen markiert; Versand ist dort noch nicht angebunden. Das unterstützt Anbieter, die diese Anmeldeart zulassen; Microsoft-Postfächer und andere OAuth-pflichtige Konten brauchen einen eigenen OAuth-Connector. Die Einrichtung prüft noch keinen echten Postfachzugriff oder Versand. Die übrige Kommunikationsansicht nutzt weiterhin ihren gesonderten Platzhalteradapter.

Für Termine öffne als Besitzer **Einstellungen → Adapter → Kalender verbinden**. Wähle eine private HTTPS-ICS-URL oder einen kompatiblen CalDAV-Server mit HTTPS-Kalendersammlung, Benutzername und Passwort/App-Passwort. Friday schaltet den Kalender dann ausdrücklich von Simulation auf einen lesenden Zugang um; URL und CalDAV-Zugangsdaten werden lokal verschlüsselt gespeichert und nicht erneut angezeigt. Bei Google findest du einen ICS-Link unter „Kalender integrieren → Geheimadresse im iCal-Format“ ([Google-Anleitung](https://support.google.com/calendar/answer/37648)); bei Outlook.com unter „Freigegebene Kalender → Kalender veröffentlichen → ICS“ ([Microsoft-Anleitung](https://support.microsoft.com/en-us/outlook/share-your-calendar-in-outlook-com)). Ein veröffentlichter Outlook-Link ist für jeden mit dem Link lesbar. Direkter Google-CalDAV-Zugriff verlangt [OAuth 2.0](https://developers.google.com/workspace/calendar/caldav/v2/guide); private Outlook-Kalender benötigen [Microsoft Graph-Berechtigungen](https://learn.microsoft.com/en-us/graph/permissions-reference). Diese Konten werden durch die CalDAV-Passwortmaske nicht verbunden. Die frühere Windows-Kalender-App ist kein eigener Anbieter; verwende den Kalenderdienst des dortigen Kontos. Änderungen an Terminen erfordern später OAuth/Graph oder einen passenden CalDAV-Schreibadapter.

Unter **Skills → Coding mit Hermes** kann der Besitzer Codex, OpenCode oder Claude Code auswählen, den Root-Ordner eines lokalen Git-Repositories und einen konkreten Auftrag eingeben. Friday prüft vorab, ob der Hermes-Skill aktiviert, die CLI in Friday-Ubuntu nativ ausführbar und das Repository dort für Linux-Git erreichbar ist. Danach startet Friday genau die gewählte native CLI mit festem Aufruf und diesem Arbeitsverzeichnis. Das Dashboard zeigt Run-ID, Status und Ausgabe und kann die Prozessgruppe stoppen. Läufe sind auf einen gleichzeitig, 15 Minuten und 1 MiB Ausgabe begrenzt; abgeschlossene Laufdaten werden nach sieben Tagen entfernt. `auto` wählt die erste ausführbare CLI. Die Prozessbestätigung beweist weder Anbieteranmeldung noch erfolgreich geänderten Code; gehostete Modelle können Kosten verursachen.

Für den Sprachstart speichert der Besitzer im selben Bereich **einen Projektnamen und ein Git-Repository**. Bereits beim Speichern prüft Friday, ob Friday-Ubuntu das Git-Root lesen kann; dabei startet keine Coding-CLI und kein Modell. Dann kann er etwa sagen: „Starte Codex im Projekt Mein Projekt mit dem Auftrag, korrigiere den Fehler in der Anmeldung.“ Friday liest CLI, Projekt und Auftrag vor und wartet nach Ende der Ansage höchstens 90 Sekunden auf ein erneut sprecherverifiziertes „Ja“. Ein unbekannter Projektname, fehlende CLI/Aufgabe oder ein abgelaufener Dialog startet nichts. Wiederholte Bestätigungen desselben Auftrags werden serverseitig dedupliziert. Das Repository wird nur im Dashboard ausgewählt; gesprochene Dateipfade werden nicht ausgeführt. Ein echter Mikrofontest und ein Anbieterauftrag sind noch offen.

## Was noch geplant ist

Die Beta deckt nicht alle Planziele ab. Der optionale Himalaya-Pfad kann ein IMAP-/SMTP-Postfach für Hermes und ein ausdrücklich zu öffnendes, lesendes Dashboard-Postfach bereitstellen; die übrige Dashboard-Kommunikation hat weiterhin einen Platzhalteradapter. Für den Dashboard-Kalender gibt es ausdrücklich einzurichtende, lesende ICS- und CalDAV-Zugänge. Kalender-Schreibzugriff und direkte OAuth-Anbindungen für Google oder Microsoft sind noch offen. Telefonie und echte Anbieterintegrationen für alle 105 Friday-Skills sind ebenfalls noch nicht allgemein verfügbar. Die Einführung dokumentiert Interessen und erklärt die Einrichtung, sie verbindet keine Konten automatisch. Auch bei vorhandenen Ansichten können Daten oder Aktionen simuliert sein. Prüfe den Status der jeweiligen Schnittstelle in [Projektstatus](docs/PROJECT_STATUS.md), [Deployment](docs/DEPLOYMENT.md) und der Integrationsdokumentation, bevor du sie für reale Abläufe einsetzt.

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
