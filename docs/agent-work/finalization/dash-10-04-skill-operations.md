# DASH-10.04 — Typisierte Skill-Operationen je CLI-Version

Stand: 2026-10-23. Grundlage: `hermes skills <cmd> --help` der beiden real
installierten Stände — Windows-CLI **v0.20.5** (`C:\Users\ByteNinja\AppData\Local\hermes`)
und WSL-Checkout **v0.22.2** (`FRIDAY-2`, `/home/ubuntu/.hermes/hermes-agent`).

## 1. Auftrag

> **DASH-10.04** Unterstützte `inspect/search/browse/install/update/check/audit/uninstall/trust/untrust/reset/list-modified/diff/tap/config`
> über typisierte, erlaubte Operationen abbilden; CLI-Möglichkeiten pro Version bestätigen.
> Nicht ungeprüft Rich-Tabellen parsen. Externe Laufwerke/Verzeichnisse mit klarer
> Nichterreichbarkeit behandeln.

## 2. Fähigkeitsmatrix (beide Versionen identisch geprüft)

| Operation | Maschinenlesbar | Beleg | Weg in Friday |
|---|---|---|---|
| `search` | **ja**, `--json` | `--json  Output JSON instead of a table (full identifiers…` | `GET /api/v1/skills/hub/search` |
| `list-modified` | **ja**, `--json` | `--json  Output the list as JSON` | `GET /api/v1/skills/modified` |
| `inspect` | nein | `usage: hermes skills inspect [-h] identifier` | nur als Text, kein Feld-Parsing |
| `browse` | nein | `--page/--size/--source`, keine `--json`-Option | nur als Text |
| `install` | nein | `--category/--name/--force/--yes` | Mutation, eigener Bestätigungsweg |
| `update` | nein | `[--force] [name]` | Mutation |
| `check` | nein | `[name]` | nur als Text |
| `audit` | nein | `[--deep] [name]` | nur als Text |
| `uninstall` | nein | `[--yes] name` | Mutation |
| `trust` / `untrust` | nein | `[path]` | Mutation (Projektvertrauen) |
| `reset` | nein | `[--restore] [--yes] name` | Mutation |
| `diff` | nein | `name` (Unified Diff auf stdout) | nur als Text |
| `tap list/add/remove` | nein | Unterbefehle ohne `--json` | Mutation bei add/remove |
| `config` | TUI | `hermes skills config --help` zeigt nur `-h` | bereits über DASH-10.03 belegt: API statt TUI |

Damit gilt: **Rich-Tabellen werden nirgends geparst.** Wo die CLI kein JSON liefert, gibt es
keine Feld-Extraktion; Textausgaben bleiben Text.

## 3. Was in dieser Stufe umgesetzt ist

| Ebene | Änderung |
|---|---|
| Vertrag | `SkillHubSearch`/`SkillHubSearchResponse` und `ModifiedSkills`/`ModifiedSkillsResponse`; zwei neue GET-Operationen `searchSkillHub` und `listModifiedSkills` (jetzt **276** Operationen), beide `meta.read` + `owner`. |
| Bridge | Aktionen `hub-search` (stdin `{query, source, limit}`, `--json --limit`, optional `--source`, Timeout 60 s) und `modified-list` (`list-modified --json`, Timeout 30 s). |
| Parser | `parse_hub_search` (Liste ≤ 50, Pflichtfelder `name/identifier/source/trust_level/description`, zusätzliche Felder neuerer Versionen werden ignoriert, keine Erfindung), `parse_modified_skills` (Liste von Namen ≤ 500, Duplikate abgelehnt). Jede andere Form → `hub_search_format` / `modified_skills_format`. |
| Service | `HermesConfigService.hubSearch` (Trim 1–120 Zeichen, Quellenmuster `^[a-z0-9][a-z0-9.-]{0,39}$`, Limit 1–50, Zeitüberschreitung und Formatfehler → `ADAPTER_UNAVAILABLE`) und `modifiedSkills` (Namensmuster, Formatfehler → `ADAPTER_UNAVAILABLE`). |
| Handler | `searchSkillHub`/`listModifiedSkills` mit Audit `skills.hub_searched` bzw. `skills.modified_listed` (nur Anzahl, kein Inhalt). |

Nicht in dieser Stufe: `inspect`, `browse`, `check`, `audit`, `diff`, `tap list` (kein JSON → nur
Textdarstellung, siehe 10.05/10.06) und alle Mutationen (`install`, `update`, `uninstall`,
`reset`, `trust`, `untrust`, `tap add/remove`).

## 4. Nachweise

| Nachweis | Ergebnis |
|---|---|
| `python3 tests/test_hub_search.py` (WSL `Friday-Ubuntu`) | 9 Prüfungen: gültige Suche, leere Trefferliste, zusätzliches Feld einer neueren CLI, 7 Fehlformen, gültige/ungültige Modified-Liste |
| `python3 tests/test_skills_list.py` | 9 Prüfungen (unverändert grün) |
| `apps/control-api/test/skills-hub-route.test.ts` | 3 Tests: Schema-validierte Antworten (`responseValidation: "throw"`), `limit=99` und fehlendes `query` → 400 ohne Handler-Aufruf, leeres `query`/unbekannte Quelle/Limit 51 → 422 ohne Bridge-Aufruf |
| `contracts:check` | 276 Operationen generiert, `check-generated` und `breaking` grün |
| Guards | `contract.test.ts` (276), `openapi-additions.test.ts` (276), `mock-data/test/api.test.ts` (live-only-Liste) nachgezogen |

## 5. Offene Punkte

- **Live-Probe der Suche** braucht Netzzugang zu den Registries; im Test nur synthetisch belegt.
  `hermes skills search hermes --json --limit 2` lieferte auf diesem Host echte Treffer
  (`official/devops/hermes-s6-container-supervision`, `skills-sh/nousresearch/hermes-agent/hermes-agent`),
  die Feldnamen der Implementierung entsprechen also dem echten Format.
- `hermes skills list-modified --json` meldet auf diesem Host `[]` — es gibt keine lokal
  veränderten Bundled-Skills; ein nicht-leerer Fall ist ohne Eingriff in den Installationsstand
  nicht reproduzierbar.
- Textbasierte Operationen (`inspect`, `diff`, `check`, `audit`, `browse`) gehören in die
  Oberfläche als unveränderter Text mit klarer Herkunftsangabe (10.05/10.06).
- Mutationen brauchen je Operation einen Bestätigungs- und Readbackweg; das ist 10.07.
- Externe Verzeichnisse: `skills.external_dirs` zeigt auf
  `C:/Users/ByteNinja/Downloads/JARVIS_Installer/Skills/skills`; ein nicht erreichbarer Pfad
  muss als „nicht verfügbar" erscheinen, nicht als leerer Katalog — offener Punkt für 10.06.