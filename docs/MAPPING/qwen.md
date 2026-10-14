# Mapping: Lokales Qwen (`127.0.0.1:43692`) -> kanonisches Modell

Quelle der Analyse: `installer/` (nur lesend, statisch). Zielpaket: später ein Adapter für `voice.localModel` und Service-Health
(`localModel.name/state/latencyMs` in `docs/MAPPING/voice.md` §4). Das Dashboard spricht nie direkt mit dem Server; ein Adapter übersetzt.
Kürzel: `IP` = `installer/install-jarvis.ps1`, `SQ` = `installer/scripts/start-qwen-server.ps1`, `JV` = `installer/voice/jarvis_voice.py`,
`VS` = `installer/voice/voice_setup.py`. Alles, was nicht im Repo belegt ist, steht als **Annahme (unbelegt)**.

## 1. Was gestartet wird (belegt)

| Aspekt               | Befund                                                                                                                                                                                   | Beleg                          |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Server               | `llama-server.exe` aus llama.cpp (Windows-Binary, **nativ unter Windows**, nicht in WSL)                                                                                                 | `SQ:16`                        |
| Fundort / Version    | `C:\Jarvis\llama.cpp\llama-server.exe`; Quelle: **neueste** Release von `ggml-org/llama.cpp` (GitHub-API, 40 Releases), die ein passendes Asset hat; **nicht gepinnt**                   | `IP:320-330`                   |
| Varianten            | `llama-b<N>-bin-win-<flavor>[<ver>]-x64.zip`; `flavor` = `cpu` (keine NVIDIA), `cuda-12.4` (cc < 12), `cuda-13` (cc >= 12); bei CUDA zusätzlich `cudart-llama-bin-win-<flavor>*-x64.zip` | `IP:318-328`                   |
| Integrität Binary    | SHA-256 gegen das GitHub-Feld `digest` (falls vorhanden)                                                                                                                                 | `IP:334`                       |
| Modell               | `Qwen/Qwen3-4B-GGUF`, Datei `Qwen3-4B-Q4_K_M.gguf` (Revision `main`), SHA-256 `7485fe6f...34fdf5` fest hinterlegt                                                                        | `IP:338-342`                   |
| Modellpfad           | `C:\Jarvis\models\Qwen3-4B\Qwen3-4B-Q4_K_M.gguf`                                                                                                                                         | `IP:338`, `SQ:8`               |
| Parameterdatei       | `C:\Jarvis\config\qwen.json` = `{"ctx_size": 8192 \| 4096, "gpu_layers": 99 \| 0}` (8192 nur bei NVIDIA mit > 7000 MB VRAM; GPU-Layer nur bei NVIDIA)                                    | `IP:344-346`, `SQ:4`           |
| Aufruf               | `-m <Modell> --alias qwen3-router --host 127.0.0.1 --port 43692 --ctx-size <ctx> --n-gpu-layers <layers> --parallel 1 --jinja`                                                           | `SQ:7-15`                      |
| Prozessmodell        | `Start-Process ... -WindowStyle Hidden`, stderr -> `C:\Jarvis\logs\qwen-server.log`, stdout -> `C:\Jarvis\logs\qwen-server.log.out`. Kein Neustart bei Absturz                           | `SQ:16-17`                     |
| Einzelinstanz        | Start wird übersprungen (`exit 0`), wenn `43692` bereits lauscht                                                                                                                         | `SQ:6`                         |
| Bindung              | nur `127.0.0.1` (kein `--host 0.0.0.0`)                                                                                                                                                  | `SQ:10`                        |
| Authentifizierung    | **keine**: kein `--api-key` in den Flags; Aufrufer senden keinen `Authorization`-Header                                                                                                  | `SQ:7-15`, `JV:383`            |
| Autostart            | Aufgabe `JARVIS_Qwen` (bei Anmeldung des Installationsbenutzers, ohne Verzögerung) -> `wscript //B //Nologo hidden.vbs start-qwen-server.ps1`                                            | `IP:353`, `IP:91-100`          |
| Konfliktschutz Voice | `start-jarvis-voice.ps1` wartet bis zu 60 x 2 s auf `GET /v1/models` und startet danach in jedem Fall                                                                                    | `start-jarvis-voice.ps1:13-15` |

## 2. HTTP-Schnittstelle

### 2.1 Im Repo belegt (genutzt von Installer und Voice-Dienst)

| Endpunkt                    | Nutzung                                                                                                                                                 | Beleg                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `GET /v1/models`            | Bereitschaftsprüfung: Installer (bis 120 s, jede Ausnahme = nicht bereit) und Voice-Start-Skript. Antwort wird nicht ausgewertet, nur Erfolg (HTTP 2xx) | `IP:348`, `start-jarvis-voice.ps1:14` |
| `POST /v1/chat/completions` | Smoke-Test des Installers und Router-Aufruf des Voice-Dienstes (`qwen_url`)                                                                             | `IP:349-351`, `JV:383`, `VS:100`      |

Request des Routers (`JV:371-381`), Header nur `Content-Type: application/json`, Timeout 20 s (`JV:383`):

```json
{
  "model": "qwen3-router",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.2,
  "max_tokens": 120,
  "chat_template_kwargs": { "enable_thinking": false },
  "grammar": "root ::= ... (GBNF, JV:65-69)"
}
```

Antwort-Auswertung: `choices[0].message.content` (`JV:383`), danach Split an `|` in fünf Felder `ROUTE|BG|CONFIRM|PRIO|ANTWORT`
(`JV:384`). Bei jeder Ausnahme (Server down, Format falsch, Timeout) fällt der Dienst auf Route `kimi_low` zurück und loggt
`router_fallback` (`JV:387-390`) -> das ist das einzig belegte Fehlersignal für „Qwen nicht erreichbar“.

Smoke-Test des Installers (`IP:349-352`): `model: qwen3-router`, `max_tokens: 10`, `enable_thinking: false`, Nutzernachricht
`Antworte nur mit LOCAL_OK`; Erwartung nur „es kommt Text zurück“, kein Inhaltsvergleich.

### 2.2 Nicht im Repo belegt (Annahme (unbelegt))

Der Server ist ein unmodifiziertes `llama-server`; folgende Endpunkte sind aus dem llama.cpp-Projekt bekannt, aber **in diesem Repo weder
aufgerufen noch dokumentiert** und hängen von der gewählten (ungepinnten) Release ab:

| Endpunkt / Verhalten         | Status                                                                                                                                                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`                | Annahme (unbelegt): liefert 200 `{"status":"ok"}` wenn Modell geladen, 503 während des Ladens                                                                                                                                      |
| `GET /props`, `GET /slots`   | Annahme (unbelegt): Server-Eigenschaften / Slot-Auslastung; `/slots` und `/metrics` können je nach Release/Flag deaktiviert sein (`--metrics` wird nicht gesetzt)                                                                  |
| `GET /v1/models` Antwortform | Annahme (unbelegt): OpenAI-Liste mit einem Eintrag, `id` = Alias `qwen3-router` (der Alias ist belegt: `SQ:9`)                                                                                                                     |
| Streaming (`stream: true`)   | Annahme (unbelegt): vom Server unterstützt, vom Repo nicht genutzt                                                                                                                                                                 |
| Verhalten bei Last           | `--parallel 1` (`SQ:13`) = ein Slot; belegt ist nur, dass Anfragen sich dann nach hinten anstellen müssen; Health-Polling darf den Router-Pfad nicht blockieren, daher `GET`-Endpunkte (kein Chat-Request) für die Probe verwenden |

## 3. Zuordnung zum kanonischen Modell

| Kanonisches Feld                      | Quelle                                                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Service `qwen` online/offline         | `GET /v1/models` ok (belegt als Bereitschaftsprüfung); Verbindungsfehler = offline; 503/Timeout beim Laden = `starting` (Annahme (unbelegt): 503 beim Laden) |
| `localModel.name`                     | `qwen3-router` (Alias, `SQ:9`); Anzeigename `Qwen3-4B` (Datei `Qwen3-4B-Q4_K_M.gguf`)                                                                        |
| `localModel.state = error`            | Voice-Log-Ereignis `router_fallback` (`JV:388`), siehe `voice.md` §3                                                                                         |
| `localModel.latencyMs`                | `router_ms` im Voice-Log-Ereignis `command` (`JV:441`); eigene Messung per `GET /v1/models` ist nur Erreichbarkeit, nicht Inferenzlatenz                     |
| Kontext / GPU-Offload (Detailanzeige) | `C:\Jarvis\config\qwen.json` (`ctx_size`, `gpu_layers`); Variante CPU/GPU zusätzlich in `install-state.json` -> `gpu`                                        |

## 4. Betriebs- und Sicherheitshinweise für den Adapter

- Der Server ist ein Windows-Prozess auf Loopback. Ein Node-Adapter auf demselben Rechner erreicht ihn direkt; aus WSL nur mit
  `networkingMode=mirrored` (Build >= 22621, `IP:222`), sonst nicht. Hermes selbst ruft Qwen nicht auf.
- Keine Authentifizierung: nichts am Port 43692 exponieren, nicht über die Control API durchreichen. Prompts enthalten Nutzerinhalte
  (Router-Verlauf `history[-6:]`, `JV:375`) -> Anfragen/Antworten nie loggen oder spiegeln.
- `llama-server` ist nicht gepinnt (neueste Release beim Installationslauf). Vor dem Adapterbau die installierte Version prüfen
  (`C:\Jarvis\llama.cpp\llama-server.exe --version`, Annahme (unbelegt): Flag vorhanden) und `/health`/`/props` dagegen verifizieren.
- Nach einem Absturz startet nichts neu (anders als der Voice-Dienst, der per Schleife neu startet, `start-jarvis-voice.ps1:17-26`).
  Neustart erst bei der nächsten Anmeldung (`JARVIS_Qwen`) oder manuell per `start-qwen-server.ps1`.
- Offen/unbelegt: ob der von der Aufgabe `JARVIS_Qwen` gestartete Kindprozess nach Ende der Aufgabeninstanz weiterläuft (Task-Scheduler-Verhalten
  ist statisch nicht prüfbar) -> auf einem echten Windows-Rechner testen (Neuanmeldung, danach `Get-NetTCPConnection -LocalPort 43692`).
