# Mapping: Jarvis Voice (`voice/jarvis_voice.py`) -> kanonisches Voice-Modell

Quelle der Analyse: `..\voice\jarvis_voice.py` (Windows-Dienst, nur lesend untersucht). Zielpaket: `adapters/voice-placeholder`
(Provider `jarvis-voice-http`, Kategorie `voice`). Das Dashboard spricht nie mit dem Dienst; der Adapter übersetzt.

## 1. Schnittstellen des Dienstes heute

| Schnittstelle                                                                       | Inhalt                                                                                                                                                      | Nutzung im Adapter                                                                                                           |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Health-Server `127.0.0.1:<health_port>` (`config/voice.json`), `GET /` liefert JSON | `status` (`state`, `started`, `last_event`, `wake_count`, `rejected_speaker`, `commands`, optional `game_mode`) plus `speaking` (bool) und `trusted` (bool) | Statuspolling -> `VoiceStatus`, `jarvis.voice.state_changed`, `OrbLayers.voice`                                              |
| `logs/voice.jsonl` (append-only, eine JSON-Zeile je Ereignis, Feld `ts` + `event`)  | Metadaten, **keine Rohaudios**                                                                                                                              | Eventquelle, solange keine Bridge existiert (Datei-Tail ab gemerktem Offset)                                                 |
| Steuerung (Stopp/Test)                                                              | existiert nicht; Stoppwörter werden im Dienst erkannt (`STOP_WORDS`)                                                                                        | benötigt kleine lokale HTTP-Bridge (`POST /stop`, `POST /test`); ohne sie bleiben `voice.stop`/`voice.test` nicht deklariert |

Der Adapter deklariert deshalb zunächst nur `voice.read`; `voice.test`/`voice.stop` kommen erst mit der Bridge.

## 2. Zustandsmodell des Dienstes -> `VoiceStatus.mode` -> `OrbLayers.voice`

`status["state"]` kennt: `starting`, `listening`, `command`, `speaking`, `followup`. Dazu `speaking` (TTS-Wiedergabe läuft) aus dem Health-JSON.

| Dienstzustand                           | Bedingung                                                         | `VoiceStatus.mode`                      | `OrbLayers.voice`    | Anmerkung                                                              |
| --------------------------------------- | ----------------------------------------------------------------- | --------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `starting`                              | Modelle werden geladen                                            | `idle` (+ Service `voice` = `degraded`) | `idle`               | Orb-Hauptzustand `booting` kommt aus dem Systemstatus, nicht aus Voice |
| `listening`                             | wartet auf Wake Word                                              | `idle`                                  | `idle`               | Mikrofon aktiv: `microphone.state = "idle"`, `active = true`           |
| `command`                               | Wake erkannt, `_record_command` nimmt auf                         | `listening`                             | `listening`          | `microphone.state = "listening"`                                       |
| `command` + Aufnahme beendet, STT läuft | zwischen `_record_command` und Routing (`stt_ms` im Log)          | `transcribing`                          | `transcribing`       | nur aus dem Log ableitbar: `wake` ... `command`-Event                  |
| Routing/Hermes                          | `command`-Event geloggt, `speaking = false`, Antwort noch offen   | `thinking`                              | `idle` (Voice-Ebene) | `OrbLayers.work = thinking` bzw. `working` bei `background = true`     |
| `speaking` oder `speaking = true`       | TTS-Worker spielt                                                 | `speaking`                              | `speaking`           | `tts.state = "busy"`                                                   |
| `followup`                              | Folgefrage-Fenster ohne Wake Word (`followup_window_s`)           | `listening`                             | `listening`          | `trustedSession.active = true`                                         |
| Fehler                                  | `tts_error`, `hermes_error`, `router_fallback`, `game_mode_error` | `error` (nur bei dauerhaftem Ausfall)   | unverändert          | einzelne Fehler -> `OrbLayers.attention = warning`, nicht Voice        |

Regel: `OrbLayers.voice` darf nur aus diesen semantischen Zuständen entstehen, nie aus Textinhalten (PLAN §1.1 Nr. 12).

## 3. Log-Ereignisse (`voice.jsonl`) -> `jarvis.voice.*`

| `event` im Log                     | Felder                                                                                                     | Kanonisches Ereignis                                             | Payload / Hinweis                                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wake`                             | `score`, `barge_in`                                                                                        | `jarvis.voice.state_changed`                                     | `mode = listening`; bei `barge_in = true` zusätzlich `jarvis.voice.tts_ended` des laufenden Utterance                                                                                         |
| `no_speech_after_wake`             | -                                                                                                          | `jarvis.voice.state_changed`                                     | zurück auf `idle`                                                                                                                                                                             |
| `too_short`                        | `followup`                                                                                                 | (kein Ereignis)                                                  | nur Metrik-Zähler                                                                                                                                                                             |
| `speaker_rejected`                 | `score`, `followup`                                                                                        | `jarvis.voice.state_changed`                                     | `speakerVerification.state = "rejected"`, `trustedSession.active = false`; **kein** Transkript-Ereignis                                                                                       |
| `empty_transcript`                 | `speaker_score`                                                                                            | `jarvis.voice.state_changed`                                     | zurück auf `idle`                                                                                                                                                                             |
| `stop`                             | `text`                                                                                                     | `jarvis.voice.tts_ended` + `jarvis.voice.state_changed` (`idle`) | Stoppwort; `text` wird nicht als Transkript veröffentlicht                                                                                                                                    |
| `command`                          | `task_id`, `intent`, `route`, `background`, `priority`, `speaker_score`, `stt_ms`, `router_ms`, `total_ms` | `jarvis.voice.transcript_final` (+ Metriken)                     | Transkripttext steht **nicht** im Log (nur Konsole); der Adapter benötigt dafür die Bridge. `utteranceId = createId("rsp", task_id)`; `speaker` = `"owner"` wenn `speaker_score >= threshold` |
| `hermes_done`                      | `task_id`, `route`, `duration_s`, `success`                                                                | `jarvis.activity.appended` (kind `tool_call`/`agent`)            | Dauer in `durationMs`                                                                                                                                                                         |
| `hermes_error`                     | `task_id`, `error`, `success`                                                                              | `jarvis.activity.appended` (severity `error`)                    | Fehlertext wird normalisiert, nie roh weitergereicht                                                                                                                                          |
| `router_fallback`                  | `error`                                                                                                    | `jarvis.activity.appended` (severity `warning`)                  | Qwen-Router nicht erreichbar -> Route `kimi_low`                                                                                                                                              |
| `tts_server_fallback`              | `error`                                                                                                    | `jarvis.activity.appended` (severity `warning`)                  | `tts.engine` wechselt von Qwen3-TTS auf Piper                                                                                                                                                 |
| `tts_error`, `tts_prefetch_failed` | `error`                                                                                                    | `jarvis.activity.appended` (severity `error` / `warning`)        |                                                                                                                                                                                               |
| `game_mode_on` / `game_mode_off`   | `game`                                                                                                     | `jarvis.system.service_status_changed`                           | Service `kira-tts` -> `paused` / `online`; Voice-Status `tts.engine = "piper"`                                                                                                                |
| `game_mode_error`                  | `error`                                                                                                    | `jarvis.activity.appended` (severity `warning`)                  |                                                                                                                                                                                               |

`jarvis.voice.tts_started` / `tts_ended` entstehen aus dem Health-Feld `speaking` (Flanken `false -> true` / `true -> false`);
`engine` = `qwen3-tts` solange `tts_url` aktiv ist, sonst `piper`. `jarvis.voice.audio_level` liefert erst die Bridge
(der Dienst misst Pegel intern nicht nach außen).

## 4. `VoiceStatus` (Felder -> Quelle)

| Kanonisches Feld                             | Quelle im Dienst                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `mode`                                       | siehe Tabelle 2                                                                                                |
| `microphone.state/active`                    | `state in {listening, command, followup}` -> aktiv; Dienst läuft nicht -> `off`                                |
| `microphone.deviceId`                        | `voice.json: input_device`                                                                                     |
| `microphone.inputLevel`                      | Bridge (sonst `0`)                                                                                             |
| `wakeWord.phrase/enabled/state`              | `voice.json: wake_phrase`; `armed` solange `listening`; `triggered` bis Befehlsende                            |
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
