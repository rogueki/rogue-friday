# Sprachdialog: Modellrouting und Antwortzeit

Im lokalen Sprachmodus ordnet Qwen erkannte Befehle vier Stufen zu; im ElevenLabs-Modus übernimmt ein leichter, regelbasierter Router diese Auswahl ohne lokales Sprachmodell. Uhrzeit und Datum kommen direkt von der Systemuhr. Aufgaben mit Konten, Dateien oder Tools gehen an Hermes. Der Sprachdienst sendet fuer Cloud-Anfragen `model`, `provider` und `model_options.reasoning_effort` pro Request an die Hermes-API. Eine Systemanweisung allein schaltet Thinking nicht aus.

| Stufe | Standard mit Kimi Code | Denkstufe |
| --- | --- | --- |
| Lokal | Qwen3-4B auf dem Geraet | aus |
| Routine | `kimi-for-coding` | aus (`none`) |
| Komplex | `k3` | `high` |
| Kritisch | `k3` | `max` |

Die Standard-Zuordnung steht in `config/voice.json`. Fuer Sprachaufgaben liest Friday zusaetzlich die gespeicherten Dashboard-Einstellungen **Modelle & Routing**: `voice-routine`, `voice-complex` und `voice-critical` haben Vorrang. Werte haben das Format `kimi-coding:modell-id`, `openai:modell-id` oder `anthropic:modell-id`; Aenderungen gelten beim naechsten Sprachkommando. Die API-Zugangsdaten des gewaehlten Anbieters muessen separat in Hermes eingerichtet sein.

```json
{
  "cloud_provider": "kimi-coding",
  "cloud_models": {
    "cloud_low": "kimi-for-coding",
    "cloud_high": "k3",
    "cloud_max": "k3"
  }
}
```

Bei anderen Anbietern muessen die Modell-IDs aus der dort verfuegbaren Hermes-Modellliste stammen. Fehlt eine gueltige Dashboard-Route, greift die Zuordnung in `voice.json`; ohne Modell-ID wird kein Anbieteraufruf ausgelöst. Der Installer richtet derzeit Kimi Code automatisch ein. Die optionalen Anmeldungen bei Codex und Claude Code gelten fuer Coding-CLI-Auftraege und ersetzen keinen allgemeinen OpenAI- oder Anthropic-API-Zugang. Laut aktueller [Kimi-Code-Modellliste](https://www.kimi.com/code/docs/en/kimi-code/models) ist `kimi-for-coding` inzwischen K2.8 Preview; K2.7 HighSpeed hat eine eigene, tarifabhaengige Modell-ID.

Nach dem Ende jeder Antwort bleibt das Mikrofon 15 Sekunden fuer eine Folgefrage ohne Wake Word offen. Der Sprecher wird bei jeder Folgefrage erneut geprueft. Waehrend Friday spricht, kann das Wake Word die Ausgabe unterbrechen.

Die Antwortzeit ist getrennt zu betrachten: Lokales Qwen3-TTS startet derzeit fuer jeden neuen Satz einen eigenen Prozess. Im Cloud-Modus geht abgeschlossene Sprache als PCM an ElevenLabs Scribe v2; Flash v2.5 liefert die Antwort als Audio-Stream. Damit entfallen GPU-Modellstarts, die Endzeit haengt aber weiter von Mikrofonsegment, Netzwerk, STT, Hermes-Modell und TTS ab. Die Cloud-Anbindung wurde ohne kostenpflichtigen Anbieteraufruf geprueft; eine gemessene Antwortzeit fuer ein konkretes ElevenLabs-Konto liegt noch nicht vor. Ein vollstaendig kopfloser Server benoetigt zusaetzlich einen Browser-Audiokanal, der noch nicht implementiert ist.

Quellen: [Hermes API: Modellwahl pro Request](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/api-server.md), [Kimi Code: Modelluebersicht](https://www.kimi.com/code/docs/en/kimi-code/models), [llama.cpp TTS](https://github.com/ggml-org/llama.cpp/blob/master/tools/tts/README.md).
