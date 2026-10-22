# INS-07 — Kooperativer Abbruch statt sofortigem taskkill

Stand 2026-10-22. Aufgabe aus Master §8.1 (Zeile 295):

> Kooperativen Abbruch und gezielte Unterprozessverwaltung statt unmittelbarem FormClosing-taskkill
> implementieren. Temporäre DPAPI-Dateien/Marker in allen Ausgängen entfernen.
> Abbruch während Download, pip, Distrovorbereitung, Modellstart und DB-/Dashboardwechsel; Resume prüft
> unvollständige Artefakte. Fremde Prozesse, Distro und Tasks bleiben unberührt.

## 1. Ausgangslage (belegt)

- `installer/install-friday-gui.ps1` beendete den Lauf im `FormClosing` sofort mit
  `taskkill.exe /PID <pid> /T /F` und wartete nur 5 s auf das Ende. `/T` reisst den gesamten Prozessbaum mit:
  laufende `wsl.exe`-Aufrufe, pip, pnpm und Dienststarter. Ein Abbruch mitten in Kopier-, pip- oder
  WSL-Schritten hinterliess damit halbe Artefakte, ohne dass der Installer selbst aufräumen konnte.
- Der Installer hatte keine Möglichkeit, eine Abbruchbitte wahrzunehmen: es gab weder eine Datei noch einen
  anderen Kanal, über den ein zweiter Prozess ihn an einer sicheren Grenze anhalten konnte.
- Die Laufkennung existierte bereits (GUI erzeugt sie, setzt `FRIDAY_INSTALL_RUN`, der Installer schreibt sie
  in die Sperrdatei) und wird jetzt auch für die Abbruchbitte genutzt.

## 2. Umsetzung

### `installer/lib/installer-cancel.ps1` (neu, dot-sourced)

| Funktion | Verhalten |
|---|---|
| `Get-InstallerCancelPath($Root)` | `<Root>\run\installer.cancel` |
| `Request-InstallerCancel($Root, $RunId, $Reason)` | schreibt JSON `{runId, reason, requestedUtc}`; ohne Laufkennung **keine** Datei |
| `Read-InstallerCancel($Root)` | liest die Datei, `$null` bei fehlend/leer/kaputt |
| `Test-InstallerCancelRequested($Root, $RunId)` | nur die **eigene** Laufkennung zählt; ohne Laufkennung immer `$false` |
| `Clear-InstallerCancel($Root, $RunId)` | entfernt die eigene Bitte; mit `$RunId` wird eine fremde Bitte nicht angefasst |

Begründung der Laufkennung: PIDs und Zeitstempel wiederholen sich, Laufkennungen nicht. Eine liegen gebliebene
Bitte aus einem abgestürzten Lauf kann so keinen späteren Lauf beenden — genau der Fall, den ein reiner
Datei-Existenztest falsch behandeln würde.

### `installer/install-friday.ps1`

- `$InstallRunId` wird **einmal** bestimmt (aus `FRIDAY_INSTALL_RUN`, sonst `PID-<8hex>`) und an die Sperre
  übergeben. Damit tragen Sperre, Abbruchbitte und Meldungen dieselbe Kennung.
- Vorstart-Prüfung direkt nach der Sperre: liegt für diese Laufkennung schon eine Bitte vor, endet der Lauf mit
  `[ABBRUCH] … Es wurde nichts geaendert.` und Exitcode 1 — **bevor** die geplante Aufgabe entfernt, migriert
  oder ein Schritt begonnen wird.
- `Confirm-NotCancelled` liest die Bitte, entfernt sie und bricht über `Stop-Install` mit Grund und dem Hinweis
  auf den gespeicherten Fortschritt ab. Aufgerufen an **jeder** Schrittgrenze (15 Blöcke) und vor **jedem**
  Unterprozess über `Native`, `Invoke-Pip` und `Download`. Damit wirkt ein Abbruch an der nächsten sicheren
  Grenze statt mitten in einer Kopie oder einem pip-Lauf.
- Der Abbruch nutzt den normalen Ausgang: `installer.active` und die Sperrdatei werden entfernt, der Zustand
  bleibt stehen, `resume.bat` verweist auf den gespeicherten Fortschritt.

### `installer/install-friday-gui.ps1`

- `Request-GuiCancel` schreibt die Bitte mit der Laufkennung des Kindprozesses und protokolliert sie im
  Detailfenster.
- `Stop-BackendGracefully` bittet zuerst, wartet bis zu **25 s** in 250-ms-Schritten und beendet den Prozess nur,
  wenn er nicht reagiert (`taskkill … /T /F` bleibt als letzter Ausweg, mit Protokolleintrag).
- `FormClosing` und der Startfehler-Pfad nutzen diese Funktion; das sofortige `taskkill` im `FormClosing` ist
  entfernt. Die DPAPI-Datei wird weiterhin in allen Ausgängen gelöscht (Startfehler, Laufende, FormClosing).

## 3. Nachweise (ausgeführt)

`installer/tests/installer-cancel.Tests.ps1` (neu, PASS):

- Modul: Pfad, fehlende Datei, keine Datei ohne Laufkennung, eigene/fremde/leere Laufkennung,
  `Clear-InstallerCancel` entfernt nur die eigene Bitte.
- `Confirm-NotCancelled` wird per AST aus dem Installer entnommen und mit einem Stub-`Stop-Install` ausgeführt:
  ohne Bitte kein Abbruch, fremde Bitte kein Abbruch, eigene Bitte genau ein Abbruch mit Grund in der Meldung,
  Bitte danach entfernt.
- Struktur: alle 15 `IsDone`-Schrittblöcke beginnen mit `Confirm-NotCancelled`; `Native`, `Invoke-Pip` und
  `Download` prüfen die Bitte; die Vorstart-Meldung existiert.
- GUI: Modul eingebunden, `FormClosing` ruft `Stop-BackendGracefully` und enthält kein `taskkill` mehr,
  `Stop-BackendGracefully` sendet die Bitte, wartet auf das Ende und beendet erst danach hart.
- Echter Einstiegspunkt mit `FRIDAY_INSTALL_RUN=cancel-e2e-a` und vorab geschriebener, passender Bitte:
  Exitcode 1, `[ABBRUCH]` in der Ausgabe, kein `resume.bat`, keine zurückbleibende Bitte — und **keine** Spur
  von Schrittarbeit.
- Gegenprobe mit fremder Laufkennung (`anderer-lauf`) bei vorhandenem Zustand: der Lauf ignoriert die alte
  Bitte und endet an der erwarteten Prüfung ("unvollstaendig"), nicht am Abbruch.

Gesamtstand: **18/18 Installer-Tests Exit 0** (vorher 17). Der I/O-Vertrag meldet weiterhin alle Eingaben:
"28 answers, 7 secrets, 21 guarded prompts" (die zusätzliche Rückfrage im Vorstart-Abbruch ist mitgezählt und
abgesichert).

## 4. Offen in INS-07

- **Gezielte Unterprozessverwaltung**: der Notausstieg beendet weiterhin den ganzen Baum. Einzelne
  Unterprozesse (pip, pnpm, `wsl.exe`) werden nicht über Job-Objekte oder gezielte PIDs geführt.
- **Nachweis mitten im Lauf**: die Prüfung vor jedem Unterprozess ist strukturell und funktional belegt; ein
  Abbrich mitten in einem echten Download/pip-Lauf wurde nicht gefahren (kein Produktivlauf in dieser Runde).
- **Resume prüft unvollständige Artefakte**: der Zustand schützt erledigte Schritte, heruntergeladene
  `.part`-Reste und halb entpackte Pakete werden noch nicht systematisch geprüft.
- Modellstart und DB-/Dashboardwechsel: durch die Prüfung in `Native` abgedeckt, aber nicht einzeln belegt.
## 5. Nachtrag 2026-10-22: Abbruch mitten im Modell-Warmup

Waehrend des Modellstarts wartete der Installer bis zu 120 s (`Wait-Http`), beim Sprachdienst bis zu 180 s in
einer eigenen Schleife. Beide Schleifen prueften die Abbruchbitte nicht: ein Abbruch wirkte erst nach dem
Warmup, obwohl er sofort gemeint ist - und in dieser Zeit lief der Dienst unbeaufsichtigt weiter (N-030).

Beide Schleifen rufen jetzt zu Beginn jeder Runde `Confirm-NotCancelled` auf. Damit gilt dieselbe Grenze wie vor
jedem Unterprozess: die Bitte wirkt beim naechsten Durchlauf (rund 2-3 s), nicht erst am Ende des Timeouts.

**Nachweis `installer/tests/warmup-cancel.Tests.ps1` (neu, PASS)** - echter Wartebaustein gegen einen nicht
antwortenden Port (`127.0.0.1:9`):

| Fall | Erwartung | Ergebnis |
| --- | --- | --- |
| keine Abbruchbitte | Warten laeuft in sein Zeitlimit, meldet `false` | PASS |
| Abbruchbitte fremder Laufkennung | wird ignoriert, kein Abbruch | PASS |
| eigene Abbruchbitte | Abbruch sofort (< 30 s statt 120 s), Meldung mit Grund, Bitte wird entfernt | PASS |
| Warteschleife des Sprachdienstes | prueft denselben Punkt | PASS (strukturell) |

Gegenprobe: mit entfernter Pruefung in `Wait-Http` scheitert der Test mit "Abbruch im Warmup wurde nicht befolgt.";
die Datei wurde danach byte-identisch wiederhergestellt (SHA256 verglichen).

Gesamtstand: **25/25 Installer-Tests Exit 0** (vorher 24).
## 6. Nachtrag 2026-10-22: Enkelprozesse im Job-Objekt

`Invoke-Pip` startete `cmd.exe`, das seinerseits `python.exe` startet. Ein Abbruch beendete nur `cmd.exe`;
`python` lief als Waise weiter und schrieb das venv halb fertig - der Abbruch war damit nur scheinbar wirksam
(N-031). Dieselbe Luecke hatten alle ueberwachten Aufrufe (`Invoke-SupervisedProcess`,
`Invoke-CapturedProcess`).

Neu ist `installer/lib/job-object.ps1`: `New-ProcessJob`, `Add-ProcessToJob`, `Stop-ProcessJob`,
`Close-ProcessJob`. Das Job-Objekt traegt `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, damit auch ein abgestuerzter
Installer keine Reste hinterlaesst. Ein Job enthaelt ausschliesslich Prozesse, die dieser Aufruf selbst
gestartet hat - fremde Prozesse und die WSL-Distribution bleiben unberuehrt. Ohne Job-Unterstuetzung faellt der
Code auf das gezielte Beenden des direkten Prozesses zurueck.

**Nachweise (PASS):**

| Test | Inhalt |
| --- | --- |
| `job-tree.Tests.ps1` | Zeitlimit und Abbruchbitte beenden den echten Baum (powershell -> ping); Gegenprobe ohne Job zeigt, dass der Enkel sonst weiterlebt; Bibliothek selbst (Handle, Zuordnung, Beenden, Schliessen) |
| `pip-cancel.Tests.ps1` | echte `Invoke-Pip`-Funktion mit Stellvertreter-Interpreter: Kontrolllauf schreibt die Markierung, abgebrochener Lauf nicht; kein ping-Kind bleibt zurueck; pip-Ereignis wird gemeldet |
| `process-supervisor.Tests.ps1`, `wsl-timeout.Tests.ps1` | laden jetzt auch die Job-Bibliothek und pruefen die Verdrahtung (Job anlegen, zuordnen, beenden, Handle freigeben) |

Gegenproben: ohne `New-ProcessJob` in `Invoke-Pip` scheitert `pip-cancel` mit "Nach dem Abbruch lief der
pip-Baum weiter und schrieb sein Ergebnis."; die Datei wurde byte-identisch wiederhergestellt (SHA256).

Gesamtstand: **27/27 Installer-Tests Exit 0** (vorher 25).

## 7. Nachtrag 2026-10-22: fehlende Byte-Order-Marken

`installer/scripts/update-memory-bridge.ps1` und `installer/scripts/update-voice-personas.ps1` enthielten
Nicht-ASCII-Zeichen ohne UTF-8-BOM. PowerShell 5.1 liest solche Dateien als ANSI, wodurch Umlaute in
Ausgaben und Pfaden verstuemmelt werden (N-032). Beide Dateien sind jetzt UTF-8 mit BOM; `ParseFile` meldet
fuer beide keine Fehler mehr.