# INS-08: Rechte Assistentenoberflaeche mit Originalbild

Stand 2026-10-22. Dieses Dokument beschreibt die **Grundlage** der neuen Assistentenoberflaeche und
belegt sie. Die Seiten selbst (Willkommen, Systempruefung, Einrichtung, technische Arbeit, Ergebnis)
sind noch nicht auf den Rahmen umgezogen; INS-08 bleibt deshalb offen.

## 1. Ausgangsbefund

Der vorhandene Assistent (`installer/install-friday-gui.ps1`, 51 KB) ist ein WinForms-Fenster mit acht
Tabs, nominell 820 x 690. Er zeigt das vom Nutzer gelieferte Bild nicht, hat keine rechte Arbeitsflaeche
ueber dem Motiv, keinen Kontrastnachweis und keine Tastaturpruefung. Das Bild lag nur als
`installer_background.png` im Wurzelverzeichnis des Projekts und wurde von keinem Skript gelesen.

## 2. Was jetzt existiert

| Datei | Inhalt |
| --- | --- |
| `installer/assets/installer_background.png` | Originalbild, bytegleich zur Wurzeldatei |
| `installer/gui/layout.ps1` | Layoutvertrag als Daten (Fenstergroessen, Aufteilung bei x=624, Innenabstaende, Fusszeile 80, Farben, Schriftgroessen), Cover-Rechnung, Ausschnittsrechnung, WCAG-Kontrast |
| `installer/gui/background.ps1` | Bild laden, mittig beschneiden, rechte Flaeche zu 94 % darueber, Trennlinie; dokumentierte Ersatzflaeche bei fehlendem Bild |
| `installer/gui/shell.ps1` | Fenster mit Bild, Inhaltsbereich, genau einem Fortschrittsbalken, „Details"-Verweis, Fusszeile mit Abbrechen/Zurueck/Weiter, Enter und Escape gebunden |
| `installer/tests/gui-shell-layout.Tests.ps1` | Abnahme am echt gezeichneten Fenster |

Das Bild wird nicht gestreckt: aus dem Original wird der mittige Ausschnitt entnommen, der die
Clientflaeche genau fuellt (gleicher Faktor in beiden Achsen); beschnitten wird nur am aeusseren Rand.
Damit das Motiv unter der Arbeitsflaeche sichtbar bleibt, sind Inhaltsbereich, Beschriftungen und
Fusszeile durchsichtig; die Flaeche entsteht im Hintergrundbild selbst mit 94 % Deckkraft.

## 3. Nachweise (PASS, 2026-10-22)

`installer/tests/gui-shell-layout.Tests.ps1` zeichnet das Fenster mit `DrawToBitmap` und misst am
Ergebnis. **166 Zusicherungen, Exit 0.**

| Bereich | Pruefung |
| --- | --- |
| Bildherkunft | SHA-256 `43D46072...64B72` wie im Masterplan; bytegleich und gleich gross wie die Wurzeldatei |
| Cover-Rechnung | deckt die Flaeche vollstaendig, mittig, unverzerrt; Ausschnitt liegt im Original; beide Achsen mit gleichem Faktor |
| Bild sichtbar | links mindestens 20 verschiedene Farben in einem Raster ueber die Motivflaeche |
| Kontrast | gemessen am Hintergrundmaterial (Bild plus 94 % Flaeche), nicht an Konstanten: Titel `>= 7,0:1`, Text `>= 4,5:1`, auch am hellsten Punkt unter der Flaeche; hellster Punkt R < 96 |
| Schrift gezeichnet | helle Schriftpixel im Titelband des gerenderten Bildes |
| Aufteilung | Inhalt beginnt bei `x = 624 + 32`, oben 36; Fusszeile 80 hoch und am Fensterrand; Hauptaktion rechtsbuendig mit 32 Rand; alle Aktionen in der Fusszeile und in deren Grenzen |
| Genau ein Balken | genau ein Fortschrittsbalken, genau ein „Details"-Verweis, beide bei technischer Arbeit sichtbar, Wert uebernommen |
| Kein Ueberlauf | kein Bedienelement ragt aus seinem Bereich (bei 1200 x 760 und 1024 x 680) |
| Tastatur | Enter an die Hauptaktion, Escape an Abbrechen gebunden; alle Aktionen mit Tab erreichbar; Balken nicht fokussierbar |
| Fehlendes Bild | Ersatzflaeche `#0B1220`, Begruendung im Zustand, Kontrast weiterhin `>= 4,5:1`, kein Absturz |
| Abhaengigkeiten | Rahmen kommt ohne Node, Python, pnpm oder npm aus |

Screenshots: `%TEMP%\friday-shell-1200x760.png` und `%TEMP%\friday-shell-1024x680.png`.

### Gegenproben

| Gegenprobe | Erwartung | Beobachtung |
| --- | --- | --- |
| Textfarbe auf `#8A8A8A` | Kontrastpruefung schlaegt an | `Standardgroesse - Kontrast fuer grosse Schrift zu gering: 5,1:1`, Exit 1 |
| Bildpfad auf fehlende Datei | Bildpruefung schlaegt an | `Standardgroesse - links ist kein Bild sichtbar (3 Farben).`, Exit 1 |

Beide Dateien wurden anschliessend byte-identisch wiederhergestellt (SHA-256 vor/nach gleich), danach
lief der Test wieder auf PASS.

Zusatzbefund aus der Arbeit: `DrawToBitmap` auf dem **Formular** zeichnet die Titelleiste mit und
verschiebt den Inhalt um deren Hoehe; gemessen wird deshalb am Clientbereich (`shellPanel`). Ohne
`Show()` erscheint der Hintergrund gar nicht - der Test zeigt das Fenster vor der Aufnahme.

## 4. Offen (INS-08 bleibt offen)

1. Die acht Tabs des vorhandenen Assistenten liegen noch nicht auf dem neuen Rahmen; Willkommen mit
   Bestandserkennung, Systempruefung, Einrichtung, technische Arbeit mit einem Schrittindikator,
   Ergebnis und Neustart fehlen als Seiten.
2. Der Kontrast ist bei 100 % gemessen. Skalierung auf 125/150/200 % und ein echter Tastaturdurchlauf
   mit Fokusring und Reihenfolge stehen aus.
3. Die „Details"-Ansicht ist als Verweis vorhanden, aber noch ohne Dialog mit gefilterten Protokollen.
4. Der Bildvergleich mit dem Nutzer-Original ist ueber den Hash belegt, nicht ueber eine visuelle
   Abnahme durch den Nutzer.