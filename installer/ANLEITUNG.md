# F.R.I.D.A.Y. – Installation für Einsteiger

Dieses Paket richtet deinen persönlichen Sprachassistenten **F.R.I.D.A.Y.** („Friday“, der Nachfolger von J.A.R.V.I.S.)
komplett ein. Den **Namen** und das **Wake Word** (mit dem du ihn rufst) **kannst du selbst wählen**. Standard: Name *Friday*,
Wake Word *„Hey Friday“*.

- **Dein Wake Word** („Hey Friday“, „Computer“, „Guten Morgen Friday“ …) – reagiert nur auf **deine** Stimme
- schnelle Antworten lokal auf deinem PC (Qwen3-4B), alles Komplexe über **Kimi K3**
- **Hermes Agent** als „Gehirn“ mit Werkzeugen, Kanban-Board und Dashboard
- **F.R.I.D.A.Y. Command Center**: dein Dashboard mit Orb, Aufgaben, Aktivität und Systemstatus unter <http://127.0.0.1:3100>
- startet automatisch bei jeder Anmeldung

---

## Vorher erledigen (5 Minuten)

1. **Windows 11** (Windows 10 geht eingeschränkt), alle Updates installiert.
2. **NVIDIA-Grafiktreiber** aktuell (GeForce Experience / NVIDIA App). Ohne NVIDIA läuft der Assistent auch, nur langsamer.
3. Dein Windows-Benutzer muss **Administrator** sein.
4. **Kimi-API-Schlüssel** bereithalten. Hat eine frühere Kimi-Code-Einrichtung auf diesem PC die Umgebungsvariable
   `KIMI_API_KEY` gesetzt, findet der Installer sie und fragt in Schritt 10 zur Bestätigung (*„Verwenden? (j/n)“*).
   Sonst (oder bei *n*) fragt er nach dem Schlüssel (Eingabe bleibt unsichtbar).
5. **Mikrofon und Lautsprecher** angeschlossen, ruhiger Raum für die Stimmaufnahme.
6. Mindestens **40 GB frei** auf C:, stabile Internetverbindung (ca. 10 GB Downloads).
7. Das **komplette Paket** entpacken (nicht nur den Ordner `installer`): für das Command Center müssen die Ordner `apps`,
   `packages`, `adapters` und `config` neben `installer` liegen. Der entpackte Ordner muss bis zum Ende der Installation
   (auch nach dem WSL-Neustart) an seinem Platz bleiben. Für Node.js wird `winget` (App-Installer, bei Windows 11 dabei) gebraucht.

## Installation

1. ZIP entpacken (Rechtsklick → *Alle extrahieren*), z. B. in *Downloads*.
2. **Doppelklick auf `install-friday.bat`** → Frage nach Administratorrechten mit *Ja* bestätigen.
   Gibt es auf dem PC schon eine Installation der früheren Version in `C:\Jarvis`, bietet der Installer zuerst an, sie zu
   **übernehmen** (siehe Abschnitt „Frühere Installation übernehmen“).
3. Den Anweisungen im Fenster folgen. Du wirst gefragt nach:
   - dem **Namen deines Assistenten** (Enter = *Friday*). Das kommt **zuerst**, noch vor jeder Stimmaufnahme.
     Erlaubt sind 2–20 Buchstaben (auch Umlaute), keine Leerzeichen oder Zahlen.
   - deinem **Wake Word**: *„Mit welchem Wort oder Satz soll <Name> geweckt werden?“* (Enter = *Hey <Name>*). Das Wake Word wird
     **immer frei gefragt**, nicht aus dem Namen abgeleitet. Erlaubt sind 1–4 Wörter (Buchstaben, auch Umlaute, und Bindestrich),
     zusammen 3–30 Zeichen, z. B. *Hey Friday*, *Computer*, *Guten Morgen Friday*.
   - der **Ausgabestimme**: weibliche F.R.I.D.A.Y.-Stimme aus einer eigenen 3–30 Sekunden langen MP3/WAV-Referenz
     über lokales Qwen3-TTS oder klassische Ausgabe. Die Referenz bleibt nur auf deinem Rechner. Ohne Referenz
     nutzt die weibliche Option Piper Kerstin. Die klassische Ausgabe nutzt `jarvis_de.onnx`, wenn du diese eigene
     Datei samt `.json` bereitstellst; im Paket liegt derzeit keine solche Datei, daher nutzt sie sonst Thorsten mit Filmfilter.
   - deinem **Vornamen** und wie dein Assistent dich ansprechen soll (z. B. *„Sir“* wie ein britischer Butler)
   - dem **Charakter** (Butler / freundlich / sachlich) und wie ausführlich er antwortet
   - optional ein paar Infos über dich (Beruf, Interessen …)
   - einem **Linux-Benutzernamen und Passwort** (gut merken!)
   - deinem **Kimi-Schlüssel** (Bestätigung eines gefundenen Schlüssels oder Eingabe)
   - den **Command-Center-Zugang** richtest du nach der Installation beim ersten Öffnen im Browser selbst ein: Anzeigename,
     Benutzername und Passwort (mindestens 12 Zeichen). Gespeichert wird nur ein Hash, nie das Passwort selbst.
4. **Neustart:** Falls WSL noch fehlt, startet Windows einmal neu. Danach geht es **automatisch weiter**.
5. **Stimmaufnahme (ca. 10 Minuten):** Ein eigenes Fenster öffnet sich. Nach jedem **Piepton** sagst du, was dort
   steht: 26× dein Wake Word (z. B. „Hey Friday“), 18× die Kurzform ohne „Hey“ (z. B. „Friday“; bei Wake Words ohne Grußwort
   entfällt sie, dann 44× das Wake Word), 15 ähnlich klingende Wörter bzw. Teile der Phrase (z. B. *Freitag*, *Frieda*,
   *Feierabend* – das sind Gegenbeispiele und **nicht** dein Wake Word), 8 kurze Texte vorlesen.
   Danach lernt der Rechner dein Wake Word (außer bei „Hey Jarvis“ einige Minuten Rechenzeit, ohne Internet).
6. Danach richtet der Installer das **Command Center** ein (Schritt 15: Node.js und pnpm, Kopieren nach `C:\Friday\dashboard`,
   Bauen, Start; beim ersten Mal einige Minuten und Internet nötig). Am Ende **begrüßt dich dein Assistent** und auf Wunsch
   öffnet sich das Command Center.

Dauer gesamt: ca. 45–90 Minuten. Bricht etwas ab: Fehler beheben und **`install-friday.bat` einfach nochmal
starten** – erledigte Schritte werden übersprungen.

## Präsentationen mit dem Hermes-PowerPoint-Skill

Der Installer legt für den Hermes-Standardskill bei Bedarf eine eigene WSL-Python-Umgebung mit `python-pptx` an. Wenn der Skill in Hermes aktiviert ist, kann der Besitzer unter **Skills → PowerPoint** einen Titel und Folien eingeben und die lokal erzeugte `.pptx`-Datei herunterladen. Die Dateien liegen privat; nach sieben Tagen endet der Download, und beim nächsten Zugriff oder Erstellen sowie bei Erreichen der Speichergrenze wird aufgeräumt. Prüfe die Voraussetzung in deiner Friday-WSL-Distribution mit `~/.local/share/friday/powerpoint-venv/bin/python -c "import pptx"`; falls eine bestehende Python-Umgebung genutzt wird, funktioniert auch `python -c "import pptx"`. Falls sie später repariert werden muss, starte `install-friday.ps1 -UpdateDashboard -InstallRoot 'C:\Friday'` erneut (bei einem anderen Installationsordner den Pfad anpassen). Ein vorhandener eigener `python`-Befehl wird vom Installer nicht überschrieben.

Per Sprache geht eine kurze Präsentation mit einer Inhaltsfolie: „Erstelle eine PowerPoint mit Titel Quartalsbericht und Folie Ergebnisse mit Punkt eins Umsatz gestiegen und Punkt zwei Kosten gesunken.“ Bis zu fünf Punkte müssen in der Reihenfolge „Punkt eins“ bis „Punkt fünf“ genannt werden. Friday liest den vollständigen Auftrag vor; erst ein erneutes, sprechergeprüftes „Ja“ nach der Ansage erstellt die Datei. „Nein“ verwirft ihn. Die Datei erscheint unter **Skills → PowerPoint → Zuletzt erstellt** und lässt sich dort geschützt herunterladen. Ein gesprochener Auftrag benötigt den lokal laufenden Friday-Sprachdienst; ohne bestätigten Hermes-PowerPoint-Skill wird nichts erstellt.

Für Bildvorschau und PDF-Export kannst du **optional** LibreOffice Impress und Poppler in der gespeicherten Friday-WSL-Distribution installieren. Öffne PowerShell im `installer`-Ordner und starte:

```powershell
.\setup-powerpoint-renderer.ps1
```

Bei einem anderen Installationsort ergänze beispielsweise `-InstallRoot 'D:\Kali\Friday'`. Das Skript liest Distribution und Linux-Benutzer aus `config\install-state.json`, prüft das Ziel und installiert mit WSL-root nur `libreoffice-impress` und `poppler-utils` samt notwendigen Abhängigkeiten, ohne empfohlene Zusatzpakete. Dafür sind Internetzugang und zusätzlicher Speicherplatz nötig; bestehende Pakete werden nicht entfernt. Prüfe danach in der Friday-Distribution `soffice --version` und `pdftoppm -v`. Diese Befehle bestätigen nur die Werkzeuge; einen konkreten Foliensatz solltest du bei Bedarf rendern und ansehen.

## Benutzung

- **Dein Wake Word** (z. B. „Hey Friday“) → kurzer Piepton → deine Frage, z. B. *„Wie spät ist es?“*
- **Folgefragen** gehen 90 Sekunden lang ohne erneutes Wake Word.
- **Unterbrechen:** während dein Assistent spricht einfach das Wake Word sagen.
- Einfache Dinge (Uhrzeit, Rechnen, Wissen) beantwortet er sofort lokal. Aufgaben mit Mails, Kalender,
  Recherche oder Analysen gehen an Kimi K3 – dann sagt er kurz „Einen Moment“ bzw. meldet sich, wenn es fertig ist.
- **Command Center:** <http://127.0.0.1:3100> – beim ersten Öffnen richtest du deinen Zugang ein. Danach kannst du
  „Angemeldet bleiben“ für 30 Tage wählen oder in den Sicherheitseinstellungen die Anmeldung für rein lokalen Zugriff ausschalten. Startet automatisch bei der
  Anmeldung (Aufgabe `FRIDAY_Dashboard`, ca. 1 Minute nach dem Anmelden). Zeigt Aufgaben, Aktivität und Agenten live aus Hermes,
  Sprachstatus und Systemdaten. Weitere Bereiche verwenden Simulation, bis der jeweilige reale Adapter eingerichtet und ausdrücklich aktiviert ist; Mail-Lesen und Kalender-Lesen haben unten beschriebene optionale Zugänge.
- **Hermes-Dashboard:** <http://127.0.0.1:43691> (Kanban-Boards, Einstellungen, Verlauf)
- Fremde Stimmen, Kinder oder der Fernseher werden ignoriert (Stimmprüfung).

## Wichtige Orte

| Was | Wo |
|---|---|
| Alles vom Assistenten | `C:\Friday` (frühere Version: `C:\Jarvis`, siehe „Frühere Installation übernehmen“) |
| Persönlichkeit ändern | `C:\Friday\config\persona.json`, danach Schritt erneut: siehe unten |
| Sprach-Einstellungen (Name, Wake Word, Engine) | `C:\Friday\config\voice.json` (Wake Word: `wake_phrase`; Auswahl in `install-state.json` und `persona.json`) |
| Dein persönliches Wake-Word-Modell | `C:\Friday\models\openwakeword\personal_wake.npz` und `personal_wake.json` (Phrase, Schwelle, Qualität) |
| Protokolle | `C:\Friday\logs` (Command Center: `dashboard-install.log`, `dashboard-service.log`, `dashboard\`; Watchdog: `watchdog.log`) |
| Command Center (Programm, Daten, Sicherungen) | `C:\Friday\dashboard` (`data`, `backups`) |
| Command-Center-Einstellungen (Modus, Port, Adapter) | `C:\Friday\dashboard\config\dashboard.yaml` und `adapters.yaml` – Installer überschreibt sie nie ohne Rückfrage |
| Passwort-Hash des Command Centers | `C:\Friday\config\dashboard_owner.hash` (nur du hast Zugriff) |
| Austauschordner mit dem Assistenten | `C:\Friday\exchange` |
| Status | `C:\Friday\INSTALL_STATE.md` |

**Persönlichkeit neu einstellen:** In `C:\Friday\config\install-state.json` die Einträge `"persona"`, `"hermes"` und
`"voicepython"` aus der Liste `done` löschen und `install-friday.bat` erneut starten.
**Ausgabestimme später wechseln:** `change-voice.bat` starten. Der Installer lädt bei Bedarf die gewählte Stimme und
startet den Sprachdienst neu; persönliche Wake-Word-Aufnahmen bleiben erhalten.
Die lokale Qwen3-TTS-Stimme benötigt zwei geprüfte Modelldateien (zusammen etwa 1,5 GB) und `llama-tts.exe`.
Sie kann mehrere Sekunden Verzögerung pro Antwort verursachen; bei einem Synthesefehler wird die Piper-Basisstimme verwendet.
**Stimme / Wake Word neu einlernen (gleicher Name und gleiches Wake Word):** Ordner `C:\Friday\voice\profiles\owner` löschen, die Einträge
`"enroll"` und `"voiceservice"` aus `done` entfernen, `install-friday.bat` erneut starten (der alte Sprachdienst samt Neustartschleife wird dabei beendet).
**Sprachdienst stoppen:** Nicht nur die Aufgabe `FRIDAY_Voice` beenden – eine Neustartschleife läuft getrennt weiter und startet Python nach 10 s neu.
Der Installer beendet beides; manuell: in der Aufgabenverwaltung den `powershell`-Prozess mit `start-friday-voice.ps1` und `python.exe` mit `friday_voice.py` beenden.
**Update des Sprachdienstes:** Neues Paket entpacken und `install-friday.bat` starten – geänderte Sprachdateien werden bei jedem Start nach `C:\Friday\voice` kopiert (Profile und Modelle bleiben) und der laufende Sprachdienst wird neu gestartet.

## Service-Watchdog (startet abgestürzte Dienste neu)

Der Installer richtet am Ende die Aufgabe `FRIDAY_Watchdog` ein. Sie läuft bei der Anmeldung und danach alle 5 Minuten, prüft
Sprachdienst (Port 43694), Qwen (43692) und Command Center (Port aus `dashboard.yaml`, Standard 3100) und startet einen
Dienst über seine Aufgabe (`FRIDAY_Voice`, `FRIDAY_Qwen`, `FRIDAY_Dashboard`) neu, **wenn** sein Port nicht antwortet **und** kein
zugehöriger Prozess läuft. Wenn der Prozess noch läuft (z. B. beim Laden der Sprachmodelle, bis zu 3 Minuten), greift der Watchdog
nie ein und beendet auch nie einen Prozess. Weitere Bremsen: Während der Installer läuft, tut der Watchdog nichts; ein absichtlich
gesetztes Stop-Flag (`C:\Friday\run\<Skript>.stop`, setzt der Installer bei Updates) wird respektiert; zwischen zwei Neustarts
desselben Dienstes liegen mindestens 10 Minuten, höchstens 3 pro Stunde (danach nur eine Warnung im Log).

- **Log:** `C:\Friday\logs\watchdog.log` (eine Zeile je Neustart oder Warnung, stündlich eine Zeile „Heartbeat“, Rotation bei 1 MB auf `.1`).
- **Unsichtbar:** Die Aufgabe startet über `hidden.vbs` (wie die anderen FRIDAY-Aufgaben). Es darf nie ein Fenster aufblitzen –
  auch nicht alle 5 Minuten. Blitzt doch eines auf, in der Aufgabenplanung die Aktion von `FRIDAY_Watchdog` prüfen: sie muss
  `wscript.exe //B //Nologo "C:\Friday\installer\scripts\hidden.vbs" "C:\Friday\installer\scripts\friday-watchdog.ps1"` lauten
  (nicht `powershell.exe` direkt); sonst `install-friday.bat` erneut starten, das registriert die Aufgabe neu.
- **Dienst absichtlich ausgeschaltet lassen** (z. B. Test eines Ausfalls): vorher den Watchdog anhalten –
  `schtasks /change /tn FRIDAY_Watchdog /disable`, später `/enable`.
- **Alte Aufgabe:** Ein früherer Installer kann eine Aufgabe `JARVIS_Voice_Watchdog` angelegt haben. Der neue Installer lässt sie
  unangetastet; wird sie nicht mehr gebraucht (besonders wenn sie ein Konsolenfenster aufblitzen lässt), von Hand löschen:
  `schtasks /delete /tn JARVIS_Voice_Watchdog /f`.

## Optionale Coding-CLIs in Friday-Ubuntu

Die Hermes-Skills für OpenCode, Codex und Claude Code benötigen das jeweilige **Linux-Programm** im selben WSL-Benutzer wie Hermes. Ein über WSL sichtbarer Windows-Befehl reicht nicht. Friday installiert diese externen Werkzeuge nicht automatisch und übernimmt keine Windows-Anmeldungen.

Öffne PowerShell im installierten `installer`-Ordner und wähle genau das Werkzeug, das du nutzen willst:

```powershell
.\setup-coding-cli.ps1 -Cli status
.\setup-coding-cli.ps1 -Cli opencode
.\setup-coding-cli.ps1 -Cli codex
.\setup-coding-cli.ps1 -Cli claude
.\setup-coding-cli.ps1 -Cli codex -Login
.\setup-coding-cli.ps1 -Cli claude -Login
```

Bei anderem Installationsort zusätzlich `-InstallRoot 'D:\Kali\Friday'` angeben. Das Skript liest WSL-Distribution und Linux-Benutzer aus dem lokalen Installationszustand. Es lädt Node.js bei Bedarf mit SHA-256-Prüfung in dessen Benutzerprofil und installiert nur die gewählte CLI dort. Es ändert keine Windows-CLI-Konfiguration und fragt keine Zugangsdaten ab. `-Cli status` prüft nur, ob Linux-Befehle starten und eine Version liefern. Mit `-Login` startest du die interaktive Anbieteranmeldung in Friday-Ubuntu: Codex über dein unterstütztes ChatGPT-Konto, Claude Code über dein Claude-Pro-/Max-Konto. Folge dem angezeigten Browser- oder Gerätecode auf deinem eigenen Rechner; Friday speichert kein Abo-Passwort. Ein Abo-Login für diese CLIs ist kein allgemeiner API-Zugang für Friday. Danach kann ein kleiner Coding-Auftrag mit deinem Konto geprüft werden; gehostete Nutzung unterliegt den jeweiligen Limits und möglichen Kosten.

## Optionales IMAP-/SMTP-Postfach

Installiere die geprüfte Himalaya-CLI für den Friday-Linux-Benutzer aus dem installierten Friday-Ordner:

```powershell
.\installer\setup-himalaya.ps1 -Action install -InstallRoot 'C:\Friday'
```

Bei anderem Installationsort den Pfad anpassen. Danach unter **Einstellungen → Skill-Konten → E-Mail-Postfach für Himalaya** E-Mail-Adresse, IMAP-/SMTP-Server und Ports, Benutzername, Passwort oder App-Passwort sowie die Ordnernamen eintragen. Das Speichern legt eine lokale Konfiguration mit getrennten 0600-Passwortdateien an. Bei der Installation der CLI und bei Friday-Skills-Updates wird der gebündelte Hermes-Mail-Skill nur dann auf Himalaya-v2-Befehle umgestellt, wenn seine geprüfte Originalversion und Himalaya 2.2.1 vorliegen; die Originaldateien werden unter `~/.hermes/backups/friday-himalaya-v1/` gesichert. Abweichende Versionen bleiben unangetastet. In **Kommunikation → Live-Postfach öffnen** kann der Besitzer danach den IMAP-Zugriff auslösen, Ordner und Nachrichten lesen und das Postfach wieder schließen. Das Lesen setzt keine Gelesen-Markierung. Eine reine Textmail kann nach Vorschau und ausdrücklicher Bestätigung über SMTP gesendet werden; bei unklarem Ergebnis wiederholt Friday denselben Auftrag nicht automatisch. Das Speichern prüft nur die Konfigurationssyntax. Danach kann der Besitzer im selben Formular per IMAP-Lesetest die Ordner beim Anbieter abfragen; SMTP und Versand bleiben dabei ungeprüft. Konten mit verpflichtendem OAuth, darunter viele Microsoft-Konten, lassen sich mit dieser Passwortmaske nicht anmelden. Die übrige Dashboard-Kommunikationsansicht verwendet weiterhin ihren separaten Adapter.

## Automatische Terminerinnerung per Telefon

Der Owner kann unter **Einstellungen → Skill-Konten → CloudTalk Desktop und API** einen CloudTalk-VoiceAgent mit eigenem API-Schlüsselpaar und einer bestätigten E.164-Rufnummer einrichten. Die Funktion ist anfangs ausgeschaltet. Nach Aktivierung fragt Friday für künftige Termine aus seinem lokalen Kalender einen VoiceAgent-Anruf an, standardmäßig 15 Minuten vor Beginn. Der deutsche VoiceAgent-Prompt kann den Termin nennen, 15 Sekunden zuhören und auf eine Antwort reagieren. Friday ruft während 20–8 Uhr in der Termin-Zeitzone nicht an und begrenzt die Anfrage auf fünf Versuche pro Stunde. Bei unklarem Provider-Ergebnis wird derselbe Terminstand nicht erneut angerufen. Ein angenommener Anruf oder Gesprächsverlauf ist damit noch nicht nachgewiesen. Externe ICS- und CalDAV-Termine sind derzeit nicht Teil dieser automatischen Anrufe. Im aktuellen CloudTalk-Konto ist die API-Schlüsselerstellung gesperrt (`API_STATUS_IS_NOT_ENABLED`); der VoiceAgent-Pfad braucht diesen Zugang und wurde nicht live ausgeführt.

## Kalender aus ICS lesen oder CalDAV verwenden

Der Installer aktiviert für Hermes den read-only Skill `friday_calendar_events`. Er verwendet den im Friday Dashboard eingerichteten Kalender über eine eigene lokale Dienstkennung. Hermes erhält weder Kalender-URL noch Anbieterpasswort; ohne funktionierendes Dashboard meldet das Tool einen Fehler statt erfundener Termine.

Öffne als Besitzer **Einstellungen → Adapter → Kalender verbinden**. Für einen freigegebenen Kalender wähle **iCalendar/ICS** und gib die private HTTPS-ICS-URL ein. Bei Google steht sie unter „Kalender integrieren → Geheimadresse im iCal-Format“, bei Outlook.com unter „Freigegebene Kalender → Kalender veröffentlichen → ICS“. Die URL ist wie ein Passwort zu behandeln; besonders ein veröffentlichter Outlook-Link kann von jedem mit dem Link gelesen werden. Für einen kompatiblen privaten CalDAV-Server wähle **CalDAV** und gib die HTTPS-URL der Kalendersammlung mit abschließendem `/`, Benutzername und Passwort oder App-Passwort ein. Friday speichert diese Angaben lokal verschlüsselt. ICS bleibt lesend. Mit CalDAV kann der Besitzer nach Vorschau und eigener Bestätigung einen neuen Termin anlegen; die allgemeine Freigabeseite führt diese Live-Aktion noch nicht aus. Bei unklarem Ergebnis erst den Kalender beim Anbieter prüfen, denn Friday wiederholt denselben Schreibversuch nicht automatisch. Bestehende Termine ändern oder löschen ist noch nicht möglich. Google Calendar verlangt für direkten CalDAV-Zugriff OAuth 2.0; private Outlook-Kalender benötigen Microsoft Graph/OAuth. Diese Konten lassen sich mit der CalDAV-Passwortmaske nicht direkt anmelden. Die frühere Windows-Kalender-App ist kein eigener Kalenderdienst.

## Command Center aktualisieren

Neues Paket entpacken und darin `update-dashboard.bat` doppelklicken (liegt neben `install-friday.bat`). Das Skript kopiert die
neuen Quellen nach `C:\Friday\dashboard`, baut nur neu, wenn sich etwas geändert hat, und startet das Command Center neu.
Einstellungen, Daten und Passwort bleiben erhalten. Technische Details, manuelle Befehle und Fehlersuche: `docs/DEPLOYMENT.md`.

## Name und Wake Word

**Standard:** Name *Friday* (F.R.I.D.A.Y.), Wake Word **„Hey Friday“**. Der Installer fragt Name **und** Wake Word **vor der ersten
Aufnahme**; alles Weitere (Stimmaufnahme, Persönlichkeit, Sprachdienst) richtet sich nach diesen Antworten. Das Wake Word ist
unabhängig vom Namen frei wählbar (1–4 Wörter, Buchstaben/Umlaute/Bindestrich, 3–30 Zeichen), Vorgabe ist „Hey <Name>“.

**Name und/oder Wake Word später ändern:** `change-assistant-name.bat` doppelklicken (liegt neben `install-friday.bat`, in
`C:\Friday\installer`). Das Skript fragt den neuen Namen und das neue Wake Word (Enter = beibehalten), passt die Persönlichkeit an
und wiederholt Stimmaufnahme, Wake-Word-Training und Sprachdienst (ca. 15 Minuten). Bleibt beides gleich, kannst du nur die Aufnahme
wiederholen. Solange noch **keine** Aufnahmen existieren, fragt `install-friday.bat` beim erneuten Start ohnehin, ob Name und
Wake Word bleiben.

**So erkennt der Assistent sein Wake Word:**

- **Wake Word exakt „Hey Jarvis“** (Groß-/Kleinschreibung egal): vortrainiertes openWakeWord-Modell *hey_jarvis* plus ein auf deine
  Stimme trainierter Verifier. Nur diese Phrase nutzt das fertige Modell, **nicht** der Name „Jarvis“ allein.
- **Jedes andere Wake Word (auch „Hey Friday“):** für beliebige Wörter und Sätze gibt es kein vortrainiertes Modell. Deshalb lernt der
  Rechner dein Wake Word aus **deinen eigenen Aufnahmen** (komplett lokal):
  1. *Stufe 1 – Klangmuster:* ein kleines Modell auf den Audio-Merkmalen von openWakeWord vergleicht laufend die letzten
     ~1 Sekunde mit deinem Wake Word (z. B. „Hey Friday“ und der Kurzform „Friday“; deine 44 Aufnahmen, ähnlich klingende Wörter
     bzw. Teile der Phrase und Lesetexte als Gegenbeispiele; mit Piper-Stimme zusätzlich erzeugte Beispiele). Die Schwelle wird beim
     Einlernen an ungesehenen Aufnahmen kalibriert (Ziel: ca. 9 von 10 Aufrufen, möglichst wenige Fehlauslösungen).
  2. *Stufe 2 – Phrasencheck:* nur wenn Stufe 1 anschlägt, hört die Spracherkennung (faster-whisper) kurz in die letzten
     2 Sekunden und vergleicht das Transkript mit dem **ganzen Wake Word**: Wort für Wort in der richtigen Reihenfolge, tolerant
     gegenüber kleinen Erkennungsfehlern (Umlaute, Groß-/Kleinschreibung, klangliche Varianten wie *Fraidei* für *Friday*,
     getrennt oder zusammen geschriebene Wörter). Beginnt das Wake Word mit einem Grußwort („Hey“, „Hallo“, „OK“ …), genügt auch
     die Kurzform („Friday“). Bei Wake Words mit mindestens drei Wörtern darf das erste fehlen. Ähnliche, aber falsche Wörter
     (z. B. *Freitag*, *Frieda*) zählen nicht; für eigene Wake Words leitet der Installer solche Sperrwörter aus klangnahen Vornamen
     ab. Anpassbar in `voice.json`: `wake_aliases`, `wake_reject_words`, `wake_match_max_dist`, `wake_confirm` (Check aus/an),
     `wake_confirm_languages`.
  3. *Stufe 3 – Stimmprüfung:* wie bisher darf nur **deine** Stimme etwas auslösen.

  Ehrlich gesagt: Das selbst gelernte Wake Word ist **weniger treffsicher** als das fertige „Hey Jarvis“-Modell. Es
  kann mal nicht reagieren (dann einfach noch einmal, etwas deutlicher sagen) oder in seltenen Fällen anspringen – Stufe 2
  und die Stimmprüfung verhindern, dass daraus Befehle werden. **Tipps:** ein Wake Word mit mindestens zwei Silben, das nicht
  wie häufige deutsche Wörter klingt (ein Satz aus zwei bis drei Wörtern wird zuverlässiger erkannt als ein kurzes Einzelwort);
  ruhige Umgebung beim Einlernen; nicht flüstern. Meldet der Installer, das Wake Word sei „noch unsicher erkennbar“,
  Aufnahme wiederholen oder ein markanteres Wake Word wählen.
- **Status prüfen:** <http://127.0.0.1:43694> zeigt u. a. `assistant_name`, `wake_phrase`, `wake_engine`
  (`openwakeword` oder `personal`) und `wake_rejected` (von Stufe 2 abgewiesene Auslösungen).

## Frühere Installation übernehmen (C:\Jarvis → C:\Friday)

Die frühere Version dieses Pakets (J.A.R.V.I.S.) installierte nach `C:\Jarvis`. Findet `install-friday.bat` dort eine Installation
(`C:\Jarvis\config\install-state.json`) und noch **kein** `C:\Friday`, fragt es: *„Bestehende Installation nach C:\Friday übernehmen?
(j/n)“* (Enter = ja). Bei *ja*:

1. **Alte Dienste anhalten:** die alte Watchdog-Aufgabe zuerst, dann Sprachdienst, Qwen und Command Center (mit den alten
   Namen). Nichts wird dabei gelöscht.
2. **Kopieren:** Stimmprofil, Wake-Word-Modell, Persönlichkeit, Modelle, Hermes-Zugang, Command-Center-Konfiguration und -Daten
   werden nach `C:\Friday` kopiert. `C:\Jarvis` bleibt **unverändert** als Sicherung (bis auf eine Migrationsdatei und ein Protokoll).
   Das Command-Center-Programm wird nicht kopiert, sondern in Schritt 15 neu gebaut (Internet nötig, einige Minuten).
3. **Pfade umschreiben:** `C:\Jarvis` und `/mnt/c/Jarvis` in den kopierten Zustands- und Konfigurationsdateien (u. a.
   `install-state.json`, `voice.json`, `persona.json`, `dashboard.yaml`, `adapters.yaml`).
4. **Aufgaben umstellen:** die alten `JARVIS_*`-Aufgaben dieses Installers werden als XML gesichert (`C:\Jarvis\migration-tasks`) und
   entfernt, `FRIDAY_*`-Aufgaben werden eingerichtet. **Fremde Aufgaben** (z. B. `JARVIS_Voice_Watchdog` eines älteren Installers,
   der alle 5 Minuten den alten Sprachdienst auf Port 43694 neu startet), deren Aktion `C:\Jarvis` nennt, listet der Installer mit
   ihrer Aktion auf und fragt (Standard *ja*), ob er sie **deaktivieren** soll. Er sichert sie vorher als XML
   (`C:\Jarvis\migration-tasks\foreign-*.xml`) und **löscht nie** eine fremde Aufgabe. Am Ende nennt er die deaktivierten Aufgaben mit dem
   Befehl zum Wieder-Aktivieren (`Enable-ScheduledTask -TaskName '<Name>'`, PowerShell als Administrator). Bei *nein* bleiben
   sie aktiv und können den alten Dienst gegen den neuen antreten lassen. **Ein TTS-Server auf Port 43695** aus der alten Installation
   wird **nicht** übernommen; er gehört nicht zu diesem Installer und muss von Hand auf `C:\Friday` umgestellt werden.
5. **Hermes in Ubuntu umstellen:** Pfade und Modellname (`friday`) in der Hermes-Konfiguration und den Diensten, `~/jarvis` →
   `~/friday`, Persönlichkeitsdatei neu erzeugt. Hermes wird **nicht** neu installiert, der Kimi-Schlüssel bleibt.
6. Danach läuft der normale Installer weiter (Sprachdienst und Command Center werden neu eingerichtet; funktioniert die kopierte
   Python-Umgebung am neuen Ort nicht, baut Schritt 12 sie neu auf).

Am Ende nennt der Installer, dass `C:\Jarvis` als **Sicherung** erhalten bleibt. Erst prüfen, ob alles läuft (Wake Word, Command
Center, Hermes-Dashboard), dann in einer PowerShell als Administrator `Remove-Item -Recurse -Force C:\Jarvis`.

Bei *nein* richtet der Installer F.R.I.D.A.Y. frisch in `C:\Friday` ein; auf Wunsch hält er die alten Dienste an und deaktiviert ihre
Aufgaben (auch fremde, die auf `C:\Jarvis` zeigen, nach Rückfrage und mit XML-Sicherung), damit sie nicht dieselben Ports (43691–43694, 3100) belegen. Ein Abbruch mitten in der Übernahme ist unkritisch:
`install-friday.bat` erneut starten, jede Phase wird einzeln fortgesetzt.

## Wenn etwas nicht geht

| Problem | Lösung |
|---|---|
| Der Assistent reagiert nicht | <http://127.0.0.1:43694> öffnen – steht dort `listening`? Sonst abmelden/anmelden. Log: `C:\Friday\logs\voice-service.log` |
| Ein Dienst fällt immer wieder aus | `C:\Friday\logs\watchdog.log` lesen (Neustarts, „Maximum erreicht“-Warnungen); Log des Dienstes prüfen (`voice-service.log`, `qwen-server.log`, `dashboard-service.log`) |
| Reagiert auf das Wake Word (Piepton), antwortet aber nicht | Deine Stimme wurde evtl. nicht erkannt: näher ans Mikrofon, normal laut sprechen |
| „Der Cloud-Agent ist nicht verfügbar“ | Internet prüfen; in Ubuntu: `hermes status` |
| Hermes-Dashboard (43691) lädt nicht | Ubuntu-Fenster öffnen: `systemctl --user status hermes-dashboard` |
| Command Center (3100) lädt nicht | Aufgabenplanung: `FRIDAY_Dashboard` ausführen; Log `C:\Friday\logs\dashboard-service.log`. Hilft das nicht: `install-friday.bat` erneut starten (Schritt 15 wird wiederholt) |
| Installer meldet „Port 3100 ist belegt“ | Das genannte Programm beenden oder in `C:\Friday\dashboard\config\dashboard.yaml` einen anderen `server.port` eintragen (Installer und Autostart lesen den Port von dort), `install-friday.bat` erneut starten |
| Schritt 15: „pnpm install“/Build fehlgeschlagen | Internet prüfen, Details in `C:\Friday\logs\dashboard-install.log`, dann `install-friday.bat` erneut starten |
| Command-Center-Passwort vergessen | In `C:\Friday\config\install-state.json` den Eintrag `"dashboard"` aus `done` löschen, `install-friday.bat` starten und beim Passwort „Neu setzen“ mit `j` beantworten |
| Wake Word wird oft überhört / spricht ohne Grund an | Eigenes Wake Word: Aufnahme in ruhigerer Umgebung wiederholen oder ein markanteres Wake Word wählen (siehe oben). Im Log `C:\Friday\logs\voice.jsonl` zeigt `wake_rejected`, wie oft Stufe 2 eine Fehlauslösung abgefangen hat |
| Spiel ruckelt / Grafikspeicher voll | In `voice.json` bei `"game_processes"` das Spiel eintragen, z. B. `["Diablo IV.exe"]` |

## Was noch manuell kommt (Schritt für Schritt mit dem Assistenten/Kimi)

Die verfügbaren Konten und Nachrichten-Gateways richtest du im Friday Dashboard unter **Einstellungen → Skill-Konten** ein:

- **Telegram:** Erstelle einen Bot bei @BotFather und trage dessen Bot-Token sowie deine numerische Telegram-User-ID ein. Friday speichert die Angaben lokal und startet beim Speichern das Hermes-Gateway neu. Das bestätigt noch keine Verbindung zu Telegram oder erfolgreiche Zustellung.
- **Discord:** Erstelle im Discord Developer Portal einen Bot, aktiviere den Message Content Intent und lade ihn auf deinen Server ein. Trage Bot-Token und numerische User-ID ein; Kanal-IDs kannst du optional einschränken. Gespeicherte Einstellungen und ein laufendes Gateway belegen noch keine Verbindung oder Zustellung bei Discord.
- **WhatsApp:** Öffne über den Link in den Friday-Einstellungen das lokale Hermes-Dashboard und melde dich dort an. Unter **Channels → WhatsApp** koppelst du das Telefon mit dem angezeigten QR-Code. Kehre dann zu Friday zurück und speichere den Modus sowie deine Telefonnummer mit Ländervorwahl, ohne `+`. Eine lokale Session-Datei allein bestätigt keine aktive WhatsApp-Verbindung.
- **E-Mail:** Für IMAP/SMTP-Setup und den getrennten IMAP-Lesetest siehe oben **Optionales IMAP-/SMTP-Postfach**. Das Speichern prüft die Konfiguration; SMTP und Versand werden dadurch nicht getestet.
- **Kalender:** Für ICS und CalDAV siehe oben **Kalender aus ICS lesen oder CalDAV verwenden**. Der dort beschriebene Anschluss und seine Schreibgrenzen gelten weiterhin.
- **Telefonie:** Der optionale [Asterisk-SIP-Einrichtungsweg](wsl/TELEPHONY.md) erlaubt einen vom Owner einzeln bestätigten Ruf von seiner SIP-Nebenstelle zu einer lokalen Nebenstelle oder über einen eigenen registrierten Trunk zu einer externen Nummer. Asterisk und SIP-Konto sind in der Testinstallation nicht eingerichtet; ein echter Anruf und Fridays Sprachdialog im Telefonat sind noch nicht abgenommen.

**CloudTalk Desktop:** App auf Windows installieren, anmelden, Agent auf Online stellen und zugewiesene Rufnummer prüfen. Unter **CloudTalk Phone → Settings → Calls → Call Automation** „Automatically dial Click-to-call numbers“ aktivieren. Dann „Rufe +491701234567 über CloudTalk an“ sagen; Friday liest die Nummer vor und übergibt sie erst nach einem zweiten sprechergeprüften „Ja“ an die App. Im lokalen Testprofil erreichte dieser Weg die freigegebene Mailbox; ohne Auto-Dial wurde die Nummer nur eingetragen. Friday erhält keinen Gesprächsstatus, kein Audio und keine Auflegen-Funktion. **CloudTalk-API:** Unter **Einstellungen → Skill-Konten → CloudTalk Desktop und API** können Admin-Access-Key-ID, Secret und Agent-ID verschlüsselt eingerichtet werden. Die API ruft zuerst den Agenten an, der binnen 20 Sekunden abheben muss, danach das Ziel. Im aktuellen Testkonto meldet die Schlüsselerstellung `API_STATUS_IS_NOT_ENABLED`; ein API-Live-Ruf wurde nicht getestet. Der SIP/Asterisk-Adapter bleibt separat verfügbar.

Regel: Lesen/Entwürfe macht der Assistent selbst. **Senden, Löschen, Termine ändern, Zahlungen nur nach deiner Bestätigung.**

## Deinstallation

Aufgabenplanung: `FRIDAY_Voice`, `FRIDAY_Qwen`, `FRIDAY_WSL_Keepalive`, `FRIDAY_Dashboard`, `FRIDAY_Watchdog` löschen (zuerst `FRIDAY_Watchdog`, sonst startet er Dienste neu) → PowerShell: `wsl --unregister Ubuntu`
(löscht Ubuntu samt Hermes!) → Ordner `C:\Friday` löschen. Eine frühere Installation `C:\Jarvis` (Sicherung nach der Übernahme) gleichermaßen.

---

*Technik: Windows 11 + WSL2 (Ubuntu 24.04, systemd) · Hermes Agent · Kimi K3 · llama.cpp + Qwen3-4B ·
openWakeWord („Hey Jarvis“ + Verifier bzw. persönliches Wake Word auf openWakeWord-Features) · SpeechBrain ECAPA
(Stimmprüfung) · Silero VAD · faster-whisper · Piper + Filmfilter. Alle Dienste nur lokal auf 127.0.0.1 (Ports 43691–43694 und 3100 für das Command Center).*
