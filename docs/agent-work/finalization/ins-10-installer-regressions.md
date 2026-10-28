# INS-10 - Protokollierte Installerregressionen absichern

Stand: 2026-10-22. Branch `feat/friday-finalization-20261021`, Commit folgt.

Ziel laut Masterplan: jede protokollierte Regression isoliert pruefen, statt den Installer nur als Ganzes zu
starten; fremde WSL-Konfiguration, Ports und Aufgaben bleiben unveraendert; Modell-Download und
Dienstbereitschaft muessen getrennt diagnostizierbar sein.

## 1. Stand je Regression

| Regression (Protokoll) | Zustand im Quellstand | Aenderung in INS-10 | Nachweis |
|---|---|---|---|
| `wslpath`: vollstaendige Ausgabe vor dem Exitcheck, Warnzeilen filtern | Filter war inline in `Get-WslPath` | Auswertung in `lib/wsl-path.ps1` (`Select-WslPathOutput`, `Split-WslOutput`); Installer wertet erst die Ausgabe, dann den Exitcode | 8 Zusicherungen der Probe, plus Reihenfolgepruefung im Quelltext |
| HTTP 503 waehrend des Modellstarts ist Laden, kein Abbruch | trat ueber `Wait-Http` (Net.WebRequest, Wiederholung) auf | eigenes Modul `lib/wait-http.ps1` mit Klassifikation `ready` / `loading` / `error` / `unreachable`; `Wait-Http` meldet den Unterschied als Warnung | echter HTTP-Server: 503, 503, 503, dann 200 -> bereit; dauerhaft 503 -> `loading`; geschlossener Port -> `unreachable` |
| Keepalive als echter Prozess, nicht als "bereit"-Aufgabe | Pruefung war inline | `lib/wsl-keepalive.ps1`: `Test-WslKeepaliveCommandLine`, `Get-WslKeepaliveProcess` | 8 Zusicherungen: echter Aufruf, Kleinschreibung, fremde Distribution, `sleep 30`, Praefix `FRIDAY-21`, leere Zeile |
| 900-s-Fenster fuer TTS, getrennt von Modell und Download | vorhanden (900 / 120 / 60 / 3600) | unveraendert, jetzt festgenagelt | 4 Zusicherungen im Quelltext |
| Gepinnte Pruefsummen und Downloadstillstand | Pruefsummen inline, Loeschung doppelt | `lib/download-integrity.ps1`: `Get-FileSha256`, `Test-FileSha256`, `Assert-FileSha256` (loescht bei Abweichung); Installer nutzt es fuer Archiv-Digest und Qwen-Modell | 7 Zusicherungen inkl. Grossschreibung, `sha256:`-Praefix und geloeschter Datei; Downloadstillstand ueber Zeitlimit 3600 s + `Invoke-SupervisedProcess` |
| Node/pnpm-Kindprozess-PATH | `Set-NodeSessionPath` vorhanden | unveraendert, jetzt mit echtem Kindprozess-Nachweis | Probe bildet zuerst den Fehler nach (zitierter PATH-Eintrag verdeckt `node.exe` fuer `cmd /c where`), korrigiert dann und prueft Fundort, erste Stelle, keine Anfuehrungszeichen, keine Dopplung |
| WSL-Update begrenzen/optional | `Native { wsl.exe --update }` ohne Limit | `Invoke-CapturedProcess ... -TimeoutSeconds 600`, Zeitueberschreitung und Exitcode nur als Warnung, Abschalten mit `-SkipWslUpdate` | Quelltextpruefung plus Gegenprobe; `wsl-timeout.Tests.ps1` zaehlt jetzt drei unbeschraenkte Aufrufe statt vier und verlangt das gebundene Update |

## 2. Was ausdruecklich unveraendert bleibt

- Keine fremde WSL-Konfiguration, keine Distributionsregistrierung, kein Dienst und keine Aufgabe des
  Operators wird angefasst. Die Probe hoert auf Ports 18711-18719 und raeumt sie wieder ab.
- Der Sprechergrenzwert, die Ports der Installation (3101, 43791-43795) und der Zustand unter
  `D:\Dokumente\F.R.I.D.A.Y` bleiben unberuehrt.
- Die Obergrenze fuer Downloads (3600 s) und das TTS-Fenster (900 s) sind nicht "gruen gemacht" worden; sie
  wurden nur festgenagelt.

## 3. Nachweise

| Pruefung | Ergebnis |
|---|---|
| `installer/tests/installer-regressions.Tests.ps1` | PASS, 60 Zusicherungen: echter HTTP-Server (503 als Laden, dauerhaft 503, geschlossener Port, Abbruchbitte im Warten), Keepalive-Erkennung, Pruefsummen mit Loeschung, wslpath-Filterung, Kindprozess-PATH, Zeitfenster, Verdrahtung und zwei Gegenproben |
| Gegenprobe 503 | `'loading'` -> `'error'` in `lib/wait-http.ps1`: Probe Exit 1 mit "503 wurde als 'error' statt 'loading' gedeutet"; Datei byte-identisch wiederhergestellt (SHA-256 `926780A862CF28D2D0C3F2AF645C219C8169343B92FA978DB8684CA6EF5989F6`) |
| `wsl-timeout.Tests.ps1` | PASS, jetzt 3 unbeschraenkte Aufrufe, gebundenes Update, `-SkipWslUpdate` |
| `warmup-cancel.Tests.ps1` | PASS, laedt `lib/wait-http.ps1` mit und prueft die Klassifikation in der Meldung |
| Installer-Suite | 33/33 Exit 0 (453 s) |
| Echte Komponente (lesend) | `Invoke-HttpProbe` gegen die laufende Installation: `http://127.0.0.1:3101/api/v1/health` -> `ready` (HTTP 200). Dashboard (43791) und Hermes (43793) lauschen derzeit nicht; das ist der aktuelle Betriebszustand und kein Ergebnis dieser Aufgabe. |

## 4. Offen

- Ein echter Installationslauf mit Modell-Download, Qwen-Start und TTS-Start (900 s) gehoert zu INS-13:
  dort werden die Fenster unter realer Last beobachtet, nicht nur ihre Verdrahtung.
- Ein haengender Download (Stillstand mitten im Abruf) ist mit dem Zeitlimit 3600 s abgesichert, aber nicht
  mit einem echten 1-GB-Abruf nachgestellt; die Fortsetzung prueft INS-07 (`.part`-Datei).

## 5. Bezug zu den offenen Zeilen `FIXED_NEEDS_REGRESSION`

Der Ledger fuehrte vor dieser Aufgabe 13 Zeilen mit dieser Kennzeichnung. INS-10 schliesst davon nur, was
wirklich zu den hier geprueften Regressionen gehoert:

- **I-012 (pnpm-Kindprozess-PATH)**: mit echtem Kindprozess geschlossen -> `CLOSED_VERIFIED`.
- **I-010 (Downloadstillstand)**: Pruefsumme und getrennte Fenster belegt, ein echter Abbruch mitten im Abruf
  ist nicht nachgestellt -> bleibt `FIXED_NEEDS_REGRESSION` mit praezisiertem naechsten Schritt.
- Die uebrigen elf Zeilen (I-004, I-005, I-007, I-009, I-011, I-014, I-016, I-017, I-021, I-023, I-027) gehoeren
  zu anderen Aufgaben (Migeration/Build/Auth/Hoerprobe) und werden dort geschlossen, nicht hier umgedeutet.
