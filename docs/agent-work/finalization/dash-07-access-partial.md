# DASH-07.03 bis 07.06 - Zugangsfläche, OAuth, Abnahme und Recovery (Teilstand)

Stand: 2026-10-23. Nachweisbasis: aktueller Arbeitsbaum auf `feat/friday-finalization-20261021`.

## 1 Was heute existiert und belegt ist

- `GET/PATCH /settings/hermes-config` mit 82 typisierten Feldern (`HERMES_CONFIG_FIELDS`) und echten
  Konsumenten je Feld; Secrets maskiert; PATCH mit erwarteter Revision, Rückleseprobe.
  Belege: `apps/control-api/test/hermes-config.test.ts` (u. a. "returns only allowlisted resolved values and
  installed manifests without credential leakage"), `hermes-config-routes.test.ts`.
- Modellfelder `model.provider`, `model.default`, Fallback-Kette (`fallback_model`,
  `fallback.min_switch_reset_seconds`) in `HermesConfigArea`; Änderungen werden über den generierten Vertrag
  geschrieben und zurückgelesen.
- Provider-Katalog über `GET /settings/hermes-model-catalog` (9168 Modelle im Picker-Cache, 232 Provider).
- MCP-OAuth asynchron über `POST /settings/hermes-config/mcp-oauth` (Probe/Status), kein eigener OAuth-Client.
- Versionabweichung: ein Konflikt zwischen erwarteter und tatsächlicher Revision/`sourceRevision` endet als
  `CONFLICT` und stoppt genau diese Mutation (`hermes-config.test.ts`, `store_revision_conflict`).

## 2 Was fehlt (Stand nach Inventar `dash-07-hermes-inventory.md`)

- **07.03**: keine Friday-Fläche für `hermes auth add/list/remove/reset/logout`, also kein Anzeigen bestehender
  Zugänge, kein Hinzufügen, Erneuern und Trennen, keine Unterscheidung Abo/OAuth gegen API-Key, keine
  Pool-Prioritäten/Mehrfachkeys. Ebenso fehlen Customendpoints (`model.base_url`), lokale Modelle,
  `memory.*`-Felder und eine Benachrichtigungskopplung. Die drei vorhandenen Key-Felder decken nur drei
  Provider ab und sind kein Zugangsmanagement.
- **07.04**: kein Provider-OAuth-/Deviceflow. Der Hermes-Flow (`hermes auth add … --type oauth`,
  `model --no-browser`) ist nicht angebunden; Browserrückkehr, Code, Ablauf und Abbruch fehlen. MCP-OAuth ist
  vorhanden, aber ein anderer Flow.
- **07.05**: keine Inventarzeile mit "native Fläche + wirksame Operation" für die oben genannten Bereiche; ein
  echter Modellaufruf ist auf diesem Rechner nicht belegt (siehe 3.).
- **07.06**: "fehlgeschlagener neuer Login verändert den Standardzugang nicht" und "Abbruch löscht nur den
  kurzlebigen Flow" setzen 07.03/07.04 voraus; die Versionsabweichung ist dagegen bereits belegt.

## 3 Befund zur Umgebung (2026-10-23, rein lesend)

- Auf diesem Rechner ist Hermes **direkt erreichbar**: `C:\Users\ByteNinja\AppData\Local\hermes\bin\hermes.exe`,
  Version `v0.20.5 (2026.8.19)`; zusätzlich `hermes` in der WSL-Distro `Friday-Ubuntu`
  (`/home/byteninja/.local/bin/hermes`).
- Das weicht von der Inventarbasis ab (dort `v0.22.2` in Distro `FRIDAY-2`). Die Versionsangabe ist damit
  installationsabhängig; Friday muss sie je Laufzeit lesen und in der Oberfläche nennen, statt eine feste
  Version zu behaupten.
- `hermes auth list` zeigt zwei Provider mit je einem Key (`copilot` → `gh_cli`, `kimi-coding` →
  `env:KIMI_API_KEY`); `hermes auth --help` listet `add/list/remove/reset/status/logout/spotify`.
  Die CLI-Fläche ist also vorhanden - die Friday-Fläche fehlt.
- Ein echter Modellaufruf wurde **nicht** ausgeführt (kein Verbrauch, keine Änderung). Die Inventarnotiz N-008
  (403 beim einzigen früheren Kandidaten) bleibt damit offen und ist Voraussetzung für 07.05.

## 4 Konsequenz

07.03 bis 07.06 bleiben **TEIL**. Nächster konkreter Schritt (nächste Runde):

1. Vertrag für Zugänge: `GET /settings/hermes-access` (Liste mit Provider, Art Abo/Key, maskiert, Priorität),
   `POST /settings/hermes-access` (add, Key nur nach ausdrücklicher Übernahme), `POST .../renew`,
   `DELETE .../{id}`; Abbildung auf `hermes auth add/remove/reset/logout` mit Rückleseprobe.
2. UI im Adapterdetail: OpenAI/Anthropic als Hauptauswahl, "Erweitert" für weitere Provider; vorhandene
   Zugänge mit Status; Test/Erneuern/Trennen; Abo und API-Key getrennt beschriften.
3. Erst danach 07.04 (Flow über Hermes), 07.05 (echter Modellaufruf + Worker-Modellversion) und 07.06
   (Login-Fehler/Abbruch).

## 5 Nachweise dieses Teilstands

| Pruefung | Ergebnis |
| --- | --- |
| `vitest --project node hermes` (in der vollen Suite) | grün; 2801 Tests, 60 skipped, Exit 0 |
| `vitest --project web` | 85 Dateien / 674 Tests grün |
| `pnpm lint` / `pnpm typecheck` / `pnpm build:app` | 0 Fehler / 0 / 0 |
| `hermes --version`, `hermes auth list`, `hermes auth --help` | rein lesend erfasst; v0.20.5, zwei Key-Provider, CLI-Fläche vorhanden |

Keine Erfolgsmeldung für 07.03 bis 07.06: die Flächen fehlen nachweislich, und ohne echten Modellaufruf wäre
jede Abnahme unbelegt.

## 6 CLI-Fakten fuer die Umsetzung (rein lesend, 2026-10-23)

- `hermes auth add <provider> [--type oauth|api-key|api_key] [--label L] [--api-key K]
  [--portal-url U] [--inference-url U] [--client-id ID] [--scope S] [--no-browser] [--timeout T] [--insecure]
  [--ca-bundle P]` - ohne `--api-key` fragt die CLI sicher ab.
- `hermes auth list [provider]` (Textausgabe, keine JSON-Option), `hermes auth status <provider>`,
  `hermes auth remove <index|id|label>`, `hermes auth reset <provider>`, `hermes auth logout <provider>`.
- Beispielausgabe `hermes auth list`: `copilot (1 credentials):` / `  #1  gh auth token   api_key gh_cli ←`.
  Die Ausgabe ist damit parsebar, aber formatabhaengig; ein nichterkanntes Format muss als Fehler sichtbar
  werden, nicht als leere Liste.
- Sicherheit: ein Key darf nicht als Argument in der Prozessliste landen. Die Bridge muss den Key ueber
  stdin an die Abfrage geben (die CLI fragt ohne `--api-key`), nicht ueber `--api-key`; die Antwort darf
  keinen Key enthalten, nur maskierte Herkunft (`env:NAME`, `api_key`, `oauth`).
- Abo vs. API-Key: `copilot`/`gh_cli` und `env:KIMI_API_KEY` sind API-Keys; `--type oauth` ist der Abo-/
  Login-Weg. Die Friday-Oberflaeche muss beide getrennt beschriften und den OAuth-Weg ueber den Hermes-Flow
  fuehren (07.04), nicht ueber einen eigenen Client.

## 7 Zwischenstand 2026-10-23 (Commit `9cc8a81`)

Der Backend-Leseweg fuer Zugaenge steht: `hermes auth list` wird rein lesend ueber den Config-Bridge
(`auth-list`) gelesen und streng geparst. Der Parser liefert Provider, Anzahl, Index, Label, Typ, maskierte
Quelle (`env:NAME`, `gh_cli`) und die aktive Markierung; ein unbekanntes Format oder eine abweichende Anzahl
endet als `auth_list_format` statt als leere Liste. Ein Key wird nie ausgegeben.
Nachweis: `installer/wsl/tests/test_hermes_auth_list.py` in WSL - 4 Pruefungen bestanden.

Noch offen fuer 07.03: Vertrag (`GET/POST /settings/hermes-access`), Service-/Handler-Anbindung,
UI im Adapterdetail (OpenAI/Anthropic als Hauptauswahl, "Erweitert", hinzufuegen/erneuern/trennen,
Abo vs. API-Key) und der echte Add-/Remove-Nachweis. Erst danach 07.04 bis 07.06.

## 8 Zwischenstand 2026-10-23 (Commit `de12b5c`)

Der Leseweg reicht jetzt bis zur API: `GET /api/v1/settings/hermes-access` (owner) liefert Provider, Anzahl,
Index, Label, Typ, maskierte Quelle und Aktivmarkierung; Vertrag, SDK und Routentabelle sind generiert.
Der Service weist doppelte Provider, abweichende Anzahlen, fremde Typen und Key-Muster in Label/Quelle ab und
erklaert ein unlesbares CLI-Format als `ADAPTER_UNAVAILABLE` statt als leere Liste. Der Handler auditiert
`settings.hermes_access_read` mit Providernamen, nie mit Werten.

Nachweise: 4 Service-Tests (`hermes-access.test.ts`), 1 Routentest (401/403/200 ohne Key-Materialien) in
`hermes-config-routes.test.ts` (14 Tests gruen), `pnpm contracts:check`, `pnpm typecheck`, `pnpm lint` (0 Fehler),
Bridge-Parser-Test in WSL (4 Pruefungen).

Noch offen: UI im Adapterdetail (OpenAI/Anthropic als Hauptauswahl, "Erweitert", hinzufuegen/erneuern/trennen,
Abo vs. API-Key), Schreiboperationen (add/remove/reset/logout) mit sicherer Key-Uebergabe ueber stdin und
Rueckleseprobe, danach 07.04 bis 07.06.

## 9 Zwischenstand 2026-10-23 (Commit `0b17a1f`)

Die Zugangsliste ist jetzt auch sichtbar: `HermesAccessArea` steht oben im Hermes-Konfigurationsbereich und
zeigt je Anbieter die Anzahl, je Zugang Index, Label, Typ ("API-Key" oder "Abo-Anmeldung"), maskierte Quelle
(`env:NAME`, `gh_cli`, oauth-store) und den Aktivstatus. Ein Schluesselwert wird nie angezeigt.
Laden, Fehler (mit "Erneut lesen") und die leere Liste sind eigene, ehrliche Zustaende - keine erfundenen
Zeilen. Nachweise: 3 Komponententests, volle web-Suite 86/677, typecheck und lint 0 Fehler.

Noch offen: Hinzufuegen/Erneuern/Trennen (Vertrag + Bridge `auth add/remove/reset/logout` mit Key ueber
stdin) und die Trennung OpenAI/Anthropic vs. "Erweitert".


## Nachtrag 2026-10-31: Anbieter-Anmeldung per Device-Code (DASH-07.04, #165)

"Anbieter anmelden" unter KI-Zugaenge startet ueber die Bridge (`provider-oauth-start/status/cancel`) einen Worker in
der gepinnten Hermes-Laufzeit. Er ruft Hermes' eigenes `_start_device_code_flow` auf (nous, openai-codex, xai-oauth,
minimax-oauth), schreibt Code, https-Link und Ablaufzeit in den Vorgangszustand und wartet, bis Hermes die Sitzung
auf `approved` setzt; das geschieht erst, nachdem Hermes' Poller den Zugang gespeichert hat. Abbruch und Zeitablauf
beenden die Hermes-Sitzung wie Hermes' eigener Cancel; ein fehlgeschlagener Login aendert keinen bestehenden Zugang.
Vorgaenge sind an den Owner gebunden (`owner.json`, Vergleich per hmac), haben eine harte Frist von 960 s und werden
nach 24 h aufgeraeumt. Copilot, Anthropic und Qwen haben in Hermes keinen Device-Code-Starter und sind nicht
enthalten. Nachweise: `installer/wsl/test_hermes_provider_oauth.py` (9), Bridge-, Service-, Routen- und Seitentests,
Gegenproben rot, Import-Probe gegen die Hermes-Laufzeit mit Wegwerf-HERMES_HOME. Offen: echter Login (Owner).