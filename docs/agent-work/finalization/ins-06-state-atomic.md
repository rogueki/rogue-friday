# INS-06 — Atomarer Installationszustand (Teilnachweis)

Stand: 2026-10-22. Geprueft an `installer/install-friday.ps1` (`Save-State`) und einem neuen Test.

## 1. Gefundener Fehler (N-015)

`Save-State` schrieb `install-state.json` direkt:

    [IO.File]::WriteAllText($StateFile, ($State | ConvertTo-Json -Depth 6), ...)

Ein Absturz, Stromausfall oder Kill mitten im Schreiben hinterlaesst damit eine **abgeschnittene JSON-Datei**. Der
Assistent haengt seinen gesamten Fortschritt an `done[]` in genau dieser Datei: Ist sie unlesbar, beginnt die
Fortsetzung wieder bei Schritt 1 (mindestens aber verliert sie alle erledigten Schritte und die bereits getroffenen
Entscheidungen wie Stimme, Modell und Ports).

## 2. Aenderung

`Save-State` schreibt jetzt zuerst vollstaendig nach `<StateFile>.tmp`, erzwingt das Leeren auf den Datentraeger
und **ersetzt** dann die Zieldatei (`[IO.File]::Replace`). Fehlt die Zieldatei, wird sie verschoben. Scheitert
`Replace` (andere Dateisystem-Semantik), bleibt der Zustand trotzdem erhalten: Loeschen und Verschieben als
Rueckfallebene. Das Zielverzeichnis wird bei Bedarf angelegt.

Damit gilt: entweder liegt die alte oder die neue vollstaendige Datei vor, nie eine halbe.

## 3. Nachweis

`installer/tests/state-atomic.Tests.ps1` (neu, gruen) extrahiert `Save-State` per AST und prueft:

- erster Aufruf legt die Datei samt fehlendem Verzeichnis an, der Inhalt ist vollstaendig (`done`, `voice_choice`, verschachtelte Werte),
- zweiter Aufruf **ersetzt** den Inhalt (drei Schritte statt zwei, neue Stimme) — kein Anhaengen, keine Dubletten,
- nach beiden Aufrufen liegt **keine** `.tmp`-Datei und **keine** zweite Zustandsdatei herum.

## 4. Offen (INS-06 bleibt offen)

- **Mutex gegen Parallellauf**: ein zweiter Installer-Start wird nicht gesperrt; zwei Laeufe koennten dieselbe
  Zustandsdatei abwechselnd ersetzen (der Ersatz ist dann atomar, aber der letzte gewinnt).
- **Startzeit/Task-Konflikte**: geplante Aufgabe und manueller Start sind nicht gegeneinander abgesichert.
- **Sichere Fortsetzung** nach unerwartetem Abbruch: `done[]` wird nur ergaenzt, ein halb erledigter Schritt wird
  nicht erkannt und zurueckgesetzt.

## 5. Befund 2026-10-22 (Runde 9): keine Sperre im Installer selbst

`install-friday.ps1` enthaelt keine `Mutex`-, `SingleInstance`- oder Sperrlogik. Der einzige Treffer ist ein
**Kommentar** in Zeile 405 („Die Launcher halten ausserdem einen benannten Mutex"), und ein Kommentar ist kein
Nachweis; der GUI-Weg startet `install-friday.ps1` direkt. Zwei Laeufe (GUI plus geplante Aufgabe oder ein zweiter
manueller Start) koennen daher denselben Zustand abwechselnd ersetzen: das Schreiben ist seit `813a430` atomar,
aber der letzte Lauf gewinnt und die Schrittmarken vermischen sich.

Geplanter Zuschnitt (lokal pruefbar, ohne Audio, Cloud oder WSL):

1. benannter, systemweiter Mutex (`Global\FRIDAY-Installer`) mit kurzem Warteversuch; belegt ⇒ klare Meldung mit
   laufender PID statt Doppelstart,
2. Startzeit und PID in der Zustandsdatei ablegen, damit eine tote Sperre nach hartem Absturz nicht dauerhaft
   blockiert (PID allein ist kein Beweis — PIDs werden wiederverwendet),
3. Test: zwei gleichzeitige Prozesse, genau einer darf laufen, der andere bricht mit definiertem Exitcode ab;
   danach Sperre freigeben und erneuter Start besteht.

## 6. Umsetzung 2026-10-22 (Runde 13): Sperre, Exitcode 20 und Zustandssicherung

`installer/lib/installer-lock.ps1` (neu, vom Installer geladen):

- `Enter-InstallerLock` nimmt einen benannten Mutex `Global\FRIDAY-Installer` mit 2 s Warteversuch; ohne
  `SeCreateGlobalPrivilege` (nicht erhoehte Sitzung) faellt er auf `Local\FRIDAY-Installer` zurueck. Ein
  abgestuerzter Vorbesitzer hinterlaesst eine "abandoned" Sperre, die Windows freigibt und die als Erfolg
  gewertet wird - eine tote Sperre blockiert also nie dauerhaft.
- Die Sperrdatei `run\installer.lock.json` traegt PID, Startzeit, Laufkennung, Art und InstallRoot. Der
  zweite Start nennt damit den laufenden Prozess (PID, Startzeit) statt nur "belegt" zu melden.
- `Test-InstallerLockHolderAlive` vergleicht PID **und** Startzeit (Toleranz 2 s): eine wiederverwendete PID
  gilt nicht als laufender Installer.
- Der zweite Start endet mit Exitcode 20 und aendert nichts; die GUI unterscheidet 20 ("Es laeuft bereits
  eine Installation") von einem Fehler. Freigabe erfolgt in `Stop-Install`, am regulaeren Ende und ueber
  das `PowerShell.Exiting`-Ereignis.

Abweichung vom Zuschnitt oben: PID und Startzeit liegen in `run\installer.lock.json` statt in
`install-state.json`. Grund: die Sperre muss **vor** dem Laden des Zustands stehen, und der unterlegene
Prozess darf die Zustandsdatei des laufenden Laufs nicht beschreiben. Inhaltlich sind es dieselben Felder.

Zustandssicherung (`Read-InstallerState` / `Import-InstallerState`, `Save-State`):

- `Save-State` legt nach jedem erfolgreichen Ersetzen `install-state.json.bak` an (letzter vollstaendig
  geschriebener Stand).
- Beim Start wird die Datei geprueft: fehlt sie, ist sie leer, kein JSON-Objekt oder ohne `done[]`, wird die
  Sicherung zurueckgespielt und die Wiederherstellung gemeldet. Ist auch die Sicherung unbrauchbar, bricht
  der Installer mit Klartext ab, statt still von vorn zu beginnen (Fortschritt und Entscheidungen bleiben
  erhalten).
- Gueltiges JSON ohne `done[]` gilt ebenfalls als beschaedigt; ein halb geschriebener Zustand darf nie als
  "noch nichts erledigt" durchgehen.

Nachweise (alle in dieser Umgebung ausgefuehrt, Windows 11, Installer als PowerShell-5.1-Kindprozess):

| Test | Inhalt | Ergebnis |
|---|---|---|
| `installer/tests/installer-lock.Tests.ps1` | Sperre nehmen/freigeben/erneut nehmen; Sperrdatei mit eigener PID und Startzeit; PID-Reuse (gleiche PID, andere Startzeit) und tote PID gelten nicht als Halter; zwei echte Prozesse: genau einer arbeitet, der andere nennt dessen PID; nach dem Ende sofort wieder frei; Verdrahtung im Installer vor Zustand/Migration/Aufgaben | PASS |
| `installer/tests/installer-single-instance.Tests.ps1` | echter Einstiegspunkt: Halter haelt die Sperre, `install-friday.ps1 -InstallRoot "<Pfad mit Leerzeichen und Umlaut>" -UpdateDashboard` endet mit 20, meldet `[BELEGT]` samt Halter-PID und legt weder `resume.bat` noch Protokoll an; ohne Halter laeuft derselbe Aufruf bis zur erwarteten Pruefung (kein Fehlalarm) | PASS |
| `installer/tests/state-recovery.Tests.ps1` | fehlende Datei, abgeschnittenes JSON, JSON ohne `done[]`, Wiederherstellung aus `.bak`, unbrauchbare Sicherung ergibt klares Ergebnis ohne erfundenen Zustand, Abbruchpfad im Installer | PASS |

Negativkontrolle: mit einer Kopie des Moduls ohne `WaitOne` (Sperre wirkungslos) arbeiten beide Prozesse
gleichzeitig (`A=True B=True`) - der Zwei-Prozess-Test ist also nicht leer.

Alle 15 Installer-Tests gruen (`installer/tests/*.Tests.ps1`, Exit 0), inklusive der zuvor bestehenden
`state-atomic`, `gui-installer`, `gui-run-tracker`, `installer-io-contract`, `voice-reference`.

## 7. Offen in INS-06

- Fortsetzung nach Abbruch mit identischer Distro/Location als echter Lauf (der Code traegt beides im Zustand
  und bricht bei Abweichung ab; ein Nachweis am Einstiegspunkt fehlt).
- Konflikt mit der geplanten Aufgabe `FRIDAY_Installation_fortsetzen` (Start waehrend eines laufenden
  Installers) ist nicht separat belegt.
- Ruecksetzen halb erledigter Schritte: derzeit laufen Schritte ohne `done` erneut; ob jeder Schritt dabei
  wiederholbar ist (Distro-Anlage, Enrollment, Voice-Dateien), ist nicht je Schritt geprueft.
- Parameterquotierung fuer Roots mit Leerzeichen/Umlaut ist im Einzelinstanz-Test mitgetestet, aber nicht
  systematisch (Anfuehrungszeichen, `&`, sehr lange Pfade).
## 8. Nachtrag 2026-10-22: Fortsetzungsbefehl und Distributionsuebernahme

Beim Ausfuehren von `resume.bat` auf einem Pfad mit Umlaut (Teil des INS-06-Kriteriums
"Parameterquotierung") kamen zwei echte Defekte heraus:

- **N-018**: `resume.bat` wurde mit `[Text.Encoding]::Default` (Windows-1252) geschrieben, cmd liest
  Batchdateien aber in der Konsolencodepage. Der Umlaut im Zielpfad wurde verstuemmelt, der Befehl fand
  `install-state.json` nicht und landete in der Pruefung "Der frische InstallRoot ist nicht leer" - also einer
  falschen Diagnose fuer einen laufenden Vorgang. Jetzt `chcp 65001` als zweite Zeile plus UTF-8 ohne BOM.
- **N-019**: `$Distro`/`$DistroLocation` wurden erst **nach** der Widerspruchspruefung aus dem Zustand
  uebernommen. Ein Abbruch davor schrieb `-DistroName "Ubuntu"` in `resume.bat` und damit die Umleitung auf die
  Standarddistribution, die INS-06 ausdruecklich ausschliesst. Uebernahme jetzt am Anfang des Custom-Root-Blocks.

Nachweis `installer/tests/installer-resume-distro.Tests.ps1` (neu, PASS):

- Zustand mit `distro_name=FRIDAY-Test` und eigenem Ablageort; Aufruf ohne `-DistroName` uebernimmt beides und
  endet an der naechsten Pruefung (unvollstaendige Installation fuer ein gezieltes Update), ohne WSL aufzurufen.
- Aufruf mit widersprechendem `-DistroName`/`-DistroLocation` bricht mit "widersprechen dem gespeicherten
  Zustand" ab, nennt den gespeicherten Namen und laesst den Zustand unveraendert.
- `resume.bat` zitiert den Zielordner mit Leerzeichen und Umlaut, nennt `FRIDAY-Test` (nicht `Ubuntu`) und
  laeuft in dieser Form: der Lauf findet den Zustand wieder (kein Hinweis auf eine frische Installation).

Stand der offenen Punkte aus Abschnitt 7:

- Fortsetzung mit identischer Distro/Location: auf Argument- und Zustandsebene belegt; ein echter WSL-Lauf
  bleibt INS-13 vorbehalten.
- Aufgabenkonflikt: der Fortsetzungslauf bricht auf diesem Host an "FRIDAY_Dashboard gehoert zu einem anderen
  Installationspfad" ab - fremde Aufgaben werden also nicht ueberschrieben. Ein eigener Test mit zwei
  Installationswurzeln existiert daneben in `dashboard-task-migration.Tests.ps1`.
- Ruecksetzen halb erledigter Schritte und systematische Quotierung (Zeichen wie `&`, sehr lange Pfade) bleiben
  offen.
## 9. Nachtrag 2026-10-22: Sperrdatei und Leerpruefung

Die eigene Sperre aus Abschnitt 6 haette fast die Erstanlage mit eigenem Root verhindert: `Enter-InstallerLock`
legt `<Root>\run\installer.lock.json` an, die Leerpruefung fuer frische Zielordner zaehlte aber jedes Element im
Root. Ein leerer Ordner waere damit als "nicht leer" abgewiesen worden (N-020).

- `Test-FreshRootEmpty` prueft den Ordner jetzt selbst und ignoriert genau ein `run`-Verzeichnis, das ausser der
  eigenen `installer.lock.json` nichts enthaelt. Alles andere bleibt belegt.
- `installer/tests/fresh-root.Tests.ps1` deckt sechs Faelle der Funktion ab und faehrt zusaetzlich den echten
  Einstiegspunkt mit leerem Zielordner samt Umlaut an; der Lauf erreicht die naechste Pruefung statt an
  "nicht leer" zu scheitern.
## 10. Nachtrag 2026-10-22: Wiederholbarkeit halb erledigter Schritte

Ein Lauf, der mitten in einem Schritt abbricht, hinterlaesst Artefakte, aber keinen Fortschrittseintrag
(`MarkDone` kommt zuletzt). Ein erneuter Lauf muss diese Artefakte akzeptieren, den gespeicherten Fortschritt
nicht zuruecksetzen und den Schritt wiederholen koennen.

**Nachweis `installer/tests/step-repeatability.Tests.ps1` (neu, PASS):**

- Fortschritt ist idempotent: `MarkDone` zweimal fuer denselben Schritt erzeugt keinen Doppeleintrag, auch nicht
  nach dem erneuten Laden aus der Datei.
- Echter Einstiegspunkt mit halb erledigten Artefakten: Zielordner mit vorhandener `config/voice.json`, halber
  Modellkopie (`models/tts/de_DE-kerstin-low.onnx`) und halb kopiertem `voice/partial/voice_persona.py`, Zustand
  mit `done = preflight, files`. Der Lauf endet an der erwarteten Pruefung "unvollstaendig", **nicht** an
  "nicht leer", und laesst Fortschritt (`done` bleibt bei zwei Eintraegen), Distributionsname und Artefakte
  unveraendert.
- Die teuren Schritte sind wiederholbar: `setup_root.sh` prueft den Benutzer vor dem Anlegen (`id "$U" ||
  useradd`), legt Verzeichnisse mit `-p` an; `prepare_voice_pairs.py` ueberschreibt weder Modellkopie noch
  vorhandene Referenz; die Aufgabenregistrierung nutzt `-Force`.

Damit ist der Punkt "Ruecksetzen halb erledigter Schritte" aus Abschnitt 7 belegt. Offen bleibt die
systematische Quotierung (`&`, sehr lange Pfade), die als eigener Punkt weiterlaeuft.
## 11. Nachtrag 2026-10-22: Quotierung von Sonderzeichen und langen Pfaden

Der Fortsetzungsbefehl bettete den Zielordner woertlich ein. Zwei Zeichen brechen das in `cmd.exe` auch
innerhalb von Anfuehrungszeichen nicht zuverlaessig: `%` wird expandiert, und ein Pfad mit abschliessendem
Backslash kann das schliessende Anfuehrungszeichen maskieren. Zusaetzlich war der Ordner in der Datei
festgeschrieben, sodass ein Verschieben die Datei falsch werden liess (N-029).

Jetzt wechselt `resume.bat` zuerst in den eigenen Ordner (`cd /d "%~dp0"`) und uebergibt `-InstallRoot "%CD%"`.
Damit steht der Zielordner nicht mehr woertlich in der Datei. Eingebettete Werte (Skriptpfad, Distributionsname,
Ablageort) laufen durch `ConvertTo-BatchArgument`: Anfuehrungszeichen, `%` verdoppelt, abschliessender Backslash
als `\.`.

**Nachweis `installer/tests/path-quoting.Tests.ps1` (neu, PASS):**

- `ConvertTo-BatchArgument`: `&` bleibt unveraendert, `%` wird verdoppelt, `\` am Ende wird entschaerft, Umlaute
  und `!` bleiben, leerer Wert ergibt `""`.
- Lauf mit Zielordner `Ziel & 100% !wichtig! ü'ordner`: erreicht die erwartete Pruefung, schreibt `resume.bat` mit
  `cd /d "%~dp0"`, `-InstallRoot "%CD%"` und entschaerftem Ablageort; der Sonderzeichenpfad steht nicht woertlich
  in der Datei.
- `resume.bat` wird aus einem Ordner `Kopie & 100% !x! ü'ordner` heraus aufgerufen (wie ein Doppelklick) und nennt
  genau diesen Ordner in seiner Ausgabe - kein Rueckfall auf `C:\Friday`.
- Sehr langer Zielordner mit ueber 260 Zeichen: Sperrdatei wird dort angelegt, der Pfad kommt unveraendert an und
  die Sperre wird wieder entfernt (`LongPathsEnabled=1` auf diesem Host).

Offen bleibt nur die Fortsetzung in einer echten WSL-Distribution (INS-13).