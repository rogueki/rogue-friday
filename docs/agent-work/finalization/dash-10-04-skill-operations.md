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

## 8. Nachtrag 2026-10-23: Lesende Berichte als Text (inspect, audit, diff)

Die Faehigkeitsmatrix (Abschnitt 3) zeigt fuer `inspect`, `audit` und `diff` keine JSON-Ausgabe. Statt die
Tabellen zu erraten, werden die drei Berichte unveraendert als Text ausgeliefert:

| Operation | Pfad | CLI-Aufruf | Antwort |
|---|---|---|---|
| `getSkillInspection` | `GET /api/v1/skills/{name}/inspect` | `hermes skills inspect <name>` | Rohtext, max. 65536 Zeichen, `truncated` markiert Kuerzung |
| `getSkillAudit` | `GET /api/v1/skills/{name}/audit` | `hermes skills audit <name>` | dito |
| `getSkillDiff` | `GET /api/v1/skills/{name}/diff` | `hermes skills diff <name>` | dito, Unified Diff unveraendert |

Regeln, die der Parser durchsetzt (`parse_skill_report` in `installer/wsl/hermes_config_bridge.py`):

- Nur Text wird angenommen; `None`, Bytes oder Zahlen enden als `skill_report_format`.
- Ein leerer oder reiner Leerraum-Bericht endet als `skill_report_empty` (Exit 6) und wird im Dienst zu
  `ADAPTER_UNAVAILABLE` — nie zu einem leeren Erfolg.
- Groessere Berichte werden auf 65536 Zeichen gekuerzt und mit `truncated: true` sowie der vollen Bytezahl
  ausgeliefert; der Inhalt selbst wird nicht umgeschrieben.
- Ein Zeitlimit (60 s) endet als `skill_<action>_timeout` (Exit 7).

Nachweise:

| Nachweis | Ergebnis |
|---|---|
| `installer/wsl/tests/test_skill_report.py` (neu) | 9 Pruefungen: unveraenderter Text, Diff-Layout, Kuerzung samt Bytezahl, Leerberichte, Nicht-Text |
| `apps/control-api/test/skills-report-route.test.ts` (neu) | 4 Tests: 200-Form fuer alle drei Aktionen mit `responseValidation: "throw"`, 400 fuer ueberlange Namen ohne Handleraufruf, Namenspruefung vor dem CLI-Aufruf, Leerbericht als `ADAPTER_UNAVAILABLE`, kein erfundener Text |
| Vertragswaechter | 279 Operationen in `contract.test.ts`, `openapi-additions.test.ts`, `mock-data/test/api.test.ts` |
| Gates | `contracts:check`, `typecheck`, `lint`, `build` = 0 |

Bewusste Grenze: der Router prueft Pfadparameter nur auf Laenge, nicht auf das Vertragsmuster — ein Name wie
`-..` wird deshalb erst im Dienst abgelehnt (Ledger **N-052**).

### 8.1 Gemessenes Laufzeitverhalten (FRIDAY-2, Hermes v0.22.2, 2026-10-23)

| Befehl | Verhalten | Dauer | Konsequenz |
|---|---|---|---|
| `skills diff arxiv` | antwortet lokal: `'arxiv' matches the stock version.` | < 1 s | Zeitlimit 30 s |
| `skills inspect arxiv` | loest den Namen erst gegen die Registries auf; bei Namenskollision kommt eine Mehrdeutigkeitstabelle (6 Treffer, `Use the full identifier to install a specific one.`) | 37 s | Zeitlimit 90 s, Text wird unveraendert ausgeliefert |
| `skills audit arxiv` | lief nach 25 s noch nicht zurueck (Abbruch durch das Messzeitlimit) | > 25 s | Zeitlimit 90 s |

Live-Beleg fuer `diff` ueber die Bridge: `{"action":"diff","name":"arxiv","text":"'arxiv' matches the stock
version.","bytes":36,"truncated":false}`.

Daraus folgt eine **Grenze**, die im Vertrag noch fehlt: die API nimmt nur einen Namen entgegen, waehrend die CLI
bei Namenskollision eine vollstaendige Kennung verlangt. Der Text macht das ehrlich sichtbar (statt eines
erfundenen Berichts), die Bedienung bleibt aber offen — Ledger **N-053**.

### 8.2 Nachtrag 2026-10-23: nicht erreichbare Skill-Wurzel

`skills.external_dirs` kann auf ein Laufwerk zeigen, das gerade nicht da ist. `installed_skills` uebersprang solche
Pfade bisher stumm, das Inventar meldete trotzdem `skillsComplete: true` — die Skills waren einfach weg. Jetzt
meldet der Inventaraufruf `skill_root_missing`; die Begruendung steht in `inventory.reasons`, `skillsComplete` wird
false, und die gesunden Wurzeln liefern weiter. Die Validierungsaufrufe bleiben ueber `report_missing=False` beim
alten Verhalten, weil dort ein optionaler Pfad nichts bedeutet.

Belegt durch `installer/wsl/tests/test_skill_roots.py` (12 Pruefungen): fehlende Wurzel, optionale Wurzel ohne
Meldung, Datei statt Verzeichnis, unlesbares Verzeichnis und unlesbares Manifest.

## 8.2 Die restlichen Textbefehle: browse, check, tap list (2026-10-23)

`GET /api/v1/skills/reports?command=browse|check|tap-list` (281. Operation) gibt den CLI-Text unveraendert weiter
(65536 Zeichen Grenze, `bytes`, `truncated`), ohne ihn in Felder zu zerlegen. Jeder Befehl nimmt nur seine eigenen
Parameter; alles andere wird vor dem CLI-Aufruf abgelehnt:

| Befehl | Parameter | Ablehnung |
|---|---|---|
| `browse` | `page` (1..50), `size` (1..50), `source` (Token) | ohne page/size, mit `name`, fremde Werte |
| `check` | optional `name` | mit page/size/source |
| `tap-list` | keine | jeder Parameter |

Ablauf der Ablehnung: Schemafehler beantwortet der Query-Validator mit **400** (bestehendes Verhalten, Ledger N-052),
einen fuer den Befehl falschen Parameter der Handler mit **422** (belegt in `skills-command-route.test.ts`).

**Live gegen die echte CLI (FRIDAY-2, v0.22.2, Standardprofil):**

| Befehl | Antwort | Dauer |
|---|---|---|
| `tap-list` | `No custom taps configured. Using default sources only.` | ueber 30 s (alter Wert), danach 90 s Budget |
| `check` | `No hub-installed skills to check.` | unter dem Budget |
| `browse` (page 1, size 5, skills-sh) | `Skills Hub - Browse - skills-sh (200 skills loaded, 1 source(s) still loading, page 1/40)` | 65 s |

`browse` braucht 65 s fuer 200 Skills aus einer Quelle, weil die CLI die Registrierungen erst laedt. Der erste
`tap-list`-Lauf lief nach 30 s in `skill_command_timeout` (rc 7): der Befehl loest seine GitHub-Taps ueber
das Netzwerk auf. Das Budget der Bridge betraegt seitdem 90 s, das des Dienstes 95 s — ein Timeout wird gemeldet, nie
still verkuerzt.
