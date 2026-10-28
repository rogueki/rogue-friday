# DASH-10.03 — Der echte per-Skill-Schalter

Stand: 2026-10-23. Quellanalyse am Hermes-Checkout `v0.22.2` in WSL-Distro
`FRIDAY-2` (`/home/ubuntu/.hermes/hermes-agent`) und kontrollierte Readbackprobe
am Windows-Hermes (`C:\Users\ByteNinja\AppData\Local\hermes`, v0.20.5).

## 1. Auftrag

> **DASH-10.03** Vor Aktivierung den tatsächlichen per-Skill-Enablemechanismus durch
> CLI-/Quellcodeanalyse und kontrollierte Readbackprobe klären. `opt-in/opt-out` nicht
> ungeprüft als per-Skill-Schalter verwenden; keine Dateiumbenennung/DB-Manipulation
> auf Verdacht.

## 2. Befund aus dem Quellcode

| Stelle | Aussage |
|---|---|
| `hermes_cli/skills_config.py` | `get_disabled_skills(config)` / `save_disabled_skills(config, disabled)` verwalten die Menge der deaktivierten Namen; `None` gilt als leer, ein Skalar als einelementige Liste (Kommentar zu #13026). Gespeichert wird unter `skills.disabled`. |
| `hermes_cli/web_routers/skills.py:346-378` (`GET /api/skills`) | liest `disabled = get_disabled_skills(config)`, setzt je Skill `enabled = name not in disabled` und liefert zusätzlich `provenance` mit der Rangfolge **hub > bundled > external > agent**. |
| `hermes_cli/web_routers/skills.py:380-395` (`PUT /api/skills/toggle`) | nimmt `{name, enabled}`; `enabled` entfernt den Namen aus der Menge, sonst fügt es ihn hinzu, danach `save_disabled_skills` innerhalb eines `config_write_scope`. |
| `agent/skill_utils.py:446` | `skills.disabled` trifft einen Katalogeintrag über den deklarierten Namen **oder** den `load_name`. |
| `hermes skills config --help` | kennt **nur** `-h`; die Umschaltung ist eine interaktive TUI. Es gibt keinen scriptbaren `enable/disable`-Unterbefehl. |
| `hermes skills opt-out/opt-in --help` | steuern das Seeding der mitgelieferten Skills für ein Profil, nicht den Zustand eines einzelnen Skills. |

Damit ist der per-Skill-Schalter eindeutig **`skills.disabled`**, geschrieben über
`save_disabled_skills` (API) — nicht über Dateiumbenennung, nicht über eine Datenbank
und nicht über `opt-in/opt-out`.

## 3. Live-Zustand (rein lesend)

- Default-Profil: `hermes config get skills.disabled --json` → `Config key not set`.
- `hermes skills list` → 191 Skills; `--enabled-only` → 191. Kein Skill ist deaktiviert.
- `hermes config get skills --json` zeigt u. a.
  `external_dirs: ["C:/Users/ByteNinja/Downloads/JARVIS_Installer/Skills/skills"]`,
  `project_discovery: true`, `trusted_project_dirs: []`.
  Fremdverzeichnisse sind also real eingebunden; die CLI-Tabelle führt sie als `local`.

## 4. Kontrollierte Readbackprobe

In einem **wegwerfbaren Profil** (`hermes profile create friday-probe`, danach gelöscht),
damit die Konfiguration des Operators unberührt bleibt:

| Schritt | Ergebnis |
|---|---|
| Ausgangslage `hermes -p friday-probe skills list --enabled-only` | **72** aktivierte Bundled-Skills |
| `hermes -p friday-probe config set skills.disabled '["arxiv"]'` | gespeichert; CLI warnt „nicht erkannter Konfigurationsschlüssel", der Wert wird dennoch geschrieben |
| Readback `config get skills.disabled --json` | `["arxiv"]` |
| Readback `skills list --enabled-only` | **71** |
| Readback `skills list` (Zeile) | `arxiv │ research │ builtin │ builtin │ disabled` |
| Rücknahme `config set skills.disabled '[]'` | Readback `[]`, `--enabled-only` wieder **72** |
| Profil löschen, Wrapper `friday-probe.bat` entfernen | Profilverzeichnis und Wrapper weg |
| Kontrolle Default-Profil | `skills.disabled` weiterhin nicht gesetzt, `--enabled-only` **191** |

Die Warnung „nicht erkannter Konfigurationsschlüssel" ist der Grund, warum Friday den
Zustand **nicht** per `hermes config set` schreiben darf: Der Schreiber kennt den
Schlüssel nicht, der Loader liest ihn trotzdem. Der dokumentierte Schreibweg ist die
API (`PUT /api/skills/toggle`), die genau `save_disabled_skills` aufruft.

## 5. Wie Friday den Schalter benutzt

`apps/control-api/src/services/skills.ts` (`toggle`):

1. prüft die Kennung `^(friday|hermes):[a-z0-9][a-z0-9_-]*$`;
2. liest den aktuellen Katalog (`list()`), findet den Skill und verweigert bei
   `discovered !== true` oder `enabled === null` mit „Skill ist in Hermes nicht bestätigt";
3. sendet `PUT /api/skills/toggle` mit **genau** `{name, enabled}`;
4. liest erneut und vergleicht: weicht `enabled` oder `discovered` ab, antwortet Friday
   mit „Hermes hat den neuen Skillzustand nicht bestätigt" — kein Erfolg ohne Readback.

Neuer Nachweis für Schritt 4: `skills-onboarding.test.ts` „rejects an activation the
dashboard does not read back" (Toggle antwortet `{ok:true}`, Zustand bleibt `false` →
Fehler). Der bestehende Test „guards owner catalog and mutations" belegt bereits den
genauen Endpunkt und Körper sowie genau einen Aufruf.

## 6. Ergebnis

- Der Mechanismus ist geklärt und **mit Quellzeilen plus echter Readbackprobe** belegt;
  `opt-in/opt-out` sind ausdrücklich **nicht** als per-Skill-Schalter verwendet.
- Friday schreibt ausschließlich über die dokumentierte API und verifiziert jede
  Änderung durch einen zweiten Lesevorgang.
- **DASH-10.03 ist damit abgenommen.** Die Bedienung über die Oberfläche im
  Gesamtablauf prüft DASH-10.06.

## 7. Nebenfund für DASH-10.04/10.06

`GET /api/skills` liefert bereits `provenance` mit **hub / bundled / external / agent**.
Das ist genau die Trennung „Builtin / external / Hub", die DASH-10.02 verlangt, und
präziser als die CLI-Spalte `Source` (dort erscheint `external` als `local`). Für die
nächste Stufe sollte `origin` aus `provenance` gespeist werden (`hub→hub`,
`bundled→builtin`, `external→external`, `agent→local`), was eine Erweiterung des
`origin`-Enums um `external` bedeutet. Die CLI bleibt dann für `trust` zuständig.