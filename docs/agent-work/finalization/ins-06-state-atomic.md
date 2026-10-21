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
