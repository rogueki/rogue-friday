# INS-05 — Strukturierter Ereignisstrom (Protokoll 2)

Stand 2026-10-22. Aufgabe aus Master §8.1 (Zeile 293):

> Strukturierte Ereignisse, asynchroner UI-Reader, redigierte Details, Timeout/Heartbeat, eindeutige
> Laufzuordnung implementieren. Download/Pip/Modell-Warmup getrennt benennen.
> Geprüft: Paketspam, Multibyte-Umlaute, Zeilenfragment, unbekannte Version, fehlendes Abschlussereignis,
> stderr und lange stille Phase. GUI reagiert weiter und meldet keine falschen Prozent/Erfolge. Der Rückweg
> betrifft nur den Protokolladapter, die Backendinstallation bleibt prüfbar.

Bereits vorhanden (INS-05, erste Hälfte): Laufkennung `FRIDAY_INSTALL_RUN`, asynchroner Zeilenleser mit
Redaktion, Stillstandsmeldung nach 15 Minuten. Dieser Schritt ergänzt den strukturierten Ereignisstrom.

## 1. Umsetzung

### `installer/lib/gui-protocol.ps1` (neu, dot-sourced in Installer und GUI)

| Funktion | Verhalten |
|---|---|
| `ConvertTo-GuiEventLine($Event)` | eine Zeile `[FRIDAY-EVENT]{"v":2,"type":…,…}`; Zeilenumbrüche im Wert werden ersetzt, damit die Zeilenübertragung nicht zerreißt |
| `ConvertFrom-GuiEventLine($Line)` | `Kind='event'` nur bei gültigem JSON-Objekt **mit** `v` und `type` **und** `v=2`; sonst `Kind='text'` mit der unveränderten Zeile |
| `Write-GuiEvent($Type, $Data)` | schreibt nur, wenn `FRIDAY_INSTALL_RUN` gesetzt ist — ein Doppelklick-Lauf bleibt eine reine Konsole |

Der Rückweg ist bewusst konservativ: unbekannte Version, fehlende Felder, kaputtes JSON, Zeilenfragmente und
Klartext landen **als Text** im Protokoll. Nichts wird still verschluckt, nichts wird geraten. Eine alte GUI
liest die Präfixzeilen einfach als Text; eine neue GUI versteht beide Formen.

### `installer/install-friday.ps1`

- Ereignisse: `run` (Start mit Modus und Laufkennung), `step` `start`/`done` (aus `Enter-Step` und `MarkDone`),
  `download` `start`/`done`/`failed` und `pip` `start` — damit sind Download, Paketinstallation und der
  eigentliche Schritt getrennt benannt.
- `Enter-Step($Name)` prüft zuerst die Abbruchbitte (INS-07) und meldet dann den Schrittstart. Alle 15
  Schrittblöcke laufen darüber, der Name wird aus dem `IsDone`-Block abgeleitet (Test prüft die Gleichheit).

### `installer/install-friday-gui.ps1`

- Beide Ausgabeströme (stdout **und** stderr) laufen jetzt über `Receive-BackendLine`, das Ereignisse in
  lesbaren Text übersetzt (`Schritt qwen gestartet`, `Download … fertig`) und alles andere unverändert ins
  Detailprotokoll schreibt.
- `Format-GuiEvent` erzeugt Anzeigetexte **nur aus Feldern** des Ereignisses. Prozentzahlen oder Erfolge werden
  nirgends aus Text abgeleitet; der Status folgt weiterhin dem Exitcode des Backends.
- Der stderr-Strom wird nicht mehr am Ereignisleser vorbei geschrieben — genau dort waren Zeilenfragmente und
  Fremdausgaben (pip, curl, pnpm) bisher ungefiltert aufgetaucht.

## 2. Nachweise (ausgeführt)

`installer/tests/gui-protocol.Tests.ps1` (neu, PASS):

- Erzeugung: genau eine Zeile, Präfix, `v=2`, Felder übernommen, **Umlaute (äöüß), Anführungszeichen und
  Backslash** überstehen den Weg durch JSON und zurück.
- Lesen: eigener Datensatz wird als Ereignis erkannt; neun Gegenfälle bleiben Text und unverändert —
  Klartextzeile, leere Zeile, Präfix ohne JSON, kaputtes JSON, **Zeilenfragment**, **unbekannte Version (`v=3`)**,
  fehlende Version, Version als Text, JSON ohne Objekt.
- Schreiben: ohne `FRIDAY_INSTALL_RUN` entsteht keine Ereigniszeile, mit gesetzter Laufkennung genau eine.
- Verdrahtung: alle 15 Schrittblöcke beginnen mit `Enter-Step '<name>'` **und** der Name stimmt mit dem
  `IsDone`-Block überein; `MarkDone` meldet `done`; `download` und `pip` werden gemeldet; die GUI schreibt keine
  Rohzeilen mehr direkt, beide Ströme laufen über `Receive-BackendLine`, und die GUI rechnet keine Prozentwerte.
- Echter Einstiegspunkt mit `FRIDAY_INSTALL_RUN=protocol-e2e`: der Lauf gibt mindestens ein Ereignis aus, jede
  Ereigniszeile ist mit `ConvertFrom-GuiEventLine` lesbar, und das Laufereignis nennt Laufkennung und Modus
  (`update-dashboard`) korrekt.

Gesamtstand nach diesem Schritt: **20/20 Installer-Tests Exit 0**.

## 3. Abschluss- und Warmup-Ereignisse (Nachtrag, N-024)

- `Write-GuiRunDone($Code, $State)` schreibt **genau ein** `run`-Ereignis mit `state` und `exitCode`; die
  Einmal-Garantie hält `$script:GuiRunDoneWritten`. Aufrufer: `Stop-Install` (`failed`, Code 1) und das normale
  Ende (`ok`, Code 0, bzw. 1 wenn die Dashboardprüfung fehlschlägt).
- Der Qwen-Start meldet `warmup start/done` (mit Sekunden) zwischen `start-qwen-server.ps1` und der
  Antwortprüfung, damit ein langsamer Modellstart nicht als anonymer Teil des Schritts verschwindet.
- Die GUI kennt beide Typen, merkt sich `$script:sawRunDone` und schreibt bei fehlendem Abschlussereignis
  `[HINWEIS] Der Installer hat kein Abschlussereignis gesendet; massgeblich ist der Exitcode.`
- Nachweis: `gui-protocol.Tests.ps1` prüft die Einmal-Garantie (zwei Aufrufe, eine Zeile, erste gewinnt), die
  Aufrufstellen, die Lage der Warmup-Ereignisse (nur im Qwen-Schritt, zwischen Modellstart und `Wait-Http`) und im
  echten Einstiegspunkt genau ein Abschlussereignis mit `state=failed`/`exitCode=1`.

## 4. Offen in INS-05

- **Harte Zeitlimits pro Schritt**: für Download (3600 s) und pip (gezieltes Beenden bei Abbruch) umgesetzt und in
  `supervised-processes.md` belegt; weiterhin offen sind Zeitlimits für `wsl.exe`-Aufrufe.
- **Voice-Warmup**: Schritt 14 meldet `warmup start/done` fuer `voice` (mit Sekunden) um die `listening`-Pruefung.
- **Abgestürzter Prozess**: stirbt der Installer ohne Ereignis, bleibt nur der Exitcode plus der Hinweis der GUI.
- **Lastfall belegt**: 10 000 gemischte Zeilen (2 500 Ereignisse, 2 500 Klartext, 2 500 unbekannte Version, 2 500 leer)
  werden in 0,68 s korrekt getrennt. Die Reaktionsfähigkeit der Fensteroberfläche unter dieser Last ist headless
  nicht belegbar.