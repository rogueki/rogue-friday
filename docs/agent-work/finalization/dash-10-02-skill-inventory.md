# DASH-10.02 — Skill-Inventar mit Herkunft, Trust und Detailansicht

Stand: 2026-10-23. Belegt am laufenden Windows-Hermes
(`C:\Users\ByteNinja\AppData\Local\hermes\bin\hermes.exe`, v0.20.5) und an der
Friday-Codebasis auf Branch `feat/friday-finalization-20261021`.

## 1. Auftrag

> **DASH-10.02** Builtin/external/Hub dynamisch inventarisieren, Quellen/Version/Trust/Kategorie/Status
> und Metadaten getrennt anzeigen. Detail lädt Markdown erst bei Auswahl, HTML sanitisen.
> Such-/Quellen-/Kategorie-/Statusfilter, Pagination bzw. geeignete Virtualisierung.

## 2. Reales Inventar (rein lesend)

`hermes skills list --source all` mit `COLUMNS=400` (ohne breite Spalte kürzt die
Tabelle Namen mit `…` und wäre nicht zuordenbar):

| Kennzahl | Wert |
|---|---|
| Zeilen | **191** Skills |
| Quelle `local` | 119 |
| Quelle `builtin` | 72 |
| Quelle `hub` | **0** (keine Hub-Installation auf diesem Host) |
| Status | 191 × `enabled`, keine deaktivierten Einträge |
| Trust-Werte | `local` (119), `builtin` (72) |
| Kategorie | erste Spalte teils leer (z. B. `bailian-*`), sonst z. B. `autonomous-ai-agents`, `calendar`, `communication` |

Die Tabelle hat genau fünf Datenspalten in fester Reihenfolge
(`Name │ Category │ Source │ Trust │ Status`). Genau dieses Layout wird geparst;
jede andere Form wird abgelehnt statt geraten.

## 3. Umsetzung

### Bridge (`installer/wsl/hermes_config_bridge.py`)

Neue Aktion `skills-list` ruft `hermes skills list --source all` mit
`COLUMNS=400` auf und parst über `parse_skills_list`:

- akzeptiert nur Zeilen, die mit `│` beginnen und in genau sieben Segmente
  (`│ name │ category │ source │ trust │ status │`) zerfallen;
- verlangt die Kopfzeile exakt einmal und **vor** allen Datenzeilen;
- erlaubt nur `source ∈ {builtin, local, hub}`, `trust ∈ {builtin, local, project}`,
  `status ∈ {enabled, disabled}`; alles andere ist `skills_list_format`;
- lehnt doppelte Namen, Namen außerhalb `^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$` und
  Kategorien über 64 Zeichen ab; eine leere Kategorie bleibt leer (nichts wird erfunden);
- Rückgabe `{"count": n, "skills": [{name, category, origin, trust, state}]}`.

### Vertrag

`packages/contracts/schemas/skills/skill.schema.json` (und damit
`SkillCatalogEntry` in `friday-api.yaml`) hat zwei neue Pflichtfelder:

- `origin`: `friday | builtin | local | hub | unknown`
- `trust`: `builtin | local | project | unknown`

`pnpm contracts:generate` erneuerte SDK/Schemas; die Routentabelle bleibt bei
**274** Operationen (keine neue Operation, nur ein erweitertes Modell). Das
Beispiel `packages/contracts/examples/skills/catalog-response.json` führt die
Felder mit.

### Service (`apps/control-api/src/services/skills.ts`)

- Herkunft und Trust stammen ausschließlich aus der CLI-Antwort; Friday rät sie nie
  aus Pfaden. Friday-Paket-Skills tragen `origin: "friday"`, `trust: "unknown"`, weil
  Hermes-Trust für sie kein sinnvoller Begriff ist.
- Der Aktivstatus kommt weiter aus der Dashboard-Beobachtung. Nur wenn das Dashboard
  keinen booleschen Wert liefert, gilt der CLI-Status, und `observationSource`
  wechselt auf `hermes-cli`.
- Skills, die nur die CLI kennt, erscheinen mit ihrer CLI-Kategorie, `discovered: true`,
  `observationSource: "hermes-cli"` und `observedAt` des Inventarlaufs.
- Ein unlesbares Inventar (Formatfehler, Bridge weg) lässt den Katalog unangetastet:
  `origin`/`trust` bleiben `unknown`, statt den Katalog zu verstecken.

`HermesConfigService.skillInventory()` prüft die Bridge-Antwort (Anzahl = Länge,
≤ 2000 Einträge, Namens-/Enum-Grenzen, keine Duplikate) und übersetzt
`skills_list_format` in `ADAPTER_UNAVAILABLE` mit erklärendem Text.

### UI (`apps/web/src/features/skills/*`)

- Detailansicht trennt **Herkunft**, **Trust**, **Kategorie**, **Paket**, **Hermes-Status**,
  **Beobachtet**, **Quelle** und **Ausführbar** in eigenen Zeilen.
  `originLabel`/`trustLabel` liefern deutsche Bezeichnungen (Friday-Paket,
  Hermes mitgeliefert, Lokal installiert, Hub-Installation, Projektfreigabe, Unbekannt).
- Die Liste zeigt pro Eintrag `Kategorie · Quelle · Herkunft`.
- Filter: Suche, Quelle (Friday/Hermes), Herkunft (friday/builtin/local/hub/unknown),
  Kategorie, Status. Alle Filter greifen gemeinsam.
- Die Liste rendert 60 Zeilen und bietet „Weitere N Skills anzeigen“; die Detailauswahl
  bleibt unabhängig davon erreichbar.
- Die Anleitung lädt erst bei Auswahl (`useSkillMarkdown`, `enabled: id !== null`) und
  wird als `<pre>`-Text gerendert; es gibt keinen HTML-Pfad, also auch nichts zu
  sanitisieren.

## 4. Nachweise (ausgeführt am 2026-10-23)

| Nachweis | Ergebnis |
|---|---|
| `python3 tests/test_skills_list.py` (WSL `Friday-Ubuntu`) | 9 Prüfungen bestanden (Fixture mit builtin/local/hub/disabled, leere Kategorie, 6 Fehlformen abgelehnt) |
| `python3 tests/test_skill_markdown.py` | 6 Prüfungen bestanden |
| `apps/control-api/test/skills-onboarding.test.ts` | 20 Tests, davon 3 neue (Herkunft/Trust, CLI-Fallback, unlesbares Inventar) |
| `apps/control-api/test/skills-inventory-route.test.ts` | 1 Test mit `responseValidation: "throw"` (Antwort entspricht dem erweiterten Schema) |
| `apps/web/src/features/skills/skillPresentation.test.ts` | 7 Tests, davon 1 neu (Labels + Herkunftsfilter) |
| `apps/web/src/features/skills/SkillsPage.test.tsx` | 4 Tests, davon 1 neu (Herkunft/Trust sichtbar, 60 → 65 Zeilen) |
| `apps/web/src/features/skills/SkillMarkdown.test.tsx` | 2 Tests |
| Gesamtsuite `vitest run` | 291 Dateien, 3681 passed, 60 skipped, 0 failed |
| `pnpm contracts:check`, `pnpm typecheck`, `pnpm lint`, `pnpm build` | 0 Fehler (Lint: 3 bestehende Warnungen) |

## 5. Offene Lücke (deshalb TEIL, nicht PASS)

- **Kein echter Hub-Skill**: Auf diesem Host ist keine Hub-Installation vorhanden
  (0 Zeilen mit Quelle `hub`). Der Hub-Zweig ist nur über Fixture und Vertrag belegt.
  Die Abnahme „ein kontrollierter Hub-Skill lässt sich ansehen und verwalten“ gehört
  zu **DASH-10.06** und braucht eine reale Installation.
- **Version je Hermes-Skill**: Die CLI-Tabelle führt keine Version. Versionen kommen
  weiterhin aus Katalog bzw. Dashboard; CLI-only-Skills zeigen bewusst `null`
  („Version unbekannt“) statt einer erfundenen Zahl.
- **`external` als eigene Quelle**: Die CLI listet Fremdverzeichnisse
  (`skills.external_dirs`) als `local`; eine eigene Quelle „external“ gibt es in der
  Ausgabe nicht und wird daher nicht erfunden.
- **Trust ändern** (`hermes skills trust/untrust`, `opt-in/opt-out`) ist Verwaltung und
  gehört zu DASH-10.03/10.04, nicht zur Inventaranzeige.
- Pagination ist clientseitig in 60er-Blöcken; bei 191 Zeilen genügt das, eine
  Virtualisierung ist nicht eingebaut.