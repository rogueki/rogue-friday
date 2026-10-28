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

### Offen - vollstaendige Liste der Zwei-Stimmen-Stellen (Stand 2026-10-22, per Suche geprueft)

Alle folgenden Stellen kennen heute nur `friday-female` und `classic` und muessen `custom` mitziehen. Die Liste
ist die Abarbeitungsreihenfolge:

| Datei:Zeile | Was dort passiert | Aenderung |
|---|---|---|
| ~~`install-friday.ps1:1354`~~ | `$newChoice` bildete nur 1/2 ab, 3 wurde zum weiblichen Platz | **erledigt**: `'3'` -> `'custom'` |
| ~~`install-friday.ps1:1357`~~ | Referenzabfrage nur fuer die zwei alten Plaetze | **erledigt**: `custom` aufgenommen |
| ~~`install-friday.ps1:1334`~~ | Zustandspruefung setzte unbekannte Auswahl auf `friday-female` | **erledigt**: `custom` gilt als gueltig; im ElevenLabs-Modus bleibt das Zuruecksetzen (dort gibt es keine eigene Voice ID) |
| ~~`install-friday.ps1:1346`~~ | Standardauswahl je Zustand | **erledigt**: `custom` -> `'3'` |
| `install-friday.ps1:250` | `Find-VoiceReference` kennt keine Paketreferenz fuer `custom` | bewusst so lassen, aber im Kommentar begruenden |
| ~~`install-friday.ps1:1955-1958`~~ | Streaming-Paare wurden nur bei beiden alten Plaetzen geprueft | **erledigt**: eigener Platz wird mitgegeben, wenn `prepare` ihn als vorhanden meldet |
| ~~`update-voice-personas.ps1:15`, `:132`~~ | `$pairs` und Sicherungsliste | **erledigt**: `custom` in `$pairs` und in der Sicherungsliste |
| ~~`voice_setup.py:20`~~ | `--voice-choice` erlaubte nur zwei Werte | **erledigt** |
| ~~`voice_setup.py:108`, `:130`~~ | Piper-Basiswahl | **erledigt**: eigener Platz nutzt die weibliche Basisstimme, Referenz kommt aus der Aufnahme (`custom-reference.*`) |
| ~~`friday_voice.py:2264`~~ | Endpunkt akzeptierte nur zwei Stimmen | **erledigt**: prueft jetzt gegen `voice_persona.CHOICES` statt gegen eine eigene Liste |
| ~~Dashboard-Stimmenliste (TS)~~ | zwei Eintraege | **erledigt**: `VoicePersona`/`VOICE_PERSONAS` und die Ermittlung der installierten Stimme kennen `custom`; der Vertrag fuehrt `ttsVoice` als freien String, daher keine Contract-Aenderung |

Danach: messbare Audioausgabe fuer alle drei Plaetze (Dauer > 0,3 s, Amplitude ueber Stille), Wechsel hin und
zurueck laesst die beiliegende Referenz byte-gleich.

Bewusst **keine** Zwischenstufe, in der Option 3 auf `custom` zeigt, bevor diese vier Stellen mitziehen: sonst
waere die Auswahl erreichbar, die Stimme aber nicht installiert.

## 5. Reihenfolge der Umsetzung

Python-Seite zuerst (Persona + Referenzpaare) mit eigenen Tests, danach Installer-Verdrahtung, dann
Dashboard-Liste, zuletzt die messbare Audioausgabe für alle drei Plätze. Kein Zwischenstand, in dem Option 3
wählbar ist, aber nicht funktioniert.
## 6. Abschluss (2026-10-22)

Option 3 der Installerauswahl belegt jetzt den eigenen Platz `custom`. Die Kette ist vollstaendig verdrahtet:

- Auswahl: `install-friday.ps1` bildet `3` auf `custom` ab, merkt sich die Referenz unter
  `voice_reference_custom` (und weiterhin `voice_reference_own`) und laesst die beiliegenden Referenzen
  unberuehrt.
- Installation: `voice_setup.py` akzeptiert `custom`, nutzt die weibliche Piper-Basis als Ausfallstimme und
  kopiert die Aufnahme nach `config/voice-references/custom-reference.<ext>`; `prepare_voice_pairs.py` erzeugt
  daraus das Streaming-Paar und den Referenztext.
- Dienst: `fast_tts/server.py` liefert den Platz, sobald das Paar vorhanden ist; `voice_persona` loest ihn auf;
  `/control/voice` prueft gegen `CHOICES`.
- Steuerung: `VoicePersona`/`VOICE_PERSONAS` enthalten `custom`, und die Ermittlung der installierten Stimme
  prueft gegen diese Liste statt gegen eine zweite Kopie.
- Update: `update-voice-personas.ps1` sichert die Paare des eigenen Platzes.

**Nachweis (aktuell, diese Sitzung):**

| Pruefung | Ergebnis |
|---|---|
| `installer/tests/voice-slots.Tests.ps1` | PASS - Verdrahtung aller elf Stellen; Gegenprobe: mit zurueckgedrehter Abbildung schlaegt die Zusicherung an |
| Installer-Suite | 21/21 Exit 0 |
| `test_voice_persona.py` | 8/8 OK |
| `voice-persona.test.ts` | 4/4 (enthaelt `VOICE_PERSONAS`-Reihenfolge und `custom`-Aufruf) |
| `vitest run apps/control-api` | 125 Dateien / 1060 Tests bestanden |
| `tsc -p apps/control-api` | Exit 0 |
| `eslint` auf den drei geaenderten Dateien | Exit 0 |

**Rest fuer PASS:** messbare Audioausgabe fuer alle drei Plaetze (Dauer > 0,3 s, Amplitude ueber Stille,
Referenz nach Rueckwechsel byte-gleich) und ein echter Installationslauf, der Option 3 waehlt. Beides braucht
GPU und den laufenden Sprachdienst und gehoert damit zu INS-13/REL-03; bis dahin bleibt INS-04 `TEIL`.