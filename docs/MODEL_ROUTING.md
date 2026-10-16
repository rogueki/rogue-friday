# Sprachdialog: Modellrouting und Antwortzeit

Der lokale Qwen-Router ordnet erkannte Befehle vier Stufen zu. Uhrzeit, Datum, Smalltalk und einfache Fragen beantwortet er lokal. Aufgaben mit Konten, Dateien oder Tools gehen an Hermes. Der Sprachdienst sendet fuer Cloud-Anfragen `model`, `provider` und `model_options.reasoning_effort` pro Request an die Hermes-API. Eine Systemanweisung allein schaltet Thinking nicht aus.

| Stufe | Standard mit Kimi Code | Denkstufe |
| --- | --- | --- |
| Lokal | Qwen3-4B auf dem Geraet | aus |
| Routine | `kimi-for-coding` | aus (`none`) |
| Komplex | `k3` | `high` |
| Kritisch | `k3` | `max` |

Die Cloud-Zuordnung steht in `config/voice.json` und kann nach der Anmeldung bei einem anderen Hermes-Anbieter gewechselt werden:

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

Bei anderen Anbietern muessen die drei Modell-IDs aus der dort verfuegbaren Hermes-Modellliste stammen. Fehlt eine Stufe, verwendet der Sprachdienst den konfigurierten Hermes-Standardalias. Der Installer richtet derzeit nur Kimi Code automatisch ein; die ChatGPT/Codex- und Claude-Anmeldung ist ein offener Installationspunkt.

Nach dem Ende jeder Antwort bleibt das Mikrofon 15 Sekunden fuer eine Folgefrage ohne Wake Word offen. Der Sprecher wird bei jeder Folgefrage erneut geprueft. Waehrend Friday spricht, kann das Wake Word die Ausgabe unterbrechen.

Die Antwortzeit ist getrennt zu betrachten: Qwen3-TTS startet derzeit fuer jeden neuen Satz einen eigenen Prozess. Auf der getesteten RTX 4080 brauchte ein kurzer Satz zuerst 8,44 Sekunden und warm 5,11 bis 5,76 Sekunden. Kurze wiederholte Saetze liegen in einem begrenzten Speicher-Cache. Eine neue dynamische Sprachantwort bleibt mit dieser Engine langsamer; reine Hermes-Textlatenz ist kein Beleg fuer eine ebenso schnelle Audioantwort.

Quellen: [Hermes API: Modellwahl pro Request](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/api-server.md), [Kimi Code: Modelluebersicht](https://www.kimi.com/code/docs/en/kimi-code/models), [llama.cpp TTS](https://github.com/ggml-org/llama.cpp/blob/master/tools/tts/README.md).
