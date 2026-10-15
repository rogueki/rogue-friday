import { CONTRACT_VERSION, type AdapterManifest } from "@jarvis/sdk";

export const ADAPTER_ID = "jarvis-voice-http";
export const PROVIDER_ID = "jarvis-voice-http";
export const PROVIDER_SYSTEM = "jarvis-voice";
export const CONFIG_SCHEMA_ID = "urn:jarvis:adapter:jarvis-voice-http:config";

/** Installer defaults (docs/MAPPING/voice.md §0.3): status server `health_port` 43694, Qwen router 43692. */
export const DEFAULT_BASE_URL = "http://127.0.0.1:43694";
export const DEFAULT_LOCAL_MODEL_URL = "http://127.0.0.1:43692";

/**
 * JSON Schema (draft 2020-12) of the adapter's `config`. The voice status endpoint has no authentication
 * (installer/voice/jarvis_voice.py, `do_GET`), so the adapter has no secret fields.
 */
export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: CONFIG_SCHEMA_ID,
  title: "Jarvis Voice (Status-Endpunkt)",
  type: "object",
  properties: {
    baseUrl: {
      type: "string",
      format: "uri",
      default: DEFAULT_BASE_URL,
      description:
        "Basis-URL des Status-Servers des Voice-Dienstes (nur Loopback, ohne Authentifizierung). Installer-Standard: http://127.0.0.1:43694",
    },
    localModelUrl: {
      type: "string",
      format: "uri",
      default: DEFAULT_LOCAL_MODEL_URL,
      description:
        "Basis-URL des lokalen Router-Modells (llama-server). Nur für den Zustand 'localModel' im Voice-Status: GET /v1/models, Erreichbarkeit, keine Inferenzlatenz.",
    },
    localModelName: {
      type: "string",
      minLength: 1,
      default: "qwen3-router",
      description: "Anzeigename des Router-Modells (Alias aus start-qwen-server.ps1).",
    },
    wakePhrase: {
      type: "string",
      minLength: 1,
      default: "Hey Friday",
      description:
        "Fallback-Wake-Phrase, falls der Status-Server kein Feld wake_phrase liefert (ältere Installationen). Wird nur angezeigt.",
    },
    sttEngine: {
      type: "string",
      minLength: 1,
      default: "faster-whisper",
      description:
        "Anzeigename der STT-Engine (der Dienst lädt faster-whisper; das Modell steht nicht im Status).",
    },
    ttsEngine: {
      type: "string",
      minLength: 1,
      default: "piper",
      description:
        "Anzeigename der TTS-Engine. Installer-Standard: tts_url = null, also Piper. Der Status-Server liefert die Engine nicht.",
    },
    timeoutMs: {
      type: "integer",
      minimum: 20,
      maximum: 60000,
      default: 2000,
      description: "Timeout je Versuch (der Installer wartet ebenfalls 2 s).",
    },
    maxAttempts: {
      type: "integer",
      minimum: 1,
      maximum: 5,
      default: 2,
      description: "Versuche inklusive Erstversuch (nur Lesezugriffe).",
    },
    retryBaseDelayMs: { type: "integer", minimum: 1, maximum: 10000, default: 200 },
    levelPollIntervalMs: {
      type: "integer",
      minimum: 0,
      maximum: 5000,
      default: 250,
      description:
        "Abfrageintervall (ms) für Audio-Pegel-Ereignisse (jarvis.voice.audio_level), solange der Dienst aufnimmt oder spricht. 0 schaltet die Pegel-Ereignisse ab. Es wird nur eine Pegelzahl übertragen, nie Audio.",
    },
    idlePollIntervalMs: {
      type: "integer",
      minimum: 100,
      maximum: 60000,
      default: 1000,
      description:
        "Abfrageintervall (ms) in allen anderen Zuständen; erkennt nur den Wechsel in Aufnahme/Sprechen und sendet nichts.",
    },
  },
  additionalProperties: false,
} as const;

export const manifest: AdapterManifest = {
  id: ADAPTER_ID,
  name: "Jarvis Voice (Status-Endpunkt)",
  adapterVersion: "1.0.0",
  contractVersion: CONTRACT_VERSION,
  apiVersion: "v1",
  category: "voice",
  // Only what the service really exposes. No voice.test / voice.stop / voice.enroll: the service has no control interface.
  capabilities: ["voice.read"],
  configSchemaRef: CONFIG_SCHEMA_ID,
  secretFields: [],
};
