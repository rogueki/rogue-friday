# Ueberwachte Unterprozesse — hartes Zeitlimit und gezieltes Beenden

Stand 2026-10-22. Deckt zwei offene Punkte gleichzeitig ab:

- **INS-05**: „Timeout/Heartbeat … Download/Pip/Modell-Warmup getrennt benennen"
- **INS-07**: „gezielte Unterprozessverwaltung statt unmittelbarem FormClosing-taskkill … Fremde Prozesse,
  Distro und Tasks bleiben unberührt"

## 1. Ausgangslage (belegt)

- `Download` rief `curl.exe` direkt auf: **kein Zeitlimit, keine Abbruchprüfung während des Laufs**. Ein
  hängender Abruf fiel nur über die Stillstandsmeldung nach 15 Minuten auf und lief weiter.
- `Invoke-Pip` pollte den Status bis zu **120 Minuten** und hatte keinen Abbruchweg; der `cmd.exe`-Wrapper lief
  unbemerkt weiter, während die GUI längst abbrach.
- Der einzige Notausstieg war `taskkill /T /F`, also ein Baum-Kill — er reißt fremde Kinder mit, statt genau den
  gestarteten Prozess zu beenden.
- Nebenbei: `Start-Process -PassThru` liefert in PowerShell 5.1 **mit umgeleiteten Strömen** keinen Exitcode
  (`ExitCode` leer, reproduziert). Genau daran scheiterte der erste Entwurf des Supervisors.

## 2. Umsetzung — `installer/lib/process-supervisor.ps1` (neu)

| Funktion | Verhalten |
|---|---|
| `ConvertTo-WindowsArgument($Value)` | Quotierung nach CreateProcess-Regeln: nur bei Bedarf Anführen, Backslash vor Anführen verdoppeln, Anführungszeichen maskieren, abschließenden Backslash verdoppeln |
| `Invoke-SupervisedProcess` | startet über `System.Diagnostics.ProcessStartInfo` (ohne Umleitung, `CreateNoWindow`), pollt `HasExited`, prüft `TimeoutSeconds` und `CancelCheck`, beendet bei Zeitlimit oder Abbruch **nur den eigenen Prozess** (`Stop-Process -Id`) und meldet `ExitCode`, `TimedOut`, `Cancelled`, `Seconds`, `Pid` |

Bewusst **keine** Job-Objekte und kein Baum-Kill: der Aufrufer weiß, welchen Prozess er startet; alles andere
bleibt unangetastet. Werkzeuge schreiben ihre Protokolle selbst (`curl -s -o`, pip über `cmd`), deshalb braucht
der Supervisor keine Streamumleitung — und damit auch nicht den Exitcode-Fehler von `Start-Process`.

### Verdrahtung in `installer/install-friday.ps1`

- `$script:DownloadTimeoutSeconds = 3600`; `Download` läuft über den Supervisor mit Abbruchprüfung
  (`Test-InstallerCancelRequested`) gegen `curl.exe`. Bei `Cancelled` folgt der normale Abbruch (`Confirm-NotCancelled`),
  bei `TimedOut` eine Warnung mit Hinweis, dass ein erneuter Lauf an der vorhandenen Datei fortsetzt
  (`curl -C -`).
- `Invoke-Pip` prüft in der Warteschleife die Abbruchbitte und beendet dann **nur** `cmd.exe` per
  `Stop-Process -Id $proc.Id`; kein `taskkill /T`. Der Schritt bleibt unmarkiert, ein Resume installiert erneut
  (pip ist idempotent).

## 3. Nachweise — `installer/tests/process-supervisor.Tests.ps1` (neu, PASS)

- **Quotierung durch einen echten Prozessstart**: `powershell.exe` erhält fünf Argumente inklusive
  `Ziel ordner ü`, `sag "hallo"` und `C:\Pfad mit\Leerzeichen\` und schreibt sie zurück; die Rückgabe stimmt
  Zeichen für Zeichen. Zusätzlich Einzelfälle für leer, einfach, Backslash am Ende und eingebettete Anführungszeichen.
- **Exitcode**: Kindprozess endet mit 7 → `ExitCode = 7`, kein `TimedOut`/`Cancelled`; die vom Kind geschriebene
  Datei belegt, dass es wirklich gelaufen ist.
- **Hartes Zeitlimit**: Kindprozess schläft 120 s, `TimeoutSeconds = 2` → `TimedOut`, der Prozess ist danach weg,
  und ein **gleichzeitig gestarteter fremder Prozess lebt weiter**.
- **Abbruch während des Laufs**: `CancelCheck` schlägt nach drei Polls an → `Cancelled`, eigener Prozess weg,
  fremder Prozess lebt weiter.
- **Verdrahtung**: Installer bindet den Supervisor ein, `DownloadTimeoutSeconds` ist definiert, `Download` läuft
  über den Supervisor mit `CancelCheck` und `TimedOut`-Meldung (kein `& curl.exe` mehr), `Invoke-Pip` beendet
  gezielt `$proc.Id` und enthält kein `taskkill.exe`.

Gesamtstand: **20/20 Installer-Tests Exit 0** (vorher 19).

## 4. Grenzen (ehrlich offen)

- **Keine Job-Objekte**: wird `cmd.exe` beendet, kann der darunter gestartete Python-Prozess kurz weiterlaufen.
  Für pip ist das unkritisch (kein Zustand, Resume installiert erneut), aber es ist kein garantierter Baum-Abbau.
- **WSL-Kinder**: `wsl.exe`-Aufrufe werden nicht überwacht; ein Abbruch greift dort weiterhin erst an der
  nächsten Schrittgrenze.
- **Modell-Warmup und DB-/Dashboardwechsel** sind über `Native`/`Enter-Step` abgedeckt, aber nicht einzeln mit
  Zeitlimit und Abbruch belegt.
- **Lastfall** (Paketspam, sehr lange stille Phase) ist weiterhin nur über den asynchronen Leser abgedeckt.