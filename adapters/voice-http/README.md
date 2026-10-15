# @jarvis/adapter-voice-http

Voice-Adapter (Kategorie `voice`, Provider-ID `jarvis-voice-http`) über den Status-Endpunkt des installierten Voice-Dienstes
(`installer/voice/jarvis_voice.py`, Port **43694**). Er ersetzt `adapters/voice-placeholder` (gleiche Provider-ID und Config-Schema-ID,
in der Allowlist wird nur eines der beiden Pakete eingetragen). Das Dashboard spricht nie mit dem Dienst; der Adapter übersetzt.

Der Dienst hat **genau einen** HTTP-Handler (`do_GET`, der Pfad wird ignoriert, keine Authentifizierung, HTTP/1.0 ohne `Content-Length`).
Alles, was er nicht liefert, bleibt leer oder ist nicht deklariert. Es werden keine Werte erfunden ("keine Datenquelle").

## Konfiguration

JSON Schema: `configSchema` in `src/manifest.ts` (`$id` `urn:jarvis:adapter:jarvis-voice-http:config`, PLAN §42.2). Der Adapter hat **keine Secrets**.

| Feld               | Standard                 | Bedeutung                                                                                              |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `baseUrl`          | `http://127.0.0.1:43694` | Status-Server des Voice-Dienstes (`health_port`, `voice_setup.py`)                                     |
| `localModelUrl`    | `http://127.0.0.1:43692` | llama-server des Qwen-Routers; nur für `localModel.state` (`GET /v1/models`)                           |
| `localModelName`   | `qwen3-router`           | Anzeigename (Alias aus `start-qwen-server.ps1`)                                                        |
| `wakePhrase`       | `Hey Friday`             | Fallback-Anzeige, wenn der Dienst kein Feld `wake_phrase` liefert (ältere Installationen)              |
| `sttEngine`        | `faster-whisper`         | Anzeigename; der Dienst lädt `WhisperModel`, die Modellgröße steht nicht im Status                     |
| `ttsEngine`        | `piper`                  | Anzeigename; Installer-Standard `tts_url = null` = Piper. Im Gaming-Modus erzwingt der Adapter `piper` |
| `timeoutMs`        | `2000`                   | je Versuch (der Installer wartet ebenfalls 2 s)                                                        |
| `maxAttempts`      | `2`                      | nur Lesezugriffe; die Health-Prüfung macht immer genau einen Versuch                                   |
| `retryBaseDelayMs` | `200`                    | Backoff-Basis                                                                                          |
| `levelPollIntervalMs` | `250`                 | Abfrage für `jarvis.voice.audio_level`, solange der Dienst aufnimmt oder spricht (4 Hz). `0` = keine Pegel-Ereignisse |
| `idlePollIntervalMs` | `1000`                 | Abfrage in allen anderen Zuständen (sendet nichts, erkennt nur den Wechsel)                            |

Registry-Eintrag (Beispiel): `adapters.voice: { provider: jarvis-voice-http, enabled: true, config: {} }`, Factory `voiceHttpFactory`.

## Capability-Matrix

| Capability     | Deklariert | Methode              | Datenquelle                                                                            |
| -------------- | :--------: | -------------------- | -------------------------------------------------------------------------------------- |
| `voice.read`   |     ja     | `getVoiceStatus`     | `GET /` des Status-Servers + `GET /v1/models` des Routers (Erreichbarkeit)             |
|                |            | `listVoiceDevices`   | **keine Datenquelle** -> leere Seite, Freshness `unknown`                              |
|                |            | `listVoiceProfiles`  | **keine Datenquelle** -> leere Seite, Freshness `unknown`                              |
|                |            | `getVoiceMetrics`    | **keine Datenquelle** -> alle Statistiken `null`/`sampleCount: 0`, Freshness `unknown` |
| `voice.test`   |    nein    | `runVoiceTest` fehlt | Der Dienst hat keine Steuerschnittstelle (kein `do_POST`)                              |
| `voice.stop`   |    nein    | `stopVoice` fehlt    | wie oben; Stoppwörter erkennt der Dienst intern                                        |
| `voice.enroll` |    nein    | -                    | Enrollment läuft in `voice_setup.py`, nicht über HTTP                                  |

Keine Events: der Status-Server hat keinen Eventstrom, daher kein `pollEvents()`. `voice.jsonl` wird nicht gelesen (Datei-Tail wäre ein eigener Schritt).

## Abbildung Status-JSON -> `VoiceStatus`

Erwartete Antwort (Schlüsselreihenfolge wie im Code): `state, started, last_event, wake_count, rejected_speaker, commands, speaking, trusted`, optional `game_mode`.
Ein fehlender oder falsch typisierter Schlüssel, ein unbekannter `state` oder kaputtes JSON ergibt `VALIDATION_FAILED` (nicht retryable); unbekannte zusätzliche Schlüssel werden verworfen.

| `state`     | `mode`      | Mikrofon               | Wake Word                                 |
| ----------- | ----------- | ---------------------- | ----------------------------------------- |
| `starting`  | `idle`      | `off`, `active: false` | `disabled`                                |
| `listening` | `idle`      | `idle`, `active: true` | `armed`                                   |
| `command`   | `listening` | `listening`            | `triggered`                               |
| `followup`  | `listening` | `listening`            | `triggered`                               |
| `speaking`  | `speaking`  | `idle`                 | `armed` (Barge-In-Erkennung läuft weiter) |

`speaking: true` setzt `mode = speaking` und `tts.state = busy`. `trusted: true` -> `trustedSession.active` und `speakerVerification.state = verified`.
`game_mode` (String) -> `focusMode = true` und `tts.engine = piper`. `mode` ist der orb-relevante semantische Zustand (PLAN §17/§21); `OrbPort` wird hier nicht bedient.

### Verifiziert (gegen `jarvis_voice.py`, statische Prüfung, Dienst nicht ausgeführt)

- Adresse, ein Handler, kein Auth, HTTP/1.0, JSON-Form und Schlüssel (`JV:576-592`, `docs/MAPPING/voice.md` §0.1). Die Test-Fake-Implementierung (`test/fake/voice-status-server.ts`) schreibt dieselbe Rohantwort wie Pythons `http.server`.
- Port ist **geschlossen**, solange die Modelle laden (`JV:468` nach `JV:285-297`, bis ca. 3 min). `state: "starting"` ist im JSON nur für Millisekunden sichtbar.
- Der Dienst startet nur mit Sprecherprofil (fail closed, `JV:254-255`) -> `speakerVerification.enabled = true`. `trusted` wird erst nach erfolgreicher Prüfung gesetzt (`JV:422`).
- Modelle sind beim Öffnen des Ports geladen -> `stt.state = ready`.
- Es werden keine Rohaudios gespeichert (`rawRecordingEnabled = false`); Metadaten gehen in `logs/voice.jsonl` (`voiceHistoryEnabled = true`).
- Kein Push-to-talk im Dienst -> `{ enabled: false, active: false }`.

### Annahme (unbelegt) / nicht im Status enthalten

- `wakeWord.phrase`, `stt.engine`, `tts.engine`: aus der Konfiguration (Installer-Standard), nicht aus dem Dienst.
- `localModel`: Zustand ist nur die **Erreichbarkeit** von `GET /v1/models` (`ready`; 503 = `busy`, Annahme: llama-server antwortet beim Laden mit 503; sonstige 4xx/ungültige Antwort = `error`; nicht erreichbar/Timeout = `offline`). Das ist nicht der `router_fallback`-Zustand des Dienstes und `latencyMs` bleibt `null` (keine Inferenzlatenz).
- `microphone.inputLevel`: aus `input_level` des Dienstes (geglätteter RMS-Pegel 0..1, nur eine Zahl, kein Audio; `docs/MAPPING/voice.md` §0.5). Fehlt das Feld (älterer Dienst), ist es `0` = "keine Daten", nicht Stille.
- `microphone.deviceId`, `audioInputDeviceId`, `audioOutputDeviceId`: `null` (stehen nur in `voice.json`).
- `speakerVerification.recognizedSpeaker`/`confidence`, `trustedSession.expiresAt`, alle `latencyMs`: `null`. Der Dienst nennt weder Score noch Restdauer des Vertrauensfensters.
- `transcribing`/`thinking`: nicht ableitbar, `state` bleibt `command` während Sprecherprüfung, STT, Routing und Hermes-Wartezeit (`docs/MAPPING/voice.md` §0.2).

## Fehlerverhalten

| Situation                                          | `getVoiceStatus`                               | `healthCheck()`                                                  |
| -------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| Port geschlossen (Modelle laden **oder** gestoppt) | `ADAPTER_UNAVAILABLE` (retryable), kein Status | `offline`, "lädt noch Modelle (bis ca. 3 Minuten) oder gestoppt" |
| Antwort mit `state: "starting"`                    | Status mit Mikrofon `off`                      | `degraded`, `errorCode: STARTING`                                |
| Timeout                                            | `ADAPTER_TIMEOUT`                              | `offline`                                                        |
| HTTP 5xx                                           | `ADAPTER_UNAVAILABLE` (nach Retries)           | `degraded`                                                       |
| JSON kaputt / unerwartete Form                     | `VALIDATION_FAILED`                            | `degraded`                                                       |

Ob der Dienst lädt oder aus ist, kann von außen niemand unterscheiden; die Meldung nennt deshalb beide Möglichkeiten.
Nutzerinhalte (Transkripte) fließen nie durch den Adapter: der Status enthält sie nicht.

## Tests

```bash
pnpm --filter @jarvis/adapter-voice-http typecheck
pnpm exec vitest run adapters/voice-http
pnpm test:conformance
```

- `test/mapping.test.ts`: Parser und Mapper (alle Zustände, Zustandsmatrix, keine Fremdfelder).
- `test/adapter.test.ts`: gegen den byte-genauen Fake von `jarvis_voice.py` (`test/fake/voice-status-server.ts`: `offline`, `silent` = Timeout, `invalid-json`, `invalid-shape`, `http-500`, `drop`, Fehlerfolgen) und gegen einen llama-server-Fake (`test/fake/llama-server.ts`).
- `test/conformance.test.ts`: die Prüfpunkte aus PLAN §11.1 mit den Namen der Conformance-Suite.

### Conformance: Abweichung von `runConformanceSuite`

`runConformanceSuite` aus `@jarvis/adapter-testkit` (Profil `full`) setzt N paginierte Listenelemente im Fremdsystem voraus (`seed`) und erwartet, dass der
Listenaufruf bei Ausfall `ADAPTER_UNAVAILABLE` wirft. Der Voice-Dienst liefert ein einzelnes Statusdokument und keine Geräte/Profile; `listVoiceDevices`/`listVoiceProfiles`
sind ehrlich leer, daher scheitern "pagination", "schema mapping" (Items > 0) und "no provider-specific fields" der Standard-Suite zwangsläufig.
`test/conformance.test.ts` führt deshalb dieselben Prüfungen mit denselben Namen für den Ein-Dokument-Fall aus (Hilfen in `test/support/conformance-kit.ts`). Eine
Erweiterung des Testkits um ein Profil `single-resource` würde diese Hilfen ersetzen (siehe Übergabebericht).
