# JARVIS – Installation für Einsteiger

Dieses Paket richtet deinen persönlichen Sprachassistenten **JARVIS** komplett ein:

- **„Hey Jarvis“** – reagiert nur auf **deine** Stimme
- schnelle Antworten lokal auf deinem PC (Qwen3-4B), alles Komplexe über **Kimi K3**
- **Hermes Agent** als „Gehirn“ mit Werkzeugen, Kanban-Board und Dashboard
- startet automatisch bei jeder Anmeldung

---

## Vorher erledigen (5 Minuten)

1. **Windows 11** (Windows 10 geht eingeschränkt), alle Updates installiert.
2. **NVIDIA-Grafiktreiber** aktuell (GeForce Experience / NVIDIA App). Ohne NVIDIA läuft JARVIS auch, nur langsamer.
3. Dein Windows-Benutzer muss **Administrator** sein.
4. **Kimi Code** einrichten: `install-kira.bat` ausführen (die Datei bekommst du separat). Der Installer erkennt den
   Kimi-Schlüssel dann automatisch. Alternativ fragt er dich danach.
5. **Mikrofon und Lautsprecher** angeschlossen, ruhiger Raum für die Stimmaufnahme.
6. Mindestens **40 GB frei** auf C:, stabile Internetverbindung (ca. 10 GB Downloads).

## Installation

1. ZIP entpacken (Rechtsklick → *Alle extrahieren*), z. B. in *Downloads*.
2. **Doppelklick auf `install-jarvis.bat`** → Frage nach Administratorrechten mit *Ja* bestätigen.
3. Den Anweisungen im Fenster folgen. Du wirst gefragt nach:
   - deinem **Vornamen** und wie JARVIS dich ansprechen soll (z. B. *„Sir“* wie im Film)
   - JARVIS' **Charakter** (Butler / freundlich / sachlich) und wie ausführlich er antwortet
   - optional ein paar Infos über dich (Beruf, Interessen …)
   - einem **Linux-Benutzernamen und Passwort** (gut merken!)
   - deinem **Kimi-Schlüssel** (falls nicht automatisch gefunden)
4. **Neustart:** Falls WSL noch fehlt, startet Windows einmal neu. Danach geht es **automatisch weiter**.
5. **Stimmaufnahme (ca. 10 Minuten):** Ein eigenes Fenster öffnet sich. Nach jedem **Piepton** sagst du, was dort
   steht: 26× „Hey Jarvis“, 18× „Jarvis“, einige ähnlich klingende Wörter, 8 kurze Texte vorlesen.
6. Am Ende **begrüßt dich JARVIS** und das Dashboard öffnet sich.

Dauer gesamt: ca. 45–90 Minuten. Bricht etwas ab: Fehler beheben und **`install-jarvis.bat` einfach nochmal
starten** – erledigte Schritte werden übersprungen.

## Benutzung

- **„Hey Jarvis“** → kurzer Piepton → deine Frage, z. B. *„Wie spät ist es?“*
- **Folgefragen** gehen 90 Sekunden lang ohne erneutes „Hey Jarvis“.
- **Unterbrechen:** während JARVIS spricht einfach „Hey Jarvis“ sagen.
- Einfache Dinge (Uhrzeit, Rechnen, Wissen) beantwortet JARVIS sofort lokal. Aufgaben mit Mails, Kalender,
  Recherche oder Analysen gehen an Kimi K3 – dann sagt er kurz „Einen Moment“ bzw. meldet sich, wenn es fertig ist.
- **Dashboard:** <http://127.0.0.1:43691> (Kanban-Boards, Einstellungen, Verlauf)
- Fremde Stimmen, Kinder oder der Fernseher werden ignoriert (Stimmprüfung).

## Wichtige Orte

| Was | Wo |
|---|---|
| Alles von JARVIS | `C:\Jarvis` |
| Persönlichkeit ändern | `C:\Jarvis\config\persona.json`, danach Schritt erneut: siehe unten |
| Sprach-Einstellungen | `C:\Jarvis\config\voice.json` |
| Protokolle | `C:\Jarvis\logs` |
| Austauschordner mit JARVIS | `C:\Jarvis\exchange` |
| Status | `C:\Jarvis\INSTALL_STATE.md` |

**Persönlichkeit neu einstellen:** In `C:\Jarvis\config\install-state.json` die Einträge `"persona"`, `"hermes"` und
`"voicepython"` aus der Liste `done` löschen und `install-jarvis.bat` erneut starten.
**Stimme neu einlernen:** Ordner `C:\Jarvis\voice\profiles\owner` löschen, Eintrag `"enroll"` entfernen, neu starten.

## Wenn etwas nicht geht

| Problem | Lösung |
|---|---|
| JARVIS reagiert nicht | <http://127.0.0.1:43694> öffnen – steht dort `listening`? Sonst abmelden/anmelden. Log: `C:\Jarvis\logs\voice-service.log` |
| Reagiert auf „Hey Jarvis“, antwortet aber nicht | Deine Stimme wurde evtl. nicht erkannt: näher ans Mikrofon, normal laut sprechen |
| „Der Cloud-Agent ist nicht verfügbar“ | Internet prüfen; in Ubuntu: `hermes status` |
| Dashboard lädt nicht | Ubuntu-Fenster öffnen: `systemctl --user status hermes-dashboard` |
| Spiel ruckelt / Grafikspeicher voll | In `voice.json` bei `"game_processes"` das Spiel eintragen, z. B. `["Diablo IV.exe"]` |

## Was noch manuell kommt (Schritt für Schritt mit JARVIS/Kimi)

Laut Plan erst, wenn alles stabil läuft – jeweils einzeln:

1. **Telegram:** Bot bei @BotFather anlegen, dann in Ubuntu `hermes gateway setup`.
2. **E-Mail (z. B. GMX):** IMAP/SMTP mit App-Passwort.
3. **Kalender:** CalDAV.
4. WhatsApp, Office-Steuerung, Smart Home – später.

Regel: Lesen/Entwürfe macht JARVIS selbst. **Senden, Löschen, Termine ändern, Zahlungen nur nach deiner Bestätigung.**

## Deinstallation

Aufgabenplanung: `JARVIS_Voice`, `JARVIS_Qwen`, `JARVIS_WSL_Keepalive` löschen → PowerShell: `wsl --unregister Ubuntu`
(löscht Ubuntu samt Hermes!) → Ordner `C:\Jarvis` löschen.

---

*Technik: Windows 11 + WSL2 (Ubuntu 24.04, systemd) · Hermes Agent · Kimi K3 · llama.cpp + Qwen3-4B ·
openWakeWord („Hey Jarvis“ + persönlicher Verifier) · SpeechBrain ECAPA (Stimmprüfung) · Silero VAD ·
faster-whisper · Piper + JARVIS-Filmfilter. Alle Dienste nur lokal auf 127.0.0.1 (Ports 43691–43694).*
