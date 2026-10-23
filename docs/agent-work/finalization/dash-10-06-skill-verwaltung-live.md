# DASH-10.06 — Skills am laufenden System ansehen und verwalten

Status: **TEIL** (Live-Nachweise für Inventar, Berichte und Fehlertexte; Hub-Skill, Neustart-Gleichheit und
Operator-System stehen aus).

## 1. Aufbau des Nachweises

Der Nachweis läuft gegen eine echte Control API (`apps/control-api/dist/main.js`) mit `FRIDAY_CONFIG_DIR` auf einem
eigenen Datenwurzelverzeichnis, `dataMode: live` in `dashboard.yaml` und `auth.mode: local` samt
`ownerPasswordHash: file:…` (Ersteinrichtung nur auf Loopback). Das Wurzelverzeichnis enthält
`config/install-state.json` (`distro_name: FRIDAY-2`, `linux_user: ubuntu`) und eine Kopie von `installer/wsl/*.py`,
damit `target()` die Brücke unter `/mnt/c/...` findet.

Wiederverwendbares Skript: `scripts/finalization/live-skills-proof.mjs` (bewusst nicht Teil der Testsuite — es braucht
einen laufenden Server, eine echte WSL-Distribution und Netzzugang zu den Registries).

## 2. Beobachtete Laufzeit (2026-10-23, API auf `127.0.0.1:3111`)

| Aufruf | Ergebnis |
| --- | --- |
| `POST /api/v1/auth/login` (Ersteinrichtung) | 200, Rolle `owner` |
| `GET /api/v1/skills` | 200 in 67,3 s · **159 Skills**, `byOrigin {builtin: 53, external: 106}`, `observationSource: hermes-cli` |
| `GET /api/v1/skills/modified` | 200 in 2,6 s · `[]` (keine lokal geänderten Skills) |
| `GET /api/v1/skills/arxiv/diff` | 200 in 1,7 s · `'arxiv' matches the stock version.` |
| `GET /api/v1/skills/definitely-not-a-skill/diff` | 200 in 1,7 s · CLI-Text `Error: … is not a tracked bundled skill …` bleibt erhalten |
| `GET /api/v1/skills/<identifier>/inspect` (URL-kodiert) | 200 in 2,3 s · Tabelle mit `Name: hermes-s6-container-supervision` |
| `GET /api/v1/skills/arxiv/inspect` (blosser Name) | 200 in 110,6 s · Auflösung gegen die Registries |
| `GET /api/v1/skills/reports?command=tap-list` | 200 in 1,8 s · `No custom taps configured. Using default sources only.` |
| `GET /api/v1/skills/reports?command=config` | 400 · `fieldErrors: command must be equal to one of the allowed values` |
| `GET /api/v1/skills` ohne Sitzung | 401 |

Damit ist belegt: das Inventar der installierten CLI ist über die API sichtbar (Builtin **und** Friday-Skill), die
Berichts-Endpunkte liefern echten CLI-Text, Ablehnungen behalten ihren Grund, und eine nicht angebotene Operation wird
als Schemafehler abgewiesen statt still zu wirken.

## 3. Dabei gefundene echte Defekte (nur im Laufzeitbetrieb sichtbar)

1. **N-064 — Origin-Vokabular.** v0.22.2 meldet für dieselben Skills `origin: external`, der TypeScript-Dienst kannte
   nur `builtin|local|hub` und verwarf bei einem unbekannten Wert das **ganze** Inventar. Ergebnis: 159 Skills im CLI,
   `data: []` in der API. Jetzt wird ein begrenztes Token geprüft (wie in der Brücke seit N-057), Typ und Vertrag stimmen
   überein; Regressionstest `skills-inventory-route.test.ts` („keeps the inventory when the CLI reports an origin token
   this code has never seen").
2. **N-065 — Runner-Limit 35 s.** `invokeCodingRunner` wies Zeitlimits über 35 s zurück. Die Skill-Berichte (95–195 s)
   konnten deshalb **nie** laufen; die API antwortete in 5 ms mit 503 „nicht erreichbar", ohne dass die CLI je startete.
   Grenze jetzt 300 s, `runner_timeout` wird als Zeitlimit gemeldet statt als „unerwartetes Format".
3. **N-066 — Inventar-Budget 30 s.** Ein kaltes Profil braucht für `hermes skills list` 44–54 s. Das API-Budget steht
   jetzt bei 120 s, also über dem CLI-Budget.
4. **N-067 — CLI-Budget in der Brücke.** Die Brücke selbst brach `skills list`/`list-modified` nach 30 s ab
   (`Command … timed out after 30 seconds`) und meldete das als `hermes_unavailable`. Budget jetzt 90 s
   (`SKILL_LIST_TIMEOUT`, per `FRIDAY_SKILLS_LIST_TIMEOUT` übersteuerbar), damit 159 Skills zuverlässig gelesen werden.
5. **N-068 — BOM auf stdin.** `json.load(sys.stdin)` scheiterte an einem UTF-8-BOM (`Unexpected UTF-8 BOM`), also an
   einer Formalie des Aufrufers statt an der CLI. Alle 13 stdin-Lesestellen nutzen jetzt `read_request()` mit
   `utf-8-sig`; ein leerer oder kaputter Request ergibt sauber `invalid_request`.
6. **N-069 — Fehlertexte ohne Grund.** `unavailable()` behauptete „Hermes-Konfiguration in Friday-Ubuntu ist nicht
   erreichbar", auch wenn die Brücke an einem fehlenden Import, einem BOM oder einem Zeitlimit scheiterte. Der Text
   nennt jetzt den beobachteten Zustand, `skillInventory`/`skillReport` reichen den Grund als `details.detail` weiter.
   Die Brücke selbst hängt bei nicht-kanonischen Fehlern ein `detail` an (Test `test_bridge_error_detail.py`).
7. **N-070 — Zwei Budgets ohne Ordnung.** API-Limit (160 s) lag unter Brücken-Limit (150 s) plus WSL-Start (~14 s),
   deshalb kam statt „Zeitlimit überschritten" wieder der generische Text. Jetzt Brücke 150 s (inspect/audit) bzw. 60 s
   (diff), API 180 s bzw. 90 s.

## 4. Offene Punkte für die Abnahme (deshalb TEIL)

- **Kein Hub-Skill installiert.** Das Inventar enthält ausschließlich `builtin` (53) und `external` (106); die
  Anforderung „ein kontrollierter Hub-Skill lässt sich ansehen und verwalten" ist damit auf diesem Profil nicht prüfbar.
- **Neustart-Gleichheit** ist noch nicht erhoben: nach einem Neustart der API muss derselbe Zustand (159 Skills,
  gleiche Aktivierung) gelesen werden.
- **Operator-System:** `C:\Friday\config\install-state.json` auf diesem Host enthält kein `distro_name`/`linux_user`,
  `C:\Friday\dashboard` existiert nicht, und `FRIDAY_SKILLS_CATALOG_PATH` ist nicht gesetzt. Ohne Katalogpfad meldet
  die API ehrlich `catalogError: Skills-Katalogpfad nicht konfiguriert` und `hermesError: Hermes-Dashboard nicht
  konfiguriert` — die gepackte Katalogseite (Freigaben, Integrationsmetadaten) ist hier also nicht belegt.
- **Fehlendes Laufwerk / modifizierter Builtin:** die Brücke verweigert Schreibzugriffe ohne erreichbare Installation
  (getestet in `test_skill_roots.py`), der Live-Nachweis für „wird nicht still überschrieben" am Operator-System fehlt.

## 5. Reproduktion

```powershell
# Datenwurzel mit install-state.json und Brückenkopie, danach:
$env:FRIDAY_CONFIG_DIR = "$env:TEMP\friday-live-root\config"
node apps/control-api/dist/main.js            # bindet 127.0.0.1:3111 laut dashboard.yaml
node scripts/finalization/live-skills-proof.mjs
```

Ein blosser Skill-Name löst gegen die Registries auf (hier 110 s); die Kennung `official/devops/<name>` antwortet in
rund 2 s und wird von der Oberfläche verwendet.