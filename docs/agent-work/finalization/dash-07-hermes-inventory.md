# DASH-07 — Hermes-Inventar (07.01/07.02)

Stand: 2026-10-22. Erfasst am laufenden System `D:\Dokumente\F.R.I.D.A.Y` / WSL-Distro `FRIDAY-2`.
Alle Kommandos waren rein lesend; keine Konfiguration, kein Modellaufruf, kein Schreibzugriff.

## 1. Tatsächlich installierter Hermes-Stand

| Fakt | Wert | Nachweis |
|---|---|---|
| Version | `Hermes Agent v0.22.2 (2026.9.24) · stable · local d923a5eb487a` | `hermes --version` |
| Installationsart | git, `/home/ubuntu/.hermes/hermes-agent` | `hermes --version` |
| Laufzeit | Python 3.14.7, OpenAI SDK 2.24.0 | `hermes --version` |
| Configschema | `_config_version: 50`, `config.yaml` 3116 Byte | `~/.hermes/config.yaml` |
| Update-Status | „Update available — run 'hermes update'" | `hermes --version` |
| Gateway | `hermes-gateway.service` active (running), PID 2069, Profil `default` | `hermes gateway status`, `hermes gateway list` |
| Sessions | 1 (`api-6f61a45ee029a4f7`, 4 h alt) | `hermes sessions list` |
| Cron | keine geplanten Jobs | `hermes cron list` |
| Fallback-Kette | leer („No fallback providers configured") | `hermes fallback list` |
| Modell | `k3` über Provider `kimi-coding` | `hermes config get model` |
| Provider-Katalog | 232 Provider, 9168 Modelle im Picker-Cache | `~/.hermes/models_dev_cache.json` |
| Aktive Plugins | `friday-dashboard-calendar`, `friday-dashboard-mail`, `friday-memory` | `config.yaml → plugins.enabled` |
| Skill-Katalog | 12 Kategorien, **58** `SKILL.md` | `~/.hermes/skills/*/` |
| Skill-Fremdverzeichnis | `/mnt/d/Dokumente/F.R.I.D.A.Y/skills/friday-skills/skills` | `config.yaml → skills.external_dirs` |
| Tools | browser, chromium, cua-driver, ffmpeg, node 26.7, npm 12.0.2, python 3.14.7, ripgrep, uv | `~/.hermes/tools/` |
| Friday-Bridges | calendar, mail, memory, messenger (alle Port 3101) | `~/.hermes/friday-*-bridge.json` |
| Platform-Toolsets | cli, telegram, discord, whatsapp, slack, signal, qqbot, yuanbao, teams, google_chat | `config.yaml → platform_toolsets` |

### Befund zur Modell-Anmeldung (neues Issue N-008)

`hermes auth list` zeigt genau **eine** Inferenz-Credential: `kimi-coding`, `KIMI_API_KEY`, `priority=0`,
zuletzt **`auth failed permission_error (403) (re-auth may be required)`**. `hermes auth status kimi-coding`
meldet dagegen „logged in" (Zustand aus `auth.json`, nicht aus einem frischen Aufruf). Der Katalog ist reich,
die produktive Modellanmeldung ist es nicht: vor jedem „KI-Zugang funktioniert"-Nachweis muss ein echter
Modellaufruf belegt werden. Das ist DASH-07.05, nicht dieser Inventarschritt.

## 2. Friday-Oberflächen, die heute auf Hermes zeigen

11 Vertragsoperationen (`packages/contracts/openapi/friday-api.yaml`, alle `owner`):

`GET/PATCH /settings/hermes-config`, `GET/POST /settings/hermes-cron/jobs`,
`POST /settings/hermes-config/mcp-probe`, `POST /settings/hermes-config/approval-test`,
`POST /settings/hermes-config/mcp-oauth`, `GET /settings/hermes-model-catalog`,
`GET/PATCH /settings/hermes-skill-keys`, `POST /settings/hermes-skill-keys/{key}/check`.

Backend: `apps/control-api/src/services/hermes-config.ts` (783 Zeilen) mit **82 typisierten Feldern**
(`HERMES_CONFIG_FIELDS`; execution 42, operations 18, agent 16, models 5, extensions 1), Familien `models`, `agent`, `execution`, `operations`, `extensions`; jeder Eintrag
nennt den tatsächlichen Konsumenten (z. B. „new Hermes model request", „next Hermes fallback decision").
UI: `HermesConfigArea.tsx` (685 Zeilen) sowie `SkillAccountsArea`, `voice`, `notifications`, `modelsRouting`.

## 3. Paritätsmatrix gegen den alten Paritätsplan

Grundlage: `PLAN_DASHBOARD_HERMES_PARITY.md` (18 Zeilen Bestandsaufnahme). „Fläche" = native Friday-Oberfläche,
„Backend" = wirksame Operation, „Rest" = was für 07.03–07.05 fehlt.

| Hermes-Bereich | Fläche | Backend | Rest |
|---|---|---|---|
| `providers-settings` (Anbieter + Modell) | HermesConfigArea, Felder `model.provider`, `model.default` | `PATCH /settings/hermes-config` + Rückleseprobe | nur Freitext/Modellkatalog, keine OpenAI/Anthropic-Kacheln mit „Erweitert" → 07.03 |
| `keys-settings`/`env-credentials` | Felder für `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | `credential-update` + Maskierung | 232 Provider, aber nur 3 Key-Felder → 07.03 |
| Connections-Registry (OAuth-Connectoren) | MCP-Server, MCP-OAuth (`mcp.httpServer`, `mcp.activation`, `mcp.bearerCredential`, `mcp-oauth`) | `mcp-probe`, `manageHermesMcpOAuth` | Hermes 0.22.2 bietet keine separate Connectoren-Registry; MCP ist die reale Fläche → in 07.03 als „nicht vorhanden" führen |
| `custom-endpoints-settings` | — | — | **fehlt vollständig**: kein Feld für `model.base_url`/OpenAI-kompatible Endpoints → 07.03 |
| `model-settings`/Fallback-Kette | `fallback_model`, `fallback.min_switch_reset_seconds` | `PATCH` + `hermes fallback`-Rückleseprobe | Kette live leer, Verdrahtung vorhanden → 07.05 |
| `pool-limits-setting` (mehrere Keys) | — | — | **fehlt**: `hermes auth add/list/priority/reset` (Pool) hat keine Friday-Fläche → 07.03/07.05 |
| `voice-provider-fields` (TTS/STT) | Voice-Area + `SttModelsControl` | eigene Voice-Endpunkte, `stt.*` in Hermes | STT-Modellwechsel ist Friday-nah, TTS bleibt Installer-Sache → DASH-12 |
| `vault-settings` (Obsidian) | Gedächtnis-Bereich, Plugin `friday-memory` | Bridge `friday-memory-bridge.json` | Vault-Pfad folgt der Installation, keine Hermes-Config-Fläche nötig |
| `memory/` (Engine, Suche) | Gedächtnis-Bereich | `memory.*` (enabled, Limits, Nudge) **nicht** in `HERMES_CONFIG_FIELDS` | Lese-/Schreibfläche für `memory.*` fehlt → 07.03 als „Gedächtnis" |
| `gateway-settings` | Gateway-Watchdogs (`gateway.*`, 8 Felder), Platform-Toolsets | `PATCH` wirkt erst mit neuem Prozess (`consumer` dokumentiert das) | Start/Stop/Restart und Plattform-Auswahl → DASH-08 |
| `notifications-settings` | Notifications-Area + `display.background_process_notifications` (nicht in Feldern) | Friday-eigene Benachrichtigungen | Hermes-seitige Benachrichtigungskanäle (`kanban notify-*`, Gateway-Plattformen) fehlen → 07.03 |
| `local-models-*` | — | llama-server 43792, Qwen im Installer | **fehlt**: kein Friday-Feld für lokale Provider/Endpoint → 07.03 |
| `plugin-settings`/`toolset-config-panel` | `toolsets`, `skills.disabled`, Plugin-Aktivierung | `plugin-activation`, `PATCH` | Skill-Fremdverzeichnis (`skills.external_dirs`) nicht editierbar → 07.03 |
| `sessions-settings` | `max_concurrent_sessions`, `max_live_sessions`, `session.terminal_continue` | `PATCH` | Browse/Export/Löschen (`hermes sessions`) nicht angebunden → 07.04/07.05 |
| Onboarding | Friday-eigene Einführung | — | erledigt, keine Hermes-Parität nötig |
| `profile-scope`, `shared-metrics` | — | — | im alten Plan „nein"; Telemetrie bleibt aus → keine Arbeit |
| Desktop-Optik/Keybinds/Pet/Screenshot | — | — | im alten Plan „nein"; Electron-App wird nicht ausgeliefert → keine Arbeit |
| Billing/Updates/Uninstall | Update-Hinweis | `hermes --version` meldet „Update available" | kein Friday-Feld → bewusst nicht (DASH-11/REL) |

Zusätzlich inventarisiert, weil im Auftrag ausdrücklich genannt und früher „später/teilweise":

| Fähigkeit | Hermes-Realität | Friday heute |
|---|---|---|
| Fallbacks | `fallback add/remove/clear`, live leer | `fallback_model` + Mindestumschaltzeit |
| Mehrfachkeys/Limits | `auth add/priority/reset/refresh`, Pool pro Provider | keine Fläche (N-008 zeigt, warum das zählt) |
| Customendpoints | `model --portal-url/--inference-url`, `hermes proxy` (OAuth-Upstream für externe Apps) | keine Fläche |
| Lokale Modelle | llama-server 43792, Qwen-Paket, `tools/python|node` | keine Fläche |
| Benachrichtigungen | Gateway-Plattformen, `kanban notify-subscribe`, `display.background_process_notifications` | Friday-Benachrichtigungen, keine Hermes-Kopplung |
| Memory/Vault | `memory.*`, Plugin `friday-memory`, `state.db` | Gedächtnis-Bereich, `memory.*` nicht editierbar |
| Toolsets/Plugins | Plugins (3 aktiv), Toolsets je Plattform, Skills (58) | `toolsets`, `skills.disabled`, Plugin-Schalter |
| Sessions | `sessions list/export/delete/prune/stats` | drei Felder, keine Verwaltung |
| Gateway | systemd-Service, 10 Plattform-Toolsets | Watchdogs, Plattform-Setups (DASH-08) |
| Tasks/Aktivität | `kanban` (SQLite-Board, Dispatch, Swarm), `cron` | Tasks/Activity sind Mock-Daten, keine Kanban-Bridge |
| MoA | `hermes moa list/configure/delete` | keine Fläche |
| Secrets (Bitwarden/1Password) | `hermes secrets` | keine Fläche |
| Prompt-Caching/Compression | `prompt_caching.cache_ttl`, `compression.*` | Compression-Felder vorhanden, Caching nicht |
| Egress-Firewall | `hermes egress` | keine Fläche |

## 4. Konsequenz für die nächsten Schritte

- **07.03** braucht: Provider-/Key-Fläche für mehr als die drei bestehenden Keys, Customendpoints, lokale
  Modelle, Gedächtnis-Felder (`memory.*`), Benachrichtigungskopplung — jeweils als Vertrag in
  `packages/contracts` + `HERMES_CONFIG_FIELDS`-Erweiterung mit echtem Konsumenten, nicht als erfundene API.
- **07.04** braucht: OAuth-/Deviceflow über den Hermes-eigenen Flow (`hermes auth add … --type oauth`,
  `model --no-browser`) mit URL/Code/Ablauf/Abbruch — kein eigener OAuth-Client.
- **07.05** kann sich auf den echten Modellaufruf stützen (N-008 offen: KIMI-Key 403), auf
  Fallback-Kette, zweiten Zugang nach Neustart und definierte Modellversion je Worker.
- **Nicht verfügbar** und daher zu begründen statt zu bauen: separate Connectoren-Registry, MoA, Secrets-Manager,
  Prompt-Caching, Egress — Hermes bietet sie als CLI, Friday hat dafür keinen Vertrag; sie bleiben
  „nicht verfügbar" bis eine Anforderung sie verlangt.