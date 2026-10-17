# Mapping: Friday Voice (`voice/friday_voice.py`) -> kanonisches Voice-Modell

Quelle der Analyse: `installer/voice/friday_voice.py` im Repo (Windows-Dienst; installiert nach `C:\Friday\voice\friday_voice.py`,
nur lesend untersucht). Zielpaket: `adapters/voice-placeholder`
(Provider `friday-voice-http`, Kategorie `voice`). Das Dashboard spricht nie mit dem Dienst; der Adapter übersetzt.

## 0. Verifikation gegen den Code (Stand 2026-10-14, statische Prüfung)

Alle Angaben unten sind gegen `installer/voice/friday_voice.py` (`JV`), `installer/voice/voice_setup.py` (`VS`) und
`installer/scripts/start-friday-voice.ps1` (`SV`) geprüft. Der Dienst wurde **nicht ausgeführt** (Windows-only: `winsound`, `JV:24`).

> **Hinweis zu den Zeilenangaben:** `JV:`/`VS:`-Zeilen in 0.1–0.3 beziehen sich auf den Stand **vor** der Änderung
> „personalisierter Assistentenname + Wake Word“ (2026-10-14). Die Struktur ist unverändert, die Zeilen haben sich
> verschoben. Abschnitt **0.4** beschreibt die Änderung samt aktuellen Fundstellen (`JV@neu`). Das HTTP-Statusformat
> ist **abwärtskompatibel erweitert**: alle bisherigen Schlüssel bleiben mit gleicher Bedeutung, vier Felder kommen hinzu.

### 0.1 HTTP-Schnittstelle (vollständig, so implementiert)

| Aspekt          | Befund (Beleg)                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Adresse         | `127.0.0.1:<health_port>`, nur Loopback (`JV:591`); `health_port` = **43694** (`VS:107`)                                                                                                               |
| Endpunkte       | **Genau ein Handler:** `do_GET` (`JV:580`). Der Pfad wird nicht ausgewertet: `GET /`, `/status`, `/x?y` liefern dieselbe Antwort                                                                       |
| Andere Methoden | Kein `do_POST/HEAD/OPTIONS` -> Standardantwort `501 Unsupported method` der Python-Standardbibliothek. `Invoke-WebRequest -Method Head` schlägt damit fehl                                             |
| Auth / CORS     | **Keine** Authentifizierung, **keine** CORS-Header, kein Host-Check. Nur ein serverseitiger Adapter (Node) kann die Antwort lesen                                                                      |
| Status / Header | Immer `200`, `Content-Type: application/json`, kein `Content-Length`; HTTP/1.0 (Verbindung wird nach der Antwort geschlossen) (`JV:582-585`)                                                           |
| Antwort         | `{**status, "speaking": bool, "trusted": bool}` (`JV:581`), `json.dumps` ohne Einrückung; seit 0.4 zusätzlich `assistant_name`, `wake_phrase`, `wake_engine`, `wake_rejected` (in `status`)             |
| Verfügbarkeit   | Der Server startet erst in `run()` (`JV:468`), **nach** dem Laden aller Modelle (`JV:285-297`). Während des Ladens (bis ca. 3 min) ist der Port **geschlossen** (Connection refused), nicht `starting` |
| Wartezeit       | Der Installer wartet bis zu 90 x (2 s Timeout + 2 s Pause) auf `state == "listening"` (`install-friday.ps1:423-428`)                                                                                   |

Beispielantwort (Schlüsselreihenfolge wie im Code; `game_mode` fehlt, solange der Gaming-Modus nie aktiv war):

```json
{
  "state": "listening",
  "started": "2026-10-14T09:12:03",
  "last_event": null,
  "wake_count": 0,
  "rejected_speaker": 0,
  "commands": 0,
  "assistant_name": "Friday",
  "wake_phrase": "Hey Friday",
  "wake_engine": "personal",
  "wake_rejected": 0,
  "speaking": false,
  "trusted": false
}
```

Die vier Felder `assistant_name`, `wake_phrase`, `wake_engine`, `wake_rejected` sind **additiv** (ältere Dienstversionen liefern sie
nicht: der Adapter muss sie als optional behandeln und unbekannte Schlüssel ignorieren).

| Feld               | Typ            | Semantik (Beleg)                                                                                                                                                        |
| ------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`            | string         | `starting` (`JV:276`), `listening` (`JV:472`, `539`), `command` (`JV:511`, `528`), `speaking` (`JV:518`), `followup` (`JV:533`). Setzen ohne Sperre aus dem Hauptthread |
| `started`          | string         | lokale Zeit, ISO-8601 auf Sekunden, **ohne Zeitzone** (`JV:276`)                                                                                                        |
| `last_event`       | string \| null | nur Zeitpunkt des **letzten Wake-Ereignisses** (`JV:490`), nicht des letzten Befehls                                                                                    |
| `wake_count`       | int            | Wake-Ereignisse seit Dienststart (`JV:489`)                                                                                                                             |
| `rejected_speaker` | int            | abgelehnte Sprecher (`JV:418`)                                                                                                                                          |
| `commands`         | int            | akzeptierte Befehle ohne Stoppwort (`JV:434`)                                                                                                                           |
| `speaking`         | bool           | TTS-Flag (`tts.speaking`, `JV:581`); wird schon beim Einreihen gesetzt (`JV:214`), 0,35 s nach Wiedergabeende gelöscht (`JV:245-247`)                                   |
| `trusted`          | bool           | `monotonic() < trusted_until` (`JV:582`); Fenster `trusted_session_s` = 90 (`VS:98`)                                                                                    |
| `assistant_name`   | string         | **neu (0.4)**: Name des Assistenten aus `voice.json` (Standard `Friday`; Anzeigename, nie Quelle für Ordnernamen)                                                          |
| `wake_phrase`      | string         | **neu (0.4)**: Wake-Phrase, z. B. `Hey Friday` (= `"Hey " + assistant_name`, aus `voice.json: wake_phrase`)                                                                |
| `wake_engine`      | string         | **neu (0.4)**: `openwakeword` (vortrainiertes `hey_jarvis` + Owner-Verifier, nur Name Jarvis) oder `personal` (persönliches Wake Word, zweistufig)                          |
| `wake_rejected`    | int            | **neu (0.4)**: von Stufe 2 (Whisper-Namenscheck) abgewiesene Stufe-1-Auslösungen seit Dienststart; bei `openwakeword` immer 0                                              |
| `game_mode`        | string \| null | optional: Schlüssel existiert erst, wenn der Gaming-Modus einmal griff (`JV:556`, `571`). **Im Installer-Standard nie** (siehe 0.3)                                     |

### 0.2 Frühere Annahmen dieses Dokuments

| Annahme (Abschnitt)                                                | Urteil           | Beleg / Korrektur                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Health-Server liefert JSON auf `GET /`, Felder `state`..`commands` | richtig          | `JV:276-277`, `579-589`                                                                                                                                                                                                                                      |
| `speaking`, `trusted` zusätzlich im Health-JSON                    | richtig          | `JV:581`                                                                                                                                                                                                                                                     |
| `game_mode` optional                                               | richtig          | `JV:555-571`; aber im Installer-Standard nie gesetzt (0.3)                                                                                                                                                                                                   |
| `logs/voice.jsonl`, Felder `ts` + `event`, keine Rohaudios         | richtig          | `JV:42`, `88-91`. Pfad real `C:\Friday\logs\voice.jsonl`; `ts` = lokale Zeit mit ms, ohne Zeitzone                                                                                                                                                           |
| Steuerung (Stopp/Test) existiert nicht, Stoppwörter im Dienst      | richtig          | nur `do_GET` (`JV:580`); `STOP_WORDS` (`JV:85`), Aktion `tts.interrupt()` (`JV:431`)                                                                                                                                                                         |
| Status `starting` ist per Health sichtbar                          | **falsch**       | Port ist beim Laden zu (`JV:468` nach `JV:285-297`). Connection refused == `starting` oder aus. `starting` im JSON nur für Millisekunden zwischen `_start_health()` und InputStream-Start                                                                    |
| `command` = Wake erkannt, Aufnahme läuft -> `mode = listening`     | **ungenau**      | `state` bleibt `command` auch während Sprecherprüfung, STT, Routing und Wartezeit auf Hermes (`_handle_command` ist synchron, `JV:409-459`; Hermes-Timeout 900 s `JV:400`). Erst danach `speaking` (`JV:518`). Unterphasen nur über Log-Ereignisse ableitbar |
| Transkripttext steht nur auf der Konsole                           | richtig, aber    | Konsole wird in `C:\Friday\logs\voice-service.log` umgeleitet (`SV:23`): Zeilen `> <Transkript>` (`JV:429`) und `< <Antwort>` (`JV:446`, `457`) im Klartext, **ohne Zeitstempel**. Personenbezogene Daten, nie in Dashboard-Logs spiegeln                    |
| `tts.engine = qwen3-tts` solange `tts_url` aktiv                   | gilt hier nie    | Installer schreibt `tts_url: null` (`VS:104`) -> immer `piper`. Qwen3-TTS-Server (`kira-tts`) gehört nicht zum Installer                                                                                                                                     |
| `game_mode_on/off` -> Service `kira-tts` `paused/online`           | gilt hier nie    | Watcher beendet sich sofort ohne `game_processes` oder `tts_url` (`JV:546-547`); Standard `[]` / `null` (`VS:104`, `108`). Service `kira-tts` existiert im Installer nicht                                                                                   |
| `command`-Event-Felder                                             | richtig, ergänzt | zusätzlich `channel: "voice"` (`JV:439`); `intent` ist der Router-Code `L`/`K1`/`K2`/`K3` oder `clock` / `fallback` (`JV:368`, `386`, `390`); `needs_confirmation` wird **nicht** geloggt                                                                    |
| `hermes_error`: `task_id`, `error`, `success`                      | richtig          | `JV:406` (kein `route`)                                                                                                                                                                                                                                      |
| `hermes_done`: `task_id`, `route`, `duration_s`, `success`         | richtig          | `JV:402-403`                                                                                                                                                                                                                                                 |
| `microphone.deviceId` aus `voice.json: input_device`               | richtig          | Standard `null` = Systemstandardgerät (`VS:110`)                                                                                                                                                                                                             |
| `speakerVerification.enabled = true` (fail closed)                 | richtig          | `JV:254-255`; Schwelle 0,4 (`VS:92`)                                                                                                                                                                                                                         |
| `hermes_model` Standard                                            | Hinweis          | Im Code-Default `kira` (`JV:394`), vom Installer auf **`friday`** gesetzt (`VS:102`; passt zu `API_SERVER_MODEL_NAME=friday`, `setup_hermes.sh:98`)                                                                                                          |

### 0.3 Wirksame Standardkonfiguration des Installers (`C:\Friday\config\voice.json`, geschrieben von `VS:113`)

`health_port 43694` · `qwen_url http://127.0.0.1:43692/v1/chat/completions` · `hermes_url http://127.0.0.1:43693/v1/chat/completions` ·
`hermes_model friday` · `hermes_key_file C:\Friday\config\hermes_api.key` · `tts_url null` · `tts_film_filter true` ·
`speaker_threshold 0.4` · `wake_threshold 0.5` · `trusted_session_s 90` · `followup_window_s 8.0` · `game_processes []` ·
`whisper_model small|base` (GPU-Test, `VS:50-57`) · `input_device`/`output_device null`. Die Persona-Felder (`assistant_name`, `wake_phrase`,
`wake_engine`, `persona`, ...) kommen aus `installer/common/persona.py:voice_settings`; Standard seit 0.4: `assistant_name = "Friday"`,
`wake_phrase = "Hey Friday"`, `wake_engine = "personal"` (Name `Jarvis`: `"Jarvis"` / `"Hey Jarvis"` / `"openwakeword"`). Weitere Schlüssel für das
persönliche Wake Word siehe 0.4.

### 0.4 Personalisierter Name und Wake Word (Stand 2026-10-14)

Der Assistent heißt standardmäßig **Friday** (F.R.I.D.A.Y., Nachfolger von J.A.R.V.I.S.), Wake-Phrase „Hey Friday“. Der Installer fragt den Namen
**vor** allen Aufnahmen (`install-state.json`: `assistant_name`, `wake_phrase`, `wake_slug`, `wake_engine`; bestehende Schlüssel/Dateinamen/Aufgabennamen
bleiben stabil) und schreibt ihn nach `config/persona.json` (`assistant_name`) und von dort via `voice_setup.py` nach `config/voice.json`.

| Aspekt | Verhalten (`JV@neu` = `friday_voice.py` nach der Änderung) |
| --- | --- |
| Engine-Wahl | `voice.json: wake_engine`. `openwakeword` = bisheriger Weg unverändert (Schwelle `wake_threshold`, Verifier). `personal` = neuer Weg (`JV@neu:_load_wake`, `_load_personal_wake`). `--test-wake-model` erzwingt `openwakeword` |
| Grund | openWakeWord liefert nur für `hey_jarvis` ein vortrainiertes Modell; der Custom-Verifier bewertet nur ein vorhandenes Basismodell neu und erkennt keine neue Phrase |
| Stufe 1 (`personal`) | `personal_wake.py`: Fenstermodell (pro Gruppe „Hey Name“/„Name“ ein linearer Klassifikator über 96-dim openWakeWord-Embeddings, 3 Zeitstreckungen) aus den eigenen Aufnahmen; Dateien `models/openwakeword/personal_wake.npz` + `personal_wake.json` (kalibrierte Schwelle als Logit, Qualität `gut/mittel/schwach`). Läuft pro 80-ms-Chunk (Kosten wie `Model.predict`) |
| Stufe 2 (`personal`) | nur wenn Stufe 1 ≥ Schwelle: `faster-whisper` auf dem 2-s-Ring (`_confirm_name`), Sprachen `wake_confirm_languages` (Standard `de`, bei Fehlschlag `en`), unscharfer Namensabgleich `personal_wake.name_matches` (Umlaute/Groß-Klein, Lautnormalform, Editierdistanz nach Namenslänge, `wake_aliases`, Sperrliste `wake_reject_words`) |
| Stufe 3 | unverändert: ECAPA-Sprecherprüfung in `_handle_command` (fail closed) |
| Schutzlogik | 1,5-s-Doppelauslösungsschutz und Barge-In bleiben; Barge-In (TTS unterbrechen) erst **nach** bestandener Stufe 2. Abgewiesene Auslösung: `wake_refractory_s` (1,0 s) Sperre + Puffer-Reset. Befehlsanfang, der während Stufe 2 aufläuft, wird vor dem Piepton gesichert und der Befehlsaufnahme vorangestellt (`preroll`) |
| Neue `voice.json`-Schlüssel | `wake_engine`, `personal_wake_model`, `personal_wake_meta`, `personal_wake_threshold` (`null` = aus Meta), `wake_confirm` (`true`), `wake_confirm_languages`, `wake_aliases`, `wake_reject_words`, `wake_match_max_dist` (`null` = nach Namenslänge), `wake_refractory_s` |
| Log (`voice.jsonl`) | `wake` zusätzlich `engine`, `stage2_ms` (`null` bei `openwakeword`); neues Ereignis `wake_rejected` (`engine`, `stage` = 2, `score`, `stage2_ms`) – kein Transkript im Log. `score` ist bei `personal` ein Logit (nicht 0–1) |
| Fail closed | `personal` ohne `personal_wake.npz`/`.json` oder mit Modell eines anderen Namens: Dienst startet nicht (`SystemExit`) |

Adapter-Folgerungen: `VoiceStatus.wakeWord.phrase` aus `status.wake_phrase` (Fallback `voice.json: wake_phrase`); `wake_engine` kann in einer
Diagnoseansicht als Engine-Label dienen; `wake_rejected` ist ein reiner Zähler (Qualitätsindikator, kein Ereignis). Alle vier Felder optional behandeln.

**Messwerte:** siehe `installer/voice/tests/eval_synthetic_wake.py` (synthetische Piper-Sprecher; Zahlen im Übergabebericht, nicht echte Sprecher).

### 0.5 Audio-Pegel (Stand 2026-10-15, additiv)

Der Statusserver liefert zwei zusätzliche Schlüssel (`installer/voice/audio_level.py`, eingehängt in `friday_voice.py`: `VoiceService.input_level`,
`Speaker.level`, `_start_health`). Bestehende Schlüssel bleiben unverändert; ältere Dienste senden die Felder nicht (Adapter behandelt sie als optional).

| Schlüssel | Bedeutung |
| --- | --- |
| `input_level` | Geglätteter, normalisierter RMS-Pegel 0..1 der letzten Mikrofonblöcke (80 ms-Blöcke aus `_on_audio`) |
| `output_level` | dito für die TTS-Ausgabe (Piper und Qwen3-TTS-Stream, auch Cache-Wiedergabe); 0 außerhalb des Sprechens |

- Skala: RMS -> dBFS, linear von -60 dBFS (0.0) bis -6 dBFS (1.0); schneller Anstieg (Attack 0.6), langsamer Abfall (Release 0.15). Normale Sprache am Mikrofon liegt bei 0.4..0.8.
- Veraltet der letzte Block um mehr als 0.5 s (Stream steht, TTS zu Ende), meldet der Dienst 0.0.
- **Datenschutz:** gehalten wird ausschließlich eine Zahl je Richtung. Kein Audiopuffer, keine Datei, kein Log-Eintrag (`LevelMeter` hält keine Samples, `test_meter_keeps_no_audio`).
- Kosten: eine RMS-Berechnung je 80-ms-Block im Audio-Callback bzw. je Wiedergabeblock.

Adapter (`adapters/voice-http`): `input_level` -> `VoiceStatus.microphone.inputLevel` (Werte außerhalb 0..1 werden geklemmt; fehlendes Feld = `0` = „keine Daten“).
Zusätzlich fragt der Adapter den Statusserver selbst ab und sendet `friday.voice.audio_level` (`{ direction, level, peak?, low?, mid?, high?, at }`, Subject `voice/audio`):

| Dienstzustand | Richtung | Quelle | Abfrage |
| --- | --- | --- | --- |
| `phase == listening` (bzw. `command`/`followup` ohne `phase`: Aufnahme des Befehls) | `input` | `input_level` | alle `levelPollIntervalMs` (Standard 250 ms = 4 Hz) |
| `speaking` oder `speaking == true` (TTS) | `output` | `output_level` | alle `levelPollIntervalMs` |
| sonst (`listening` auf Wake Word, `starting`) | – | – | alle `idlePollIntervalMs` (Standard 500 ms), nur zur Erkennung des Wechsels (dann `state_changed`), Pegel werden nicht gesendet |

Beim Verlassen eines aktiven Zustands wird je Richtung genau ein Pegel `0` gesendet. `levelPollIntervalMs: 0` schaltet die Ereignisse ab. Ob ein WebSocket-Client
verbunden ist, kennt der Adapter nicht; die Last ist durch das Zustands-Gate begrenzt (im Leerlauf ein lokaler GET je Sekunde). Das Web nutzt die Ereignisse über
`audioStore` (kein React-State je Frame); die Orb-Reaktion auf die echte Stimme ist damit ohne Mock möglich. Nicht geprüft: echtes Mikrofon und Lautsprecher (Windows).

### 0.6 Orb-Phasen, Bänder und TTS-Flag (Stand 2026-10-17, additiv)

Zusätzliche Schlüssel im Statusserver (alle optional für Adapter/Clients, bestehende Schlüssel und Werte unverändert; `VoiceService.status_payload()`):

| Schlüssel | Typ | Bedeutung |
| --- | --- | --- |
| `phase` | `idle` \| `listening` \| `transcribing` \| `thinking` \| `speaking` | Pipeline-Phase (Tabelle in §2); aus `state`, `processing` und `tts.speaking` berechnet (`VoiceService.voice_phase()`) |
| `tts_active` | bool | TTS spielt (gleiche Wahrheit wie `speaking`) |
| `input_audio` | `{level, peak, low, mid, high}` | Mikrofon: geglätteter RMS, Spitze (langsamer Abfall), Frequenzbänder < 250 Hz / 250–2000 Hz / > 2000 Hz, jeweils 0..1 |
| `output_audio` | `{level, peak, low, mid, high}` | dito für die TTS-Ausgabe (Abtastrate des jeweiligen Streams) |

`input_level`/`output_level` bleiben bestehen (= `input_audio.level`/`output_audio.level`). Die Bänder entstehen aus einer FFT des zuletzt gelieferten Blocks
(`audio_level.band_levels`); das Spektrum wird sofort verworfen. **Datenschutz:** nur Zahlen, nie Audio und nie Transkripttext; `phase` enthält keinen Inhalt.

### Event-Vertrag (Echtpfad, Stand 2026-10-17)

| Event | Quelle | Auslöser | Payload |
| --- | --- | --- | --- |
| `friday.voice.state_changed` | Adapter `voice-http` (Subject `voice/status`) | `mode` hat sich seit der letzten Abfrage geändert | vollständiges `VoiceStatus` (`mode` = listening, transcribing, thinking, speaking, idle) |
| `friday.voice.tts_started` | Adapter (Windows/Gerät) bzw. Control-API-Browser-Gateway (Linux) | Flanke `phase -> speaking` bzw. `audio_start` des Dienstes | `{ utteranceId, engine }` (kein `text`) |
| `friday.voice.tts_ended` | dito | Flanke `speaking -> *`, `audio_end`, `clear`, Dienst weg/Sitzungsende | `{ utteranceId, durationMs, interrupted }`; `interrupted` bei Barge-In (`state == command`), Pause/Stop, `clear`, Verbindungsverlust |
| `friday.voice.audio_level` | Adapter (Gerät) bzw. Browser-Gateway (Linux) | `listening` -> `input`, `speaking` -> `output` | `{ direction, level, peak?, low?, mid?, high?, at }`; je Richtung am Ende ein Pegel `0` |
| `friday.voice.transcript_partial/final` | **nicht** auf dem Echtpfad | Statusserver und Gateway kennen den Text nicht (Datenschutz-Standard); nur der Mock sendet sie | – |

Das Control API leitet `friday.orb.status_changed` daraus ab (`OrbService`): ein `state_changed` wird sofort (ohne 150-ms-Debounce) ausgewertet und für 4 s
ohne erneute Statusabfrage verwendet; Agenten/Aufgaben/Freigaben/Benachrichtigungen werden dabei höchstens 5 s alt wiederverwendet. Der `audioLevel` des Orb-Status
ist der frische Pegel der aktiven Richtung (Mikrofon bei `listening`, TTS bei `speaking`; älter als 0,8 s = nicht gesetzt). Pegel verändern nie den Modus und
starten keine Neuableitung.

### 0.7 Linux: Browser-Audio-Gateway

Mit `audio_transport: "browser"` (Linux, ElevenLabs) fließt das Audio durch `apps/control-api/src/realtime/browser-voice.ts`. Das Gateway sieht jeden PCM-Rahmen
beider Richtungen und veröffentlicht daher selbst `audio_level` (mit Bändern, ca. 6–7 Hz, Mikrofon nur während `listening`) sowie `tts_started`/`tts_ended`
(Grenzen = die Textnachrichten `audio_start`/`audio_end`/`clear` des Dienstes, Ersatz: 700 ms ohne TTS-Rahmen). Die Phasen
(`listening`/`transcribing`/`thinking`) kennt nur der Dienst: sie kommen aus `phase` über den Adapter, der in diesem Modus keine Pegel/TTS-Events sendet
(sonst doppelt). Das Gateway leitet nichts aus Text ab und veröffentlicht nur Zahlen (`BrowserVoiceTelemetry`).

## 1. Schnittstellen des Dienstes heute

| Schnittstelle                                                                       | Inhalt                                                                                                                                                      | Nutzung im Adapter                                                                                                           |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Health-Server `127.0.0.1:<health_port>` (`config/voice.json`), `GET /` liefert JSON | `status` (`state`, `started`, `last_event`, `wake_count`, `rejected_speaker`, `commands`, optional `game_mode`) plus `speaking` (bool) und `trusted` (bool) | Statuspolling -> `VoiceStatus`, `friday.voice.state_changed`, `OrbLayers.voice`                                              |
| `logs/voice.jsonl` (append-only, eine JSON-Zeile je Ereignis, Feld `ts` + `event`)  | Metadaten, **keine Rohaudios**                                                                                                                              | Eventquelle, solange keine Bridge existiert (Datei-Tail ab gemerktem Offset)                                                 |
| Steuerung (Stopp/Test)                                                              | existiert nicht; Stoppwörter werden im Dienst erkannt (`STOP_WORDS`)                                                                                        | benötigt kleine lokale HTTP-Bridge (`POST /stop`, `POST /test`); ohne sie bleiben `voice.stop`/`voice.test` nicht deklariert |

Der Adapter deklariert deshalb zunächst nur `voice.read`; `voice.test`/`voice.stop` kommen erst mit der Bridge.

## 2. Zustandsmodell des Dienstes -> `VoiceStatus.mode` -> `OrbLayers.voice`

`status["state"]` kennt: `starting`, `listening`, `command`, `speaking`, `followup`. Dazu `speaking` (TTS-Wiedergabe läuft) aus dem Health-JSON.

| Dienstzustand                           | Bedingung                                                                                                     | `VoiceStatus.mode`                      | `OrbLayers.voice`    | Anmerkung                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `starting`                              | Modelle werden geladen; **Port ist dabei geschlossen** (Connection refused, siehe 0.1)                        | `idle` (+ Service `voice` = `degraded`) | `idle`               | Orb-Hauptzustand `booting` kommt aus dem Systemstatus, nicht aus Voice |
| `listening`                             | wartet auf Wake Word                                                                                          | `idle`                                  | `idle`               | Mikrofon aktiv: `microphone.state = "idle"`, `active = true`           |
| `command`                               | Wake erkannt; `state` bleibt `command` bis zum Ende von Aufnahme, STT, Routing **und** Hermes-Wartezeit (0.2) | `listening`                             | `listening`          | `microphone.state = "listening"`                                       |
| `command` + Aufnahme beendet, STT läuft | zwischen `_record_command` und Routing (`stt_ms` im Log)                                                      | `transcribing`                          | `transcribing`       | nur aus dem Log ableitbar: `wake` ... `command`-Event                  |
| Routing/Hermes                          | `command`-Event geloggt, `speaking = false`, Antwort noch offen                                               | `thinking`                              | `idle` (Voice-Ebene) | `OrbLayers.work = thinking` bzw. `working` bei `background = true`     |
| `speaking` oder `speaking = true`       | TTS-Worker spielt                                                                                             | `speaking`                              | `speaking`           | `tts.state = "busy"`                                                   |
| `followup`                              | Folgefrage-Fenster ohne Wake Word (`followup_window_s`)                                                       | `listening`                             | `listening`          | `trustedSession.active = true`                                         |
| Fehler                                  | `tts_error`, `hermes_error`, `router_fallback`, `game_mode_error`                                             | `error` (nur bei dauerhaftem Ausfall)   | unverändert          | einzelne Fehler -> `OrbLayers.attention = warning`, nicht Voice        |

Regel: `OrbLayers.voice` darf nur aus diesen semantischen Zuständen entstehen, nie aus Textinhalten (PLAN §1.1 Nr. 12).

**Stand 2026-10-17 (Orb-Rework WP-C): `transcribing`/`thinking` sind jetzt echt.** Der Dienst meldet den zusätzlichen Schlüssel `phase` (siehe 0.6);
`state` behält seine Bedeutung. Mit `phase` ersetzt der Adapter die obige „nur aus dem Log ableitbar“-Heuristik:

| `phase` (Dienst) | gesetzt, solange … | `VoiceStatus.mode` | Besonderheiten |
| --- | --- | --- | --- |
| `listening` | `state` ∈ {`command`, `followup`} und keine Verarbeitung läuft (Befehl wird aufgenommen) | `listening` | `microphone.state = "listening"`; Eingangspegel fließt |
| `transcribing` | `_handle_command`: Sprecherprüfung + STT (`processing = "transcribing"`) | `transcribing` | `stt.state = "busy"`, `microphone.state = "idle"`, **kein** Eingangspegel |
| `thinking` | nach dem Transkript: lokale Intent-Handler, Router, Wartezeit auf Hermes/Modell (`processing = "thinking"`) | `thinking` | `OrbLayers.work = thinking` |
| `speaking` | `tts.speaking` gesetzt oder `state == speaking` (hat Vorrang, z. B. Quittung „Moment.“ während der Wartezeit) | `speaking` | `tts.state = "busy"`; Ausgangspegel fließt |
| `idle` | sonst (`starting`, `waiting_audio`, `listening`, `paused`) | `idle` | |

Ältere Dienste ohne `phase` liefern weiter nur `listening`/`speaking`/`idle` (Tabelle oben). Neu im Adapter: `state == waiting_audio` (Linux, Browser noch nicht
verbunden) -> `microphone.state = "off"`, Wake Word `disabled`, Modus `idle`. Kurze Phasen können zwischen zwei Abfragen (250 ms aktiv / 500 ms Leerlauf)
übersprungen werden (z. B. ein sehr schnelles lokales `thinking`); der Orb erfindet sie nicht.

## 3. Log-Ereignisse (`voice.jsonl`) -> `friday.voice.*`

| `event` im Log                     | Felder                                                                                                     | Kanonisches Ereignis                                             | Payload / Hinweis                                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wake`                             | `score`, `barge_in`, ab 0.4 zusätzlich `engine`, `stage2_ms`                                               | `friday.voice.state_changed`                                     | `mode = listening`; bei `barge_in = true` zusätzlich `friday.voice.tts_ended` des laufenden Utterance                                                                                         |
| `wake_rejected` (ab 0.4)           | `engine`, `stage` (2), `score`, `stage2_ms`                                                                | (kein Ereignis)                                                  | Stufe 2 hat eine Stufe-1-Auslösung abgewiesen (ähnliches Wort/Geräusch); nur Zähler `wake_rejected`                                                                                           |
| `no_speech_after_wake`             | -                                                                                                          | `friday.voice.state_changed`                                     | zurück auf `idle`                                                                                                                                                                             |
| `too_short`                        | `followup`                                                                                                 | (kein Ereignis)                                                  | nur Metrik-Zähler                                                                                                                                                                             |
| `speaker_rejected`                 | `score`, `followup`                                                                                        | `friday.voice.state_changed`                                     | `speakerVerification.state = "rejected"`, `trustedSession.active = false`; **kein** Transkript-Ereignis                                                                                       |
| `empty_transcript`                 | `speaker_score`                                                                                            | `friday.voice.state_changed`                                     | zurück auf `idle`                                                                                                                                                                             |
| `stop`                             | `text`                                                                                                     | `friday.voice.tts_ended` + `friday.voice.state_changed` (`idle`) | Stoppwort; `text` wird nicht als Transkript veröffentlicht                                                                                                                                    |
| `command`                          | `task_id`, `intent`, `route`, `background`, `priority`, `speaker_score`, `stt_ms`, `router_ms`, `total_ms` | `friday.voice.transcript_final` (+ Metriken)                     | Transkripttext steht **nicht** im Log (nur Konsole); der Adapter benötigt dafür die Bridge. `utteranceId = createId("rsp", task_id)`; `speaker` = `"owner"` wenn `speaker_score >= threshold` |
| `hermes_done`                      | `task_id`, `route`, `duration_s`, `success`                                                                | `friday.activity.appended` (kind `tool_call`/`agent`)            | Dauer in `durationMs`                                                                                                                                                                         |
| `hermes_error`                     | `task_id`, `error`, `success`                                                                              | `friday.activity.appended` (severity `error`)                    | Fehlertext wird normalisiert, nie roh weitergereicht                                                                                                                                          |
| `router_fallback`                  | `error`                                                                                                    | `friday.activity.appended` (severity `warning`)                  | Qwen-Router nicht erreichbar -> Route `kimi_low`                                                                                                                                              |
| `tts_server_fallback`              | `error`                                                                                                    | `friday.activity.appended` (severity `warning`)                  | `tts.engine` wechselt von Qwen3-TTS auf Piper                                                                                                                                                 |
| `tts_error`, `tts_prefetch_failed` | `error`                                                                                                    | `friday.activity.appended` (severity `error` / `warning`)        |                                                                                                                                                                                               |
| `game_mode_on` / `game_mode_off`   | `game`                                                                                                     | `friday.system.service_status_changed`                           | Service `kira-tts` -> `paused` / `online`; Voice-Status `tts.engine = "piper"`                                                                                                                |
| `game_mode_error`                  | `error`                                                                                                    | `friday.activity.appended` (severity `warning`)                  |                                                                                                                                                                                               |

`friday.voice.tts_started` / `tts_ended` entstehen aus der Phase `speaking` (Flanken, siehe Event-Vertrag in 0.6; Stand 2026-10-17 real, vorher nur Mock);
`engine` = konfigurierte `ttsEngine` des Adapters (Standard `piper`, Cloud `ElevenLabs`). `friday.voice.audio_level` entsteht aus den Statusfeldern
`input_level`/`output_level` (siehe 0.5), nicht aus `voice.jsonl`.

## 4. `VoiceStatus` (Felder -> Quelle)

| Kanonisches Feld                             | Quelle im Dienst                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `mode`                                       | siehe Tabelle 2                                                                                                |
| `microphone.state/active`                    | `state in {listening, command, followup}` -> aktiv; Dienst läuft nicht -> `off`                                |
| `microphone.deviceId`                        | `voice.json: input_device`                                                                                     |
| `microphone.inputLevel`                      | `status.input_level` (ab 0.5; fehlt es: `0` = keine Daten)                                                     |
| `wakeWord.phrase/enabled/state`              | `status.wake_phrase` (ab 0.4; Fallback `voice.json: wake_phrase`); `armed` solange `listening`; `triggered` bis Befehlsende |
| `speakerVerification.*`                      | `speaker_score` aus `command`/`speaker_rejected`; `enabled = true` (Dienst startet fail-closed nur mit Profil) |
| `trustedSession.active/expiresAt`            | Health `trusted`; Ablauf = Zeitpunkt des letzten `command` + `trusted_session_s`                               |
| `stt.engine` / `stt.latencyMs`               | `faster-whisper` (`voice.json: whisper_model`), `stt_ms`                                                       |
| `tts.engine` / `tts.state`                   | `qwen3-tts` (`tts_url`) bzw. `piper`; `busy` bei `speaking`                                                    |
| `localModel.name/state/latencyMs`            | `qwen3-router`, `router_ms`; `router_fallback` -> `error`                                                      |
| `audioInputDeviceId` / `audioOutputDeviceId` | `input_device` / `output_device`                                                                               |
| `pushToTalk.*`                               | nicht vorhanden -> `{enabled: false, active: false}`                                                           |
| `focusMode`                                  | Gaming-Modus (`status.game_mode` gesetzt)                                                                      |
| `rawRecordingEnabled`                        | immer `false` (Dienst speichert keine Rohaudios)                                                               |
| `voiceHistoryEnabled`                        | `true` solange `logs/voice.jsonl` geschrieben wird                                                             |

## 5. Metriken (`VoiceMetrics`) aus `command`-Ereignissen

`sttLatency` <- `stt_ms`, `routerLatency` <- `router_ms`, `firstToken`/`ttsFirstAudio` <- Bridge (nicht geloggt).
`wakeWordLatency`, `speakerVerificationLatency`: nicht im Log -> `{currentMs: null, ...}` bis die Bridge sie liefert.
`current/avg/p95/sampleCount` berechnet der Adapter über ein gleitendes Fenster der letzten 200 Befehle.

## 6. Geräte und Profile

- `listVoiceDevices`: `sounddevice.query_devices()` (Bridge-Endpunkt); `isDefault` aus `input_device` / `output_device`.
- `listVoiceProfiles`: `voice.json: speaker_profile` (ECAPA-Embedding, `.npy`) -> ein Profil `owner = true`,
  `threshold = speaker_threshold`. Embeddings selbst verlassen den Rechner nie.

## 7. Sicherheitsregeln

Rohaudio, Embeddings und `hermes_key_file`-Inhalt werden nie gemappt. Fehlertexte laufen durch `normalizeError`.
Der Adapter ist read-only, bis die Bridge `POST /stop` und `POST /test` bietet; Tier-2/3-Aktionen löst die Voice-Pipeline
weiterhin nur als Entwurf aus (Systemprompt `HERMES_VOICE_SYSTEM`), nie direkt.
