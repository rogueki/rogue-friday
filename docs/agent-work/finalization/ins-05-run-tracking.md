# INS-05 — Laufkennung, Stillstandsmeldung und Transportfehler (Teilnachweis)

Stand: 2026-10-22. Geprueft an `install-friday-gui.ps1`, `install-friday.ps1` und einem neuen Transporttest.

## 1. Gefundener Fehler (N-012)

Die Transportpruefung des Backends akzeptierte `voiceChoice` nur mit `1` oder `2`
(`-notin @('1','2')`), waehrend die Oberflaeche seit INS-04 die dritte Stimme (eigene MP3/WAV) anbietet.
Ein Lauf mit „Eigene MP3/WAV" waere also mit `Ungueltige GUI-Auswahl: voiceChoice` abgebrochen — die neue Option
war ueber den echten Transport unbenutzbar, obwohl die Oberflaeche sie anzeigte.

Behoben: `voiceChoice` wird gegen `1,2,3` geprueft, `voiceMode` und `length` weiterhin gegen `1,2`. Die Pruefung der
Referenzdatei bleibt bewusst im Stimmschritt, weil ein fortgesetzter Lauf die Referenz bereits im Zustand hat und
das Feld dann leer bleiben darf.

## 2. Laufkennung und Stillstandsmeldung

- Jeder Start erzeugt eine **12-stellige Laufkennung** (`New-RunId`), setzt sie als `FRIDAY_INSTALL_RUN` in die
  Umgebung des Kindprozesses und schreibt sie als erste Protokollzeile. Das Backend gibt sie als
  `[GUI] Lauf <id>` aus. Damit ist ein Protokoll nach einer Wiederholung eindeutig einem Lauf zuzuordnen.
- Der Timer fuehrt `lastOutputAt` mit und meldet nach **15 Minuten ohne Ausgabe** einmalig einen Hinweis. Er bricht
  **nicht** ab: ein Abbruch mitten in der Einrichtung (WSL-Import, Modell-Download) zerstoert mehr als er rettet.
  Der Test sichert diese Grenze ausdruecklich ab (`kein Abbruch bei Stillstand`).

## 3. Nachweise

`installer/tests/gui-run-tracker.Tests.ps1` (neu, gruen):

- 50 Laufkennungen sind eindeutig und 12-stellig hexadezimal.
- Stillstand: 0 und 14 Minuten gelten nicht, 15 Minuten gelten, fehlender Zeitstempel blockiert nicht.
- Die Oberflaeche setzt die Kennung in die Umgebung, schreibt sie ins Protokoll und meldet Stillstand ohne Abbruch.
- **Echter Transporttest** mit dem Backend im Simulationsmodus: `voiceChoice=3` wird angenommen (Exit 0, `[GUI]`
  Pruefung erscheint), `voiceChoice=4` wird mit `Ungueltige GUI-Auswahl: voiceChoice` abgelehnt.

Regression: `gui-installer.Tests.ps1` (drei Simulationen, Rendering, DPAPI, Aufraeumen), `installer-io-contract.Tests.ps1`
(28 Antworten, 7 Geheimnisse, 19 gefuehrte Prompts) und `voice-reference.Tests.ps1` bleiben gruen.

## 4. Offen (INS-05 bleibt offen)

- **Strukturierte Ereignisse**: der Transport ist weiterhin zeilenorientiert (`Schritt`, `[GUI]`, `[OK]`, `[FEHLER]`)
  mit Protokoll 1. Ein echtes Ereignisformat (JSON je Zeile, Ereignis-IDs, Fortschrittsanteil) waere Protokoll 2 und
  muss Oberflaeche, Backend und die Vertragsdokumentation gemeinsam aendern.
- **Harter Timeout** je Schritt: nicht implementiert, weil ein Abbruch fremder Werkzeuge (WSL-Import, Downloads) ohne
  fachliche Grenze schaedlich waere; die Stillstandsmeldung ist die sichere Vorstufe.
- Parallele Laeufe sind nicht gesperrt (nur die Oberflaeche verhindert einen zweiten Start im selben Fenster).
