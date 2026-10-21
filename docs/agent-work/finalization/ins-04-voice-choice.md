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

## 2. Aenderungen

1. **GUI bietet drei Stimmen** inklusive `Eigene MP3/WAV (3–30 s)`; bei Auswahl dieser Option verlangt die
   Vorabpruefung einen Pfad, eine WAV-/MP3-Endung und mindestens 1 KB Inhalt.
2. **Backend prueft den Dateiinhalt**: neue Funktion `Test-VoiceReferenceFile` liest den Kopf und blockiert
   fehlende, leere, beschaedigte, zu kurze (< 1 s) und zu lange (> 120 s) Dateien sowie fremde Endungen; WAV wird
   ueber RIFF/WAVE-Kopf, Kanaele, Rate und Bitbreite geprueft, MP3 ueber ID3- oder Frame-Sync. Beide Zweige
   (eigene Stimme und optionale andere Referenz) nutzen dieselbe Pruefung und nennen den Ablehnungsgrund.
3. **Wiederherstellbarkeit** war bereits vorhanden und ist jetzt getestet: je Stimme wird
   `voice_reference_<choice>` gespeichert, eine gespeicherte Referenz hat Vorrang vor der lokalen und diese vor der
   beiliegenden Datei (`Find-VoiceReference`).

## 3. Nachweise

- `installer/tests/voice-reference.Tests.ps1` (erweitert, gruen): gueltige WAV und MP3 werden akzeptiert; zu kurz,
  leer, beschaedigter WAV-Kopf, fremde Endung, MP3 ohne Kopf, verschwundene Datei und leerer Pfad werden abgelehnt;
  Ablehnung nennt einen Grund; GUI bietet die dritte Option und verlangt eine Datei; Backend akzeptiert 1–3 und
  prueft inhaltlich; `Find-VoiceReference`-Vorrangregeln weiterhin gruen.
- `installer/tests/gui-installer.Tests.ps1` und `installer/tests/installer-io-contract.Tests.ps1` gruen (8 Reiter,
  DPAPI, Exitcodes 0/1/10, 28 Antworten / 7 Geheimnisse / 19 gefuehrte Prompts).
- **Audio-Beleg der beiliegenden Referenzen** (aus der laufenden Installation gelesen): `classic-reference.wav`
  9,56 s / 24 kHz / Peak 22656, `friday-female-reference.wav` 9,25 s / 24 kHz / Peak 9340, jeweils zusaetzlich als
  `-streaming.wav` am 2026-10-21 19:13 aus diesen Referenzen neu erzeugt. Beide Dateien enthalten also echtes,
  nicht stummes Audio und sind klar unterscheidbar.

## 4. Offen (INS-04 bleibt offen)

- **Hoerprobe am Ausgabegeraet**: die Synthese laeuft auf Windows (`voice\.venv\Scripts\python.exe`,
  `tts_backend=streaming_qwen`, `tts_url=http://127.0.0.1:43795/tts/stream`). Der Dienst antwortet, sein
  Anfrageformat ist aber nicht dokumentiert; ein geratener Request waere kein Nachweis. Die Wiedergabe ueber
  Lautsprecher ist auf diesem Host ohne Audioausgabe nicht beobachtbar (physischer Lauf = INS-13).
- **Konsistenz bei Wechsel**: `voicechoice`/Referenz invalidieren `voicepython`/`voiceservice`; ob Persona und
  Wake-Modell denselben Wechsel mittragen, ist nicht belegt (Wake wird separat aus `build_personal_wake.py`
  gebaut) und bleibt zu pruefen.
- **ElevenLabs-Zweig**: Voice-ID-Validierung existiert, ein echter Cloudaufruf fehlt (externe Voraussetzung).
