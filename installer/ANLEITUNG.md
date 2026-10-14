# F.R.I.D.A.Y. – Installation für Einsteiger

Dieses Paket richtet deinen persönlichen Sprachassistenten **F.R.I.D.A.Y.** („Friday“, der Nachfolger von J.A.R.V.I.S.)
komplett ein. Den **Namen kannst du selbst wählen** (Standard: *Friday*, z. B. auch *Jarvis*, *James* oder *Frida*).

- **„Hey Friday“** (bzw. „Hey“ + dein gewählter Name) – reagiert nur auf **deine** Stimme
- schnelle Antworten lokal auf deinem PC (Qwen3-4B), alles Komplexe über **Kimi K3**
- **Hermes Agent** als „Gehirn“ mit Werkzeugen, Kanban-Board und Dashboard
- startet automatisch bei jeder Anmeldung

---

## Vorher erledigen (5 Minuten)

1. **Windows 11** (Windows 10 geht eingeschränkt), alle Updates installiert.
2. **NVIDIA-Grafiktreiber** aktuell (GeForce Experience / NVIDIA App). Ohne NVIDIA läuft der Assistent auch, nur langsamer.
3. Dein Windows-Benutzer muss **Administrator** sein.
4. **Kimi Code** einrichten: `install-kira.bat` ausführen (die Datei bekommst du separat). Der Installer erkennt den
   Kimi-Schlüssel dann automatisch. Alternativ fragt er dich danach.
5. **Mikrofon und Lautsprecher** angeschlossen, ruhiger Raum für die Stimmaufnahme.
6. Mindestens **40 GB frei** auf C:, stabile Internetverbindung (ca. 10 GB Downloads).

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
   - deinem **Kimi-Schlüssel** (falls nicht automatisch gefunden)
4. **Neustart:** Falls WSL noch fehlt, startet Windows einmal neu. Danach geht es **automatisch weiter**.
5. **Stimmaufnahme (ca. 10 Minuten):** Ein eigenes Fenster öffnet sich. Nach jedem **Piepton** sagst du, was dort
   steht: 26× „Hey Friday“ (bzw. dein Name), 18× „Friday“, 15 ähnlich klingende Wörter (z. B. *Freitag*, *Frieda*,
   *Feierabend* – das sind Gegenbeispiele und **nicht** dein Wake Word), 8 kurze Texte vorlesen.
   Danach lernt der Rechner dein Wake Word (bei eigenem Namen einige Minuten Rechenzeit, ohne Internet).
6. Am Ende **begrüßt dich dein Assistent** und das Dashboard öffnet sich.

Dauer gesamt: ca. 45–90 Minuten. Bricht etwas ab: Fehler beheben und **`install-jarvis.bat` einfach nochmal
starten** – erledigte Schritte werden übersprungen.

## Benutzung

- **„Hey Friday“** (bzw. „Hey <Name>“) → kurzer Piepton → deine Frage, z. B. *„Wie spät ist es?“*
- **Folgefragen** gehen 90 Sekunden lang ohne erneutes Wake Word.
- **Unterbrechen:** während dein Assistent spricht einfach das Wake Word sagen.
- Einfache Dinge (Uhrzeit, Rechnen, Wissen) beantwortet er sofort lokal. Aufgaben mit Mails, Kalender,
  Recherche oder Analysen gehen an Kimi K3 – dann sagt er kurz „Einen Moment“ bzw. meldet sich, wenn es fertig ist.
- **Dashboard:** <http://127.0.0.1:43691> (Kanban-Boards, Einstellungen, Verlauf)
- Fremde Stimmen, Kinder oder der Fernseher werden ignoriert (Stimmprüfung).

## Wichtige Orte

| Was | Wo |
|---|---|
| Alles vom Assistenten (Ordnername bleibt aus Kompatibilitätsgründen) | `C:\Jarvis` |
| Persönlichkeit ändern | `C:\Jarvis\config\persona.json`, danach Schritt erneut: siehe unten |
| Sprach-Einstellungen (Name, Wake Word, Engine) | `C:\Jarvis\config\voice.json` |
| Dein persönliches Wake-Word-Modell | `C:\Jarvis\models\openwakeword\personal_wake.npz` und `personal_wake.json` (Schwelle, Qualität) |
| Protokolle | `C:\Jarvis\logs` |
| Austauschordner mit dem Assistenten | `C:\Jarvis\exchange` |
| Status | `C:\Jarvis\INSTALL_STATE.md` |

**Persönlichkeit neu einstellen:** In `C:\Jarvis\config\install-state.json` die Einträge `"persona"`, `"hermes"` und
`"voicepython"` aus der Liste `done` löschen und `install-jarvis.bat` erneut starten.
**Stimme / Wake Word neu einlernen (gleicher Name):** Ordner `C:\Jarvis\voice\profiles\owner` löschen, die Einträge
`"enroll"` und `"voiceservice"` aus `done` entfernen, `install-jarvis.bat` erneut starten (der alte Sprachdienst wird dabei beendet).

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
| Reagiert auf das Wake Word (Piepton), antwortet aber nicht | Deine Stimme wurde evtl. nicht erkannt: näher ans Mikrofon, normal laut sprechen |
| „Der Cloud-Agent ist nicht verfügbar“ | Internet prüfen; in Ubuntu: `hermes status` |
| Dashboard lädt nicht | Ubuntu-Fenster öffnen: `systemctl --user status hermes-dashboard` |
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

Aufgabenplanung: `JARVIS_Voice`, `JARVIS_Qwen`, `JARVIS_WSL_Keepalive` löschen → PowerShell: `wsl --unregister Ubuntu`
(löscht Ubuntu samt Hermes!) → Ordner `C:\Jarvis` löschen.

---

*Technik: Windows 11 + WSL2 (Ubuntu 24.04, systemd) · Hermes Agent · Kimi K3 · llama.cpp + Qwen3-4B ·
openWakeWord („Hey Jarvis“ + Verifier bzw. persönliches Wake Word auf openWakeWord-Features) · SpeechBrain ECAPA
(Stimmprüfung) · Silero VAD · faster-whisper · Piper + Filmfilter. Alle Dienste nur lokal auf 127.0.0.1 (Ports 43691–43694).*
