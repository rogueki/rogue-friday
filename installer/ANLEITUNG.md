# F.R.I.D.A.Y. – Installation für Einsteiger

Dieses Paket richtet deinen persönlichen Sprachassistenten **F.R.I.D.A.Y.** („Friday“, der Nachfolger von J.A.R.V.I.S.)
komplett ein. Den **Namen kannst du selbst wählen** (Standard: *Friday*, z. B. auch *Jarvis*, *James* oder *Frida*).

- **„Hey Friday“** (bzw. „Hey“ + dein gewählter Name) – reagiert nur auf **deine** Stimme
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
2. **Doppelklick auf `install-jarvis.bat`** → Frage nach Administratorrechten mit *Ja* bestätigen.
3. Den Anweisungen im Fenster folgen. Du wirst gefragt nach:
   - dem **Namen deines Assistenten** (Enter = *Friday*). Das kommt **zuerst**, noch vor jeder Stimmaufnahme: aus dem Namen
     entsteht dein Wake Word „Hey <Name>“. Erlaubt sind 2–20 Buchstaben (auch Umlaute), keine Leerzeichen oder Zahlen.
   - deinem **Vornamen** und wie dein Assistent dich ansprechen soll (z. B. *„Sir“* wie ein britischer Butler)
   - dem **Charakter** (Butler / freundlich / sachlich) und wie ausführlich er antwortet
   - optional ein paar Infos über dich (Beruf, Interessen …)
   - einem **Linux-Benutzernamen und Passwort** (gut merken!)
   - deinem **Kimi-Schlüssel** (Bestätigung eines gefundenen Schlüssels oder Eingabe)
   - ganz am Ende (Schritt 15) einem **Passwort für das Command Center** (mindestens 12 Zeichen, zweimal eingeben). Benutzername
     beim Login ist `owner`. Gespeichert wird nur ein Hash, nie das Passwort selbst.
4. **Neustart:** Falls WSL noch fehlt, startet Windows einmal neu. Danach geht es **automatisch weiter**.
5. **Stimmaufnahme (ca. 10 Minuten):** Ein eigenes Fenster öffnet sich. Nach jedem **Piepton** sagst du, was dort
   steht: 26× „Hey Friday“ (bzw. dein Name), 18× „Friday“, 15 ähnlich klingende Wörter (z. B. *Freitag*, *Frieda*,
   *Feierabend* – das sind Gegenbeispiele und **nicht** dein Wake Word), 8 kurze Texte vorlesen.
   Danach lernt der Rechner dein Wake Word (bei eigenem Namen einige Minuten Rechenzeit, ohne Internet).
6. Danach richtet der Installer das **Command Center** ein (Schritt 15: Node.js und pnpm, Kopieren nach `C:\Jarvis\dashboard`,
   Bauen, Start; beim ersten Mal einige Minuten und Internet nötig). Am Ende **begrüßt dich dein Assistent** und auf Wunsch
   öffnet sich das Command Center.

Dauer gesamt: ca. 45–90 Minuten. Bricht etwas ab: Fehler beheben und **`install-jarvis.bat` einfach nochmal
starten** – erledigte Schritte werden übersprungen.

## Benutzung

- **„Hey Friday“** (bzw. „Hey <Name>“) → kurzer Piepton → deine Frage, z. B. *„Wie spät ist es?“*
- **Folgefragen** gehen 90 Sekunden lang ohne erneutes Wake Word.
- **Unterbrechen:** während dein Assistent spricht einfach das Wake Word sagen.
- Einfache Dinge (Uhrzeit, Rechnen, Wissen) beantwortet er sofort lokal. Aufgaben mit Mails, Kalender,
  Recherche oder Analysen gehen an Kimi K3 – dann sagt er kurz „Einen Moment“ bzw. meldet sich, wenn es fertig ist.
- **Command Center:** <http://127.0.0.1:3100> – Login `owner` mit deinem Command-Center-Passwort. Startet automatisch bei der
  Anmeldung (Aufgabe `JARVIS_Dashboard`, ca. 1 Minute nach dem Anmelden). Zeigt Aufgaben, Aktivität und Agenten live aus Hermes,
  Sprachstatus und Systemdaten; alle übrigen Bereiche (z. B. Mail, Kalender) sind noch **simuliert** und als solche gekennzeichnet.
- **Hermes-Dashboard:** <http://127.0.0.1:43691> (Kanban-Boards, Einstellungen, Verlauf)
- Fremde Stimmen, Kinder oder der Fernseher werden ignoriert (Stimmprüfung).

## Wichtige Orte

| Was | Wo |
|---|---|
| Alles vom Assistenten (Ordnername bleibt aus Kompatibilitätsgründen) | `C:\Jarvis` |
| Persönlichkeit ändern | `C:\Jarvis\config\persona.json`, danach Schritt erneut: siehe unten |
| Sprach-Einstellungen (Name, Wake Word, Engine) | `C:\Jarvis\config\voice.json` |
| Dein persönliches Wake-Word-Modell | `C:\Jarvis\models\openwakeword\personal_wake.npz` und `personal_wake.json` (Schwelle, Qualität) |
| Protokolle | `C:\Jarvis\logs` (Command Center: `dashboard-install.log`, `dashboard-service.log`, `dashboard\`; Watchdog: `watchdog.log`) |
| Command Center (Programm, Daten, Sicherungen) | `C:\Jarvis\dashboard` (`data`, `backups`) |
| Command-Center-Einstellungen (Modus, Port, Adapter) | `C:\Jarvis\dashboard\config\dashboard.yaml` und `adapters.yaml` – Installer überschreibt sie nie ohne Rückfrage |
| Passwort-Hash des Command Centers | `C:\Jarvis\config\dashboard_owner.hash` (nur du hast Zugriff) |
| Austauschordner mit dem Assistenten | `C:\Jarvis\exchange` |
| Status | `C:\Jarvis\INSTALL_STATE.md` |

**Persönlichkeit neu einstellen:** In `C:\Jarvis\config\install-state.json` die Einträge `"persona"`, `"hermes"` und
`"voicepython"` aus der Liste `done` löschen und `install-jarvis.bat` erneut starten.
**Stimme / Wake Word neu einlernen (gleicher Name):** Ordner `C:\Jarvis\voice\profiles\owner` löschen, die Einträge
`"enroll"` und `"voiceservice"` aus `done` entfernen, `install-jarvis.bat` erneut starten (der alte Sprachdienst samt Neustartschleife wird dabei beendet).
**Sprachdienst stoppen:** Nicht nur die Aufgabe `JARVIS_Voice` beenden – eine Neustartschleife läuft getrennt weiter und startet Python nach 10 s neu.
Der Installer beendet beides; manuell: in der Aufgabenverwaltung den `powershell`-Prozess mit `start-jarvis-voice.ps1` und `python.exe` mit `jarvis_voice.py` beenden.
**Update des Sprachdienstes:** Neues Paket entpacken und `install-jarvis.bat` starten – geänderte Sprachdateien werden bei jedem Start nach `C:\Jarvis\voice` kopiert (Profile und Modelle bleiben) und der laufende Sprachdienst wird neu gestartet.

## Service-Watchdog (startet abgestürzte Dienste neu)

Der Installer richtet am Ende die Aufgabe `JARVIS_Watchdog` ein. Sie läuft bei der Anmeldung und danach alle 5 Minuten, prüft
Sprachdienst (Port 43694), Qwen (43692) und Command Center (Port aus `dashboard.yaml`, Standard 3100) und startet einen
Dienst über seine Aufgabe (`JARVIS_Voice`, `JARVIS_Qwen`, `JARVIS_Dashboard`) neu, **wenn** sein Port nicht antwortet **und** kein
zugehöriger Prozess läuft. Wenn der Prozess noch läuft (z. B. beim Laden der Sprachmodelle, bis zu 3 Minuten), greift der Watchdog
nie ein und beendet auch nie einen Prozess. Weitere Bremsen: Während der Installer läuft, tut der Watchdog nichts; ein absichtlich
gesetztes Stop-Flag (`C:\Jarvis\run\<Skript>.stop`, setzt der Installer bei Updates) wird respektiert; zwischen zwei Neustarts
desselben Dienstes liegen mindestens 10 Minuten, höchstens 3 pro Stunde (danach nur eine Warnung im Log).

- **Log:** `C:\Jarvis\logs\watchdog.log` (eine Zeile je Neustart oder Warnung, stündlich eine Zeile „Heartbeat“, Rotation bei 1 MB auf `.1`).
- **Unsichtbar:** Die Aufgabe startet über `hidden.vbs` (wie die anderen JARVIS-Aufgaben). Es darf nie ein Fenster aufblitzen –
  auch nicht alle 5 Minuten. Blitzt doch eines auf, in der Aufgabenplanung die Aktion von `JARVIS_Watchdog` prüfen: sie muss
  `wscript.exe //B //Nologo "C:\Jarvis\installer\scripts\hidden.vbs" "C:\Jarvis\installer\scripts\friday-watchdog.ps1"` lauten
  (nicht `powershell.exe` direkt); sonst `install-jarvis.bat` erneut starten, das registriert die Aufgabe neu.
- **Dienst absichtlich ausgeschaltet lassen** (z. B. Test eines Ausfalls): vorher den Watchdog anhalten –
  `schtasks /change /tn JARVIS_Watchdog /disable`, später `/enable`.
- **Alte Aufgabe:** Ein früherer Installer kann eine Aufgabe `JARVIS_Voice_Watchdog` angelegt haben. Der neue Installer lässt sie
  unangetastet; wird sie nicht mehr gebraucht (besonders wenn sie ein Konsolenfenster aufblitzen lässt), von Hand löschen:
  `schtasks /delete /tn JARVIS_Voice_Watchdog /f`.

## Command Center aktualisieren

Neues Paket entpacken und darin `update-dashboard.bat` doppelklicken (liegt neben `install-jarvis.bat`). Das Skript kopiert die
neuen Quellen nach `C:\Jarvis\dashboard`, baut nur neu, wenn sich etwas geändert hat, und startet das Command Center neu.
Einstellungen, Daten und Passwort bleiben erhalten. Technische Details, manuelle Befehle und Fehlersuche: `docs/DEPLOYMENT.md`.

## Name und Wake Word

**Standard:** *Friday* (F.R.I.D.A.Y.), Wake Word **„Hey Friday“**. Der Installer fragt den Namen **vor der ersten Aufnahme**;
alles Weitere (Stimmaufnahme, Persönlichkeit, Sprachdienst) richtet sich nach dieser Antwort.

**Namen später ändern:** `change-assistant-name.bat` doppelklicken (liegt neben `install-jarvis.bat`, in
`C:\Jarvis\installer`). Das Skript fragt den neuen Namen, passt die Persönlichkeit an und wiederholt Stimmaufnahme,
Wake-Word-Training und Sprachdienst (ca. 15 Minuten). Bei gleichem Namen kannst du nur die Aufnahme wiederholen.
Solange noch **keine** Aufnahmen existieren, fragt `install-jarvis.bat` beim erneuten Start ohnehin, ob der Name bleibt.

**So erkennt der Assistent sein Wake Word:**

- **Name „Jarvis“:** vortrainiertes openWakeWord-Modell *hey_jarvis* plus ein auf deine Stimme trainierter Verifier.
- **Jeder andere Name (auch Friday):** für beliebige Namen gibt es kein vortrainiertes Modell. Deshalb lernt der Rechner
  dein Wake Word aus **deinen eigenen Aufnahmen** (komplett lokal):
  1. *Stufe 1 – Klangmuster:* ein kleines Modell auf den Audio-Merkmalen von openWakeWord vergleicht laufend die letzten
     ~1 Sekunde mit „Hey Friday“/„Friday“ (deine 44 Aufnahmen, ähnlich klingende Wörter und Lesetexte als Gegenbeispiele;
     mit Piper-Stimme zusätzlich erzeugte Beispiele). Die Schwelle wird beim Einlernen an ungesehenen Aufnahmen
     kalibriert (Ziel: ca. 9 von 10 Aufrufen, möglichst wenige Fehlauslösungen).
  2. *Stufe 2 – Namenscheck:* nur wenn Stufe 1 anschlägt, hört die Spracherkennung (faster-whisper) kurz in die letzten
     2 Sekunden und prüft, ob der Name (oder eine klangliche Variante, z. B. *Fraidei*) vorkommt. Ähnliche, aber falsche
     Wörter (z. B. *Freitag*, *Frieda*) zählen nicht. Anpassbar in `voice.json`: `wake_aliases`, `wake_reject_words`,
     `wake_match_max_dist`, `wake_confirm` (Namenscheck aus/an), `wake_confirm_languages`.
  3. *Stufe 3 – Stimmprüfung:* wie bisher darf nur **deine** Stimme etwas auslösen.

  Ehrlich gesagt: Das selbst gelernte Wake Word ist **weniger treffsicher** als das fertige „Hey Jarvis“-Modell. Es
  kann mal nicht reagieren (dann einfach noch einmal, etwas deutlicher sagen) oder in seltenen Fällen anspringen – Stufe 2
  und die Stimmprüfung verhindern, dass daraus Befehle werden. **Tipps:** ein Name mit mindestens zwei Silben, der nicht
  wie häufige deutsche Wörter klingt; ruhige Umgebung beim Einlernen; nicht flüstern. Meldet der Installer, das Wake Word
  sei „noch unsicher erkennbar“, Aufnahme wiederholen.
- **Status prüfen:** <http://127.0.0.1:43694> zeigt u. a. `assistant_name`, `wake_phrase`, `wake_engine`
  (`openwakeword` oder `personal`) und `wake_rejected` (von Stufe 2 abgewiesene Auslösungen).

## Wenn etwas nicht geht

| Problem | Lösung |
|---|---|
| Der Assistent reagiert nicht | <http://127.0.0.1:43694> öffnen – steht dort `listening`? Sonst abmelden/anmelden. Log: `C:\Jarvis\logs\voice-service.log` |
| Ein Dienst fällt immer wieder aus | `C:\Jarvis\logs\watchdog.log` lesen (Neustarts, „Maximum erreicht“-Warnungen); Log des Dienstes prüfen (`voice-service.log`, `qwen-server.log`, `dashboard-service.log`) |
| Reagiert auf das Wake Word (Piepton), antwortet aber nicht | Deine Stimme wurde evtl. nicht erkannt: näher ans Mikrofon, normal laut sprechen |
| „Der Cloud-Agent ist nicht verfügbar“ | Internet prüfen; in Ubuntu: `hermes status` |
| Hermes-Dashboard (43691) lädt nicht | Ubuntu-Fenster öffnen: `systemctl --user status hermes-dashboard` |
| Command Center (3100) lädt nicht | Aufgabenplanung: `JARVIS_Dashboard` ausführen; Log `C:\Jarvis\logs\dashboard-service.log`. Hilft das nicht: `install-jarvis.bat` erneut starten (Schritt 15 wird wiederholt) |
| Installer meldet „Port 3100 ist belegt“ | Das genannte Programm beenden oder in `C:\Jarvis\dashboard\config\dashboard.yaml` einen anderen `server.port` eintragen (Installer und Autostart lesen den Port von dort), `install-jarvis.bat` erneut starten |
| Schritt 15: „pnpm install“/Build fehlgeschlagen | Internet prüfen, Details in `C:\Jarvis\logs\dashboard-install.log`, dann `install-jarvis.bat` erneut starten |
| Command-Center-Passwort vergessen | In `C:\Jarvis\config\install-state.json` den Eintrag `"dashboard"` aus `done` löschen, `install-jarvis.bat` starten und beim Passwort „Neu setzen“ mit `j` beantworten |
| Wake Word wird oft überhört / spricht ohne Grund an | Eigener Name: Aufnahme in ruhigerer Umgebung wiederholen (siehe oben). Im Log `C:\Jarvis\logs\voice.jsonl` zeigt `wake_rejected`, wie oft Stufe 2 eine Fehlauslösung abgefangen hat |
| Spiel ruckelt / Grafikspeicher voll | In `voice.json` bei `"game_processes"` das Spiel eintragen, z. B. `["Diablo IV.exe"]` |

## Was noch manuell kommt (Schritt für Schritt mit dem Assistenten/Kimi)

Laut Plan erst, wenn alles stabil läuft – jeweils einzeln:

1. **Telegram:** Bot bei @BotFather anlegen, dann in Ubuntu `hermes gateway setup`.
2. **E-Mail (z. B. GMX):** IMAP/SMTP mit App-Passwort.
3. **Kalender:** CalDAV.
4. WhatsApp, Office-Steuerung, Smart Home – später.

Regel: Lesen/Entwürfe macht der Assistent selbst. **Senden, Löschen, Termine ändern, Zahlungen nur nach deiner Bestätigung.**

## Deinstallation

Aufgabenplanung: `JARVIS_Voice`, `JARVIS_Qwen`, `JARVIS_WSL_Keepalive`, `JARVIS_Dashboard`, `JARVIS_Watchdog` löschen (zuerst `JARVIS_Watchdog`, sonst startet er Dienste neu) → PowerShell: `wsl --unregister Ubuntu`
(löscht Ubuntu samt Hermes!) → Ordner `C:\Jarvis` löschen.

---

*Technik: Windows 11 + WSL2 (Ubuntu 24.04, systemd) · Hermes Agent · Kimi K3 · llama.cpp + Qwen3-4B ·
openWakeWord („Hey Jarvis“ + Verifier bzw. persönliches Wake Word auf openWakeWord-Features) · SpeechBrain ECAPA
(Stimmprüfung) · Silero VAD · faster-whisper · Piper + Filmfilter. Alle Dienste nur lokal auf 127.0.0.1 (Ports 43691–43694 und 3100 für das Command Center).*
