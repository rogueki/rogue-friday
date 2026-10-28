# INS-04 — Drei Stimmen in GUI und Backend (Teilnachweis)

Stand: 2026-10-22. Geprueft an `install-friday-gui.ps1`, `install-friday.ps1`, `voice/voice_setup.py`,
`voice/prepare_voice_pairs.py` und der laufenden Installation unter `D:\Dokumente\F.R.I.D.A.Y`.

## 1. Gefundener Fehler (N-011)

Der Assistent kannte **zwei** Stimmen, der Installer **drei**:

- GUI: `Add-Choice 'voiceChoice' … @('F.R.I.D.A.Y. weiblich', 'J.A.R.V.I.S. klassisch (beiliegende WAV)')`
- Backend: `$answer -in @('1','2','3')`, wobei `3` die eigene MP3/WAV aktiviert (`$ownReference = $answer -eq '3'`).

Die dritte Option war damit ueber die Oberflaeche unerreichbar; sie existierte nur im stillen CLI-Pfad. Zusaetzlich
prueften GUI und Backend die Referenzdatei nur auf **Existenz** — eine leere, abgeschnittene oder falsch benannte
Datei lief bis in den Klonbau und scheiterte dort.

## 2. Aenderungen und Ruecknahme der dritten Option

1. **GUI**: die dritte Option („Eigene MP3/WAV") wurde am 2026-10-22 wieder **entfernt** — sie war ueber den
   echten Weg nicht benutzbar (siehe N-014) und haette die beiliegende F.R.I.D.A.Y.-Referenz ueberschrieben.
   Die Oberflaeche bietet wieder die zwei Stimmen, die die Ausgabekette tatsaechlich kennt.
2. **Dateipruefung im Backend**: neue Funktion `Test-VoiceReferenceFile` liest den Kopf und blockiert fehlende,
   leere, beschaedigte und zu kurze/lange Dateien sowie fremde Endungen; WAV ueber RIFF/WAVE-Kopf, Kanaele, Rate
   und Bitbreite, MP3 ueber ID3- oder Frame-Sync. Grenze **3–30 s** — genau der Bereich, den `voice_setup.py`
   verlangt (vorher 1–120 s, siehe N-013).
3. **Trennung der gespeicherten Referenzen**: die eigene Stimme belegt weiterhin den weiblichen Stimmplatz
   (`fast_tts` und die Stimmenliste kennen nur zwei), ueberschreibt aber **nicht** mehr
   `voice_reference_friday-female`. Ein Zurueckwechseln auf F.R.I.D.A.Y. liefert damit wieder die beiliegende
   Stimme statt der eigenen Aufnahme (N-014, Teilfix).

## 3. Nachweise

- `installer/tests/voice-reference.Tests.ps1` (gruen): gueltige WAV (5 s) und MP3 akzeptiert; 0,2 s, 45 s, leer,
  beschaedigter WAV-Kopf, fremde Endung, MP3 ohne Kopf, verschwundene Datei und leerer Pfad abgelehnt; Ablehnung
  nennt einen Grund; `Find-VoiceReference`-Vorrangregeln gruen; GUI prueft Endung und Groesse der Referenz.
- `installer/tests/gui-run-tracker.Tests.ps1` (gruen): Transport nimmt `voiceChoice` 1–3 an, 4 wird abgelehnt.
- `installer/tests/gui-installer.Tests.ps1` und `installer-io-contract.Tests.ps1` gruen.
- **Audio-Beleg der beiliegenden Referenzen** (aus der laufenden Installation gelesen): `classic-reference.wav`
  9,56 s / 24 kHz / Peak 22656, `friday-female-reference.wav` 9,25 s / 24 kHz / Peak 9340 — echtes, nicht stummes
  und klar unterscheidbares Audio.

## 4. Offen (INS-04 bleibt offen)

- **Dritte Stimme vollstaendig**: die eigene MP3/WAV braucht einen eigenen Stimmplatz. Dafuer muessen
  `voice_persona.CHOICES`, `server.py` (Stimmenliste und Auswahlpruefung), `prepare_voice_pairs.py`,
  `update-voice-personas.ps1`, `friday_voice.py` (Stimmenwechsel-API) und die Stimmenauswahl im Dashboard dieselbe
  dritte Kennung kennen; erst danach darf die Oberflaeche die Option wieder anbieten. Solange das fehlt, wuerde
  `voice_persona.resolve` fuer den weiblichen Platz weiterhin `friday-female-streaming.wav` liefern — die eigene
  Aufnahme bliebe ungehoert.
- **Hoerprobe am Ausgabegeraet**: die Synthese laeuft auf Windows (`tts_backend=streaming_qwen`,
  `tts_url=http://127.0.0.1:43795/tts/stream`); das Anfrageformat des Dienstes ist nicht dokumentiert, ein
  geratener Request waere kein Nachweis.
- **ElevenLabs-Zweig**: Voice-ID-Pruefung existiert, ein echter Cloudaufruf fehlt (externe Voraussetzung).
