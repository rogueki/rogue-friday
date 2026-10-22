# INS-04 — Drei Stimmen mit eigenem Backend-Stimmplatz

Stand 2026-10-22, Bestandsaufnahme vor der Umsetzung. Master §8.1 (Zeile 292):

> voiceChoice 1/2/3 in GUI/Backend synchronisieren; separate benutzerseitige Auswahl und kompatiblen
> Backend-Stimmslot erhalten. Eigene MP3/WAV validieren, fehlende Standardreferenz erklären.

## 1. Was heute existiert (geprüft im Code)

| Ort | Stand |
|---|---|
| GUI-Antwortprüfung (`install-friday.ps1:57`) | akzeptiert `1`, `2`, `3` |
| Abfrage (`:1347-1350`) | `Stimme [1-3]`, Standard je nach Zustand/Assistentenname |
| Option 3 | eigener Zweig: Pflichtpfad, `Test-VoiceReferenceFile` prüft MP3/WAV, Abbruch bei fehlender oder unbrauchbarer Datei (`:1360-1365`) |
| Speicherung | Option 3 schreibt `voice_reference_own` **und** belegt den weiblichen Platz (`voice_choice = 'friday-female'`, `:1354`, `:1379-1388`) |
| Begründung im Code | `fast_tts`, `prepare_voice_pairs` und die Stimmenliste im Dashboard kennen nur zwei Plätze |
| Python-Persona (`installer/voice/voice_persona.py:10`) | `CHOICES = ("friday-female", "classic")` |
| Referenzpaare (`installer/voice/prepare_voice_pairs.py:30-35`) | feste Zuordnung je Platz, `bundled` wählt `friday_ref`/`jarvis_ref` |

Damit ist die **Auswahl** vollständig und validiert, der **Stimmplatz** aber nicht: eine eigene Aufnahme
überschreibt konzeptionell den F.R.I.D.A.Y.-Platz, und `voice_persona` lehnt einen dritten Namen ab.

## 2. Was fuer einen echten dritten Platz zu aendern ist

1. `voice_persona.py`: `CHOICES` um `custom` erweitern, `_reference` nutzt `custom-reference.{wav,mp3}`,
   Fallback-Stimme und Streaming-Paar explizit zuordnen (kein stilles Ausweichen auf den weiblichen Platz).
2. `prepare_voice_pairs.py`: dritter Eintrag `custom` mit eigenen Referenzdateien und eigener Entscheidung für
   `bundled` (die eigene Aufnahme ist die Referenz, kein Paketmodell).
3. `install-friday.ps1`: Option 3 setzt `voice_choice = 'custom'` und kopiert die validierte Datei nach
   `config/voice-references/custom-reference.*`; `voice_reference_friday-female` bleibt unberührt
   (Zurückwechseln liefert wieder die beiliegende Stimme). `update-voice-personas.ps1` und `friday_voice.py`
   müssen `custom` mitschleusen.
4. Dashboard-Stimmenliste: dritter Eintrag, solange keine eigene Referenz existiert mit klarer Begründung
   deaktiviert (fehlende Standardreferenz erklären, nicht stumm ausblenden).
5. Rückweg: `voice_reference_own` bleibt als Altwert lesbar; ein Zustand ohne `custom`-Referenz fällt auf
   `friday-female` zurück und sagt das im Protokoll.

## 3. Abnahmestrategie (kein Hörversuch, sondern messbar)

- Drei Optionen: Schrittabfrage, GUI-Antwort und Zustand führen zu `friday-female` / `classic` / `custom`.
- Validierung: leer, fehlend, beschädigt und nach dem Einlesen gelöscht → Abbruch mit klarer Meldung.
- **Audioausgabe messbar**: lokale TTS mit jedem der drei Plätze auf einen kurzen Satz anwenden, WAV schreiben und
  Dauer > 0,3 s sowie eine von Stille unterscheidbare Amplitude prüfen (kein Hörversuch nötig, aber echte
  Synthese).
- Wechsel: nach Hin- und Zurückwechseln ist die F.R.I.D.A.Y.-Referenz byte-gleich mit der beiliegenden Datei.
- Konsistenz: Persona, Wake-Konfiguration und `voice_choice` im Zustand nennen denselben Platz.

## 4. Fortschritt

### Erledigt (2026-10-22): Python-Seite

- `voice_persona.CHOICES` enthaelt `custom`; `PIPER_FALLBACK` ordnet jedem Platz seine Basisstimme zu
  (`custom` nutzt dieselbe Piper-Basis wie der weibliche Platz, unterscheidet sich aber durch seine eigene
  Referenz). Der eigene Platz bekommt **keinen** stillen Fallback auf die weibliche Referenz.
- `prepare_voice_pairs`: Referenzquellen und Paketreferenz sind jetzt pruefbare Helfer
  (`reference_sources`, `bundled_reference`). `custom` hat bewusst keine Paket-Referenz; ohne eigene Aufnahme
  meldet `prepare` `False` statt eine fremde Stimme zu unterschieben. Der Whisper-Import ist auf den Fall
  "kein Referenztext vorhanden" verschoben.
- `fast_tts/server.py` laedt und liefert den dritten Platz, sobald `custom.wav`/`custom.txt` vorliegen.
- Tests: `test_voice_persona.py` deckt den eigenen Platz ab (resolve nur mit eigener Referenz, eigene
  Streaming-Datei, Piper-Basis, kein Film-Filter, kein Paket-Fallback, Server liefert `custom`) - 8/8 gruen.

### Offen

- Installer-Verdrahtung (Option 3 -> `voice_choice = 'custom'`, Kopie der validierten Datei nach
  `config/voice-references/custom-reference.*`, Zustandspruefungen), `update-voice-personas.ps1`
  (`$pairs`), `friday_voice.py` und die Dashboard-Stimmenliste.
- Messbare Audioausgabe fuer alle drei Plaetze.

Bewusst **keine** Zwischenstufe, in der Option 3 auf `custom` zeigt, bevor diese vier Stellen mitziehen: sonst
waere die Auswahl erreichbar, die Stimme aber nicht installiert.

## 5. Reihenfolge der Umsetzung

Python-Seite zuerst (Persona + Referenzpaare) mit eigenen Tests, danach Installer-Verdrahtung, dann
Dashboard-Liste, zuletzt die messbare Audioausgabe für alle drei Plätze. Kein Zwischenstand, in dem Option 3
wählbar ist, aber nicht funktioniert.