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
## 5. Nachtrag 2026-10-22: Seiten auf dem Rahmen

Die acht Registerkarten sind ersetzt. `install-friday-gui.ps1` baut seine Seiten jetzt in der Seitenflaeche
des Rahmens auf; die gesamte Ablauflogik (Zustand lesen, Fortsetzen, Pruefungen, Zugangsdaten, Start des
Installers, Ereignisstrom, kooperativer Abbruch) ist unveraendert uebernommen.

| Seite | Inhalt |
| --- | --- |
| Systempruefung | echter Befund zu Windows, RAM, freiem Platz, Grafik und WSL |
| Installationsort | Ordner, Distributionsname, WSL-Ablage, fuenf dokumentierte Uebernahmeoptionen |
| Sprache & Stimme | Sprachbetrieb, Stimme, Referenzdatei, Geraete |
| Persoenlichkeit | Name, Wake Word, Anrede, Charakter, Antwortlaenge |
| KI-Zugang | Anbieter, Basis-URL, Modellname, drei verdeckte Schluesselfelder |
| Zugaenge | Linux-Benutzer und -Passwort, Kimi- und ElevenLabs-Schluessel |
| Zusammenfassung | vollstaendige Zusammenfassung vor dem Start |
| Installation | ein Schrittindikator, **ein** Fortschrittsbalken, eine Kurzmeldung, Details nur auf Klick |

Der Fortschritt kommt aus der Schrittkennung des Ereignisses (`Get-GuiStepPercent`) gegen die
Schrittfolge des Installers; unbekannte Schritte lassen den Balken stehen, statt einen erfundenen Wert
zu zeigen. Das Protokoll liegt nicht mehr auf einer Seite: es sammelt im Hintergrund und erscheint
ausschliesslich im Dialog hinter „Details". Die Fusszeile traegt Weiter/Installieren, Zurueck und
Abbrechen; Abbrechen sendet die kooperative Abbruchbitte, nicht `taskkill`.

**Nachweise:** `gui-wizard-pages.Tests.ps1` (90 Zusicherungen, Exit 0) prueft:

| Bereich | Pruefung |
| --- | --- |
| Schrittfolge | die Reihenfolge der Oberflaeche ist Zeichen fuer Zeichen die des Installers (aus dessen Quelltext gelesen); keine Dubletten; erster Schritt < 10 %, letzter genau 100 %, unbekannt -1, monoton |
| Aufbau | keine Registerkarten mehr; acht Seiten mit Titel und Erklaerung; Rahmen, Layoutvertrag und Bild eingebunden |
| genau ein Balken | die Oberflaeche legt keinen eigenen Balken an, sie fuellt den des Rahmens |
| Diagnose | kein dauerhaftes Protokollfeld; „Details" oeffnet einen Dialog; Abbrechen sendet die Abbruchbitte |
| echte Seiten | Simulationslauf Exit 0; acht Bilder 1200x760; links je >= 20 Farben (Motiv), rechts je >= 200 helle Punkte (Felder und Schrift); jede Seite unterscheidet sich sichtbar von der vorigen |

**Gegenproben:** vertauschte Schrittfolge in der Oberflaeche -> „Schrittfolge weicht ab: Installer
[preflight,...,keepalive,hermes...]" Exit 1; eine Seite umbenannt -> „Seite 'keysPage' fehlt." Exit 1.
Beide Dateien danach byte-identisch wiederhergestellt (SHA-256).

Gesamtstand: **29/29 Installer-Tests Exit 0.**

## 6. Nachtrag 2026-10-22: Skalierung und Tastatur

**Skalierung.** `Get-GuiLayout` nimmt einen Skalierungsfaktor; `New-GuiShell -Scale` skaliert Abstaende,
Fusszeile, Schaltflaechen und Schriften mit. Der Assistent liest die Skalierung aus dem System
(`Graphics.DpiX / 96`) und uebergibt sie, statt eine feste Groesse anzunehmen. Gemessen wird am gezeichneten
Fenster: `gui-dpi.Tests.ps1` (149 Zusicherungen, Exit 0) prueft je Stufe 125/150/200 %:

| Pruefung | Ergebnis |
| --- | --- |
| Vertrag | Innenabstand, Fusszeilhoehe, Inhaltsbeginn und Aufteilung wachsen mit dem Faktor; Inhalt bleibt im Fenster; die Mindestgroesse derselben Stufe geht auf |
| Bild | links je >= 20 Farben des Originals |
| Kontrast | Titel >= 7,0:1, Text >= 4,5:1 auf dem tatsaechlichen Hintergrund |
| Schrift | der Titel wird in der skalierten Groesse gezeichnet |
| Aktionen | rechtsbuendig, senkrecht zentriert, vollstaendig in der Fusszeile, Mindesthoehe mitgewachsen |
| Ueberlauf | kein Bedienelement ragt aus seinem Bereich |

**Tastatur.** Der Assistent laeuft im Selbsttest die echte WinForms-Tabulatorreihenfolge jeder Seite durch
(`SelectNextControl`, `Get-FocusedControl`) - mit neutralem Installationsordner, damit kein vorhandener Zustand
Felder sperrt. Fuer jede Seite gilt: jedes bedienbare Element wird erreicht, die Hauptaktion (Seiten 1-7) und
der Abbruch (alle Seiten) sind erreichbar. Der Lauf meldet die Treffer je Seite (`focus=0=3,1=12,...`);
`gui-wizard-pages.Tests.ps1` verlangt acht Seiten mit je mindestens einem Treffer, mindestens 40 insgesamt und
mindestens acht auf der feldreichsten Seite. Seite 8 (Installation) hat keine eigenen Bedienfelder; dort startet
der Durchlauf am Abbruch.

**Gegenproben:** Innenabstand nicht skaliert -> „125% - Innenabstand ist 32 statt 40." Exit 1; Tabulatorlauf
nach zwei Schritten abgebrochen -> Lauf Exit 1, Test „Der Simulationslauf endete mit Exitcode 1."; beide
Dateien byte-identisch wiederhergestellt (SHA-256).

Zusatzbefund: `Load-RootState` leert Passwort- und Schluesselfelder bewusst. Im Selbsttest duerfen die
synthetischen Zugangsdaten deshalb erst **nach** dem Tastaturdurchlauf gesetzt werden, sonst blockiert die
Meldung „Linux-Passwort fehlt oder die Wiederholung stimmt nicht." den Lauf als modaler Dialog.

Gesamtstand: **30/30 Installer-Tests Exit 0.**

## 7. Weiterhin offen

1. Ein echter Wechsel der Anzeigeskalierung im Betrieb (Bildschirm mit 125/150/200 %) ist auf dieser Maschine
   nicht herstellbar; gemessen ist die skalierte Geometrie und Typografie, nicht ein Systemwechsel.
2. Vorlesbarkeit mit einem Screenreader und ein Fokusring-Durchlauf durch einen Menschen stehen aus.
3. Der Dialog „Details" filtert noch nicht nach Schwere; er zeigt das Protokoll des Laufs.
4. Die Zustandsmaschine des Plans (interaction-required fuer die Sprachaufnahme) kommt mit INS-09.