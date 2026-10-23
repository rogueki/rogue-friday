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

## 4. Credential: das Dashboard-Token genügt (verifiziert)

Der frühere Verdacht, es fehle ein Web-Credential, ist widerlegt. Hermes injiziert auf Loopback-Antworten von `GET /`
ein Session-Token (`window.__HERMES_SESSION_TOKEN__="…"`), und dieses Token authentifiziert die Cron-API:

```
curl http://127.0.0.1:43791/ | grep __HERMES_SESSION_TOKEN__   -> Token (43 Zeichen)
GET /api/cron/jobs?profile=all  ohne Header                   -> 401
GET /api/cron/jobs?profile=all  mit "X-Hermes-Session-Token"  -> 200, []
GET /api/cron/jobs?profile=all  mit "Authorization: Bearer"   -> 200, []
```

Genau diesen Weg implementiert die Adapterbasis bereits (`scrapedTokenCredential` in `adapters/hermes/src/clients.ts`,
Modus `dashboardAuth: "scrape"`). Es braucht also kein zusätzliches Geheimnis und keinen Eingriff in die
Hermes-Installation.

## 5. Voller Lebenszyklus am laufenden Dienst (2026-10-23, `no_agent`-Skriptjob)

Ein kontrollierter Testjob ohne Modellkosten, danach restlos entfernt:

| Schritt | Aufruf | Beobachtung |
| --- | --- | --- |
| Anlegen | `POST /api/cron/jobs` `{schedule:"0 3 * * *", name:"friday-probe", no_agent:true, script:"friday-probe.sh", paused:true}` | 200, `id:"cbed3f05413e"`, `enabled:false`, `state:"paused"`, `paused_reason:"Created paused; awaiting operator approval."` |
| Lesen | `GET /api/cron/jobs/{id}` | identischer Datensatz inkl. `schedule:{kind:"cron",expr,display}` |
| Auslösen | `POST /api/cron/jobs/{id}/trigger` | 200, `state:"scheduled"`, `repeat.completed:1`, `last_run_at` gesetzt, `last_status:"ok"`, `next_run_at:"2026-10-24T03:00:00+02:00"` |
| Laufhistorie | `GET /api/cron/jobs/{id}/runs?limit=5` | ein Lauf `cron_output:…:2026-10-23_17-45-26`, `preview` enthält `friday-probe-ok`, `started_at`/`ended_at` als Epoche |
| Pausieren | `POST /api/cron/jobs/{id}/pause` | 200 |
| Fortsetzen | `POST /api/cron/jobs/{id}/resume` | 200 |
| Löschen | `DELETE /api/cron/jobs/{id}` | 200 `{"ok":true}` |
| Nachher | `GET /api/cron/jobs?profile=all` | `[]` |

Zwei sicherheitsrelevante Eigenschaften sind damit belegt und für den Adapter verbindlich:

1. **Neue Jobs starten pausiert** (`state:"paused"`, Begründung „awaiting operator approval"). Der Adapter darf ein
   Anlegen daher nicht als „aktiv" melden; Aktivieren ist ein eigener Schritt (`enableAutomation`).
2. **Ein Trigger startet den Lauf und plant zugleich den nächsten Termin** (`next_run_at`). Die Antwort enthält damit
   beides — Laufbeleg und Folgeplan —, was `testAutomation` und `enableAutomation` sauber trennbar macht.

Damit ist die Datenquelle für DASH-17.02 entschieden und erprobt: **Hermes-Cron über die Dashboard-HTTP-API mit
gescraptem Session-Token**, nicht CLI-Textparsing und nicht Direktzugriff auf `state.db`.

## 6. Was daraus für den Adapter folgt

- Trigger: `schedule.kind` `cron`/`interval`/`once` → `automation-trigger.schema.json`; `display` liefert die
  menschenlesbare Form, `next_run_at`/`last_run_at` die Zeitpunkte inklusive Zone.
- Aktionen: `script` (ohne Modell), `prompt`+`skills`+`model`/`provider` (Agentenlauf), `deliver` (Zustellziel aus
  `/api/cron/delivery-targets`).
- Läufe: `runs[]` mit `started_at`/`ended_at` (Epoche), `title`/`preview`, `input_tokens`/`output_tokens` → `automation-run.schema.json`.
- Rechte: die F.R.I.D.A.Y.-Rollen bleiben vorgelagert (`automations.create`/`.update`/`.test`/`.enable`); Hermes kennt
  keine F.R.I.D.A.Y.-Rollen, nur das Dashboard-Token.
