# DASH-17.02 — Die reale Hermes-Cron-Schnittstelle (Befund 2026-10-23)

**Zweck:** Korrektur und Grundlage für den noch fehlenden Automations-Adapter. Keine Abnahme, keine Behauptung.

## 1. Korrektur der früheren Annahme

Die Notiz `dash-17-status.md` sagte, `hermes cron list` habe „keinen JSON-Modus" und ein Adapter bräuchte
Textparsing. Das gilt für die **CLI**, ist aber nicht die einzige Quelle: Hermes liefert eine echte JSON-HTTP-API für
Cron-Jobs. Am laufenden Dienst auf `FRIDAY-2` verifiziert:

```
hermes serve --status
  1 hermes dashboard/serve process(es) running:
  PID 427 … dashboard --host 127.0.0.1 --port 43791 --no-open --skip-build

curl http://127.0.0.1:43791/api/health                    -> 200
curl http://127.0.0.1:43791/api/cron/jobs?profile=all     -> {"detail":"Unauthorized"} (HTTP 401)
```

## 2. Vollständige Endpunktliste (aus `hermes_cli/web_routers/cron.py`)

| Methode | Pfad | Bedeutung |
| --- | --- | --- |
| GET | `/api/cron/jobs?profile=all` | alle Jobs (Profil `all` oder ein Profilname) |
| GET | `/api/cron/jobs/{job_id}` | ein Job |
| GET | `/api/cron/jobs/{job_id}/runs?limit=20` | Laufhistorie eines Jobs |
| POST | `/api/cron/jobs` | Job anlegen (`CronJobCreate`) |
| PUT | `/api/cron/jobs/{job_id}` | Job ändern (`CronJobUpdate.updates`) |
| POST | `/api/cron/jobs/{job_id}/pause` | pausieren |
| POST | `/api/cron/jobs/{job_id}/resume` | fortsetzen |
| POST | `/api/cron/jobs/{job_id}/trigger` | manuell auslösen |
| DELETE | `/api/cron/jobs/{job_id}` | löschen |
| GET | `/api/cron/delivery-targets` | Zustellziele (`local` plus Gateway-Plattformen) |
| POST | `/api/cron/fire` | NAS-Webhook, JWT-geschützt, wird ans Gateway weitergeleitet |

Damit sind genau die Vorgänge abgedeckt, die der Automations-Port verlangt (`listAutomations`, `getAutomation`,
`listAutomationRuns`, `createAutomation`, `updateAutomation`, `enableAutomation`/`disableAutomation`, manuelles
Auslösen).

## 3. Anlegen-Payload (echte Feldliste aus `hermes_cli/web_models.py`)

```
CronJobCreate:
  paused: bool = false          paused_reason: str | null
  prompt: str = ""              schedule: str            (Pflicht)
  name: str = ""                deliver: str = "local"
  repeat: int | str | null      skills: list[str] | null
  model / provider / base_url   script: str | null
  context_from: Any             enabled_toolsets: list[str] | null
  workdir: str | null           no_agent: bool = false
```

`schedule` ist ein String (Cron-Ausdruck, Intervall oder Einmal-Zeitpunkt), `repeat` akzeptiert `forever`/`once`/`N`,
`deliver` nennt das Zustellziel. Das ist die Grundlage für Trigger, Zeitzonen und Zustellaktionen in 17.02.

## 4. Offener Punkt vor der Adapter-Implementierung

`/api/cron/jobs` antwortet **401 Unauthorized**. Für einen produktiven Adapter muss F.R.I.D.A.Y. ein gültiges
Dashboard-Credential haben (Passwort-/OAuth-Sitzung oder ein vom Installer hinterlegtes Token). Im Hermes-Home liegen
`auth.json` (Provider-Zugangsdaten) und `config.yaml`, aber kein offensichtliches Web-Session-Token; das müsste über
den vorgesehenen Auth-Fluss (`/api/auth/*`, nicht Teil der Cron-Routen) bezogen und wie die übrigen Hermes-Geheimnisse
in der Friday-Konfiguration referenziert werden (`file:`-Referenz, keine Klartextkopie im Repo).

Ohne dieses Credential bleibt die **Laufzeitabnahme** von DASH-17.04 blockiert; der Adapter selbst kann gegen die
dokumentierte API mit synthetischen Antworten gebaut und getestet werden.
