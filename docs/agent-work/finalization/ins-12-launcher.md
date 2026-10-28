# INS-12 - Starter zusammenfuehren, Parameter und Abbruch sauber

Stand: 2026-10-22. Branch `feat/friday-finalization-20261021`, Commit folgt.

Ziel laut Masterplan: `install-friday.bat`, ein gegebenenfalls separater CLI-Starter, der Fortsetzungsstarter und die
Dokumentation zusammenfuehren. Doppelklick startet die Oberflaeche, der ausdrueckliche CLI-Modus bleibt dokumentiert.
Vor der Windows-Abfrage nach Administratorrechten werden keine Geheimnisse erfasst; ausserhalb des Testmodus gibt es
keine Simulation. Abnahme: Entpacken und Start auf sauberem Windows, keine zusaetzliche GUI-Laufzeit, alle Parameter
kommen an, ein Abbruch der Abfrage aendert nichts, der Neustartkontext stimmt, der alte Starter bleibt dokumentierter
Rueckweg mit demselben Ziel.

## 1. Befund im Quellstand

| Starter | Befund | Bewertung |
|---|---|---|
| `Friday installieren.bat` (Hauptordner) | prueft die `.vbs` und startet sie | in Ordnung |
| `Friday installieren.vbs` | reichte **nur** `-Simulation <modus>` weiter und nur bei genau zwei Argumenten; `-ResumeRoot <pfad>` ging verloren | **Luecke** |
| `installer\install-friday.bat` | reicht `%*` weiter (seit INS-06 belegt) | in Ordnung |
| `installer\install-friday-gui.bat` | rief den Assistenten **ohne** `%*` auf | **Luecke** |
| `installer\install-friday-gui.vbs` | reichte gar keine Argumente weiter | **Luecke** |
| Fortsetzung | `resume.bat` entsteht im Zielordner mit `cd /d "%~dp0"`, `-Resume -InstallRoot "%CD%"` und der echten Distribution | in Ordnung |
| Abbruch der Windows-Abfrage | `Start-Process -Verb RunAs` stand ohne `try/catch` in Assistent und CLI; ein Abbruch erschien als Programmfehler | **Luecke** |
| Simulation | CLI prueft `FRIDAY_GUI_TEST=1` und den GUI-Modus; der **Assistent** nahm `-Simulation` von jedem Aufrufer an | **Luecke** |
| GUI-Laufzeit | Assistent nutzt `System.Windows.Forms`/`System.Drawing` aus dem mitgelieferten .NET Framework; kein Node, .NET-SDK oder Electron | in Ordnung |

## 2. Aenderungen

- `installer/lib/elevation.ps1` (neu): `Test-ElevationCanceled` erkennt den Win32-Fehler 1223 (Abbruch der Abfrage)
  auch in verschachtelten Ausnahmen und an der Meldung; `Start-ElevatedPowerShell` startet `powershell.exe` mit
  `-Verb RunAs` und liefert `Started`, `Canceled`, `Message` zurueck, statt eine Ausnahme nach oben zu reichen.
- `installer/install-friday-gui.ps1`: Simulation nur mit `FRIDAY_GUI_TEST=1` (sonst Exitcode 2 und Meldung auf
  stderr); der Start mit Administratorrechten laeuft ueber die neue Bibliothek, ein Abbruch endet mit Exitcode 3 ohne
  Seitenwirkung, ein anderer Fehler mit Exitcode 4 und Meldung. Die Rechtepruefung steht weiterhin vor der
  Oberflaeche, es werden vorher keine Geheimnisse erfasst.
- `installer/install-friday.ps1`: derselbe Weg fuer den CLI-Start; bei Abbruch eine klare Meldung und Exitcode 3,
  ohne Zustandsdatei anzufassen.
- `installer/install-friday-gui.bat`: `%*` durchgereicht.
- `installer/install-friday-gui.vbs` und `Friday installieren.vbs`: bekannte Parameter (`-ResumeRoot` mit
  Anfuehrungszeichen, `-Simulation`) werden uebernommen, unbekannte nicht weitergegeben.
- Dokumentation: `installer/ANLEITUNG.md` bekommt den Abschnitt "Starter und Kommandozeile" mit Tabelle, Parametern
  und dem Hinweis, dass Doppelklick immer die echte Installation startet; `README.md` nennt denselben Weg kurz.

## 3. Nachweise

| Nachweis | Ergebnis |
|---|---|
| `installer/tests/launcher.Tests.ps1` | **PASS, 49 Zusicherungen**: echter `cmd.exe`-Lauf durch die CLI-Batch mit `C:\Temp\Ziel & Partner (Test)` (drei Argumente kommen unveraendert an), echter `cmd.exe`-Lauf durch die GUI-Batch (`-ResumeRoot` kommt an), echter `cscript`-Lauf des Wurzel-VBS (bekannte Parameter an, unbekannter nicht), Abbruch der Abfrage mit echtem `Win32Exception 1223` (nicht gestartet, Abbruch erkannt, Dateibaum vorher/nachher mit SHA-256 identisch), Zugriffsfehler 5 nicht als Abbruch, Simulation ohne Testmodus Exitcode 2, Starter nennen nur `powershell.exe`/`wscript.exe`/`cmd.exe`, vor der Rechtepruefung kein `Read-Host`/`Secure-Field`/Schreibzugriff, alter Starter als Rueckweg mit demselben Ziel, Fortsetzungsstarter mit eigenem Ordner |
| `installer/tests/gui-installer.Tests.ps1` | PASS (setzt jetzt `FRIDAY_GUI_TEST=1` fuer den Testmodus) |
| `installer/tests/gui-wizard-pages.Tests.ps1` | PASS, 108 Zusicherungen (setzt denselben Marker) |
| Parser | `install-friday-gui.ps1`, `install-friday.ps1`, `lib/elevation.ps1`, beide geaenderte Tests je 0 Fehler |
| Installer-Suite | **35/35 Exit 0 in 457 s** (mit dem neuen `launcher.Tests.ps1`) |

## 4. Offen

- Echter Abbruch der Windows-Abfrage durch Klick auf "Nein" braucht einen interaktiven Desktop; hier ist der
  Abbruchpfad mit dem echten Fehlercode und unveraendertem Dateibaum belegt, der Dialog selbst gehoert zu INS-13.
- Download und Entpacken auf einem sauberen Windows sowie der Start aus dem ZIP sind Teil von INS-13.
- Ein Installationspfad mit Nicht-ASCII-Zeichen kommt ueber die Oberflaeche (WinForms an `ProcessStartInfo`), nicht
  durch `cmd`; fuer die Batch-Starter ist das im Dokument vermerkt.

## 5. Ledger-Bezug

- `N-041`: GUI-Batch und beide VBS-Starter reichten Parameter nicht weiter - behoben, mit echtem cmd- und
  cscript-Lauf belegt.
- `N-042`: Ein Abbruch der Windows-Abfrage erschien als Programmfehler, und der Assistent akzeptierte `-Simulation`
  von jedem Aufrufer - behoben durch `lib/elevation.ps1`, Exitcodes 3/4 und den Testmodus-Marker.