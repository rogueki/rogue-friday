# DASH-10.05 — Quelle, Voraussetzungen und lokale Änderungen vor einer Installation

Stand: 2026-10-23. Baut auf `dash-10-02-skill-inventory.md` (Katalog, Detail, Filter) und
`dash-10-04-skill-operations.md` (typisierte Operationen) auf.

## 1. Auftrag

> **DASH-10.05** Vor Installation Quelle, Voraussetzungen und Inspektions-/Auditbefund zeigen.
> Geführte Kontoeinrichtung je Skill erklärt jeden benötigten Zugang; bereits eingerichtete passende
> Referenzen wiederverwenden. Updates respektieren lokale Anpassungen und zeigen Diff/Konflikt.

## 2. Was jetzt sichtbar ist

Neue Fläche `SkillRegistryPanel` auf der Skillseite (`apps/web/src/features/skills/SkillRegistryPanel.tsx`),
nur für die Rolle `owner` und nur online:

| Anzeige | Quelle | Aussage |
|---|---|---|
| Treffer der Registry-Suche | `GET /api/v1/skills/hub/search` (DASH-10.04) | Name, Quelle, Trust-Stufe, Kennung und Beschreibung — genau die Felder, die die CLI als JSON liefert |
| „Keine Treffer" | dieselbe Antwort mit leerer Liste | ehrliche Leermeldung statt leerem Panel |
| Lokal geänderte Skills | `GET /api/v1/skills/modified` (DASH-10.04) | Namen der mitgelieferten Skills, die ein Update überspringt |
| Grund für die fehlende Schaltfläche | statischer Hinweis | „Installieren oder Aktualisieren ist hier bewusst nicht angeboten: beide Schritte brauchen den Bestätigungs- und Wiederherstellungsweg aus DASH-10.07." |

Die Suche läuft ausschließlich auf ausdrückliche Eingabe (`query.trim().length > 0`), mit `retry: false` und
`staleTime` 60 s — ein Registry-Ausfall erzeugt eine Fehlermeldung, keine erfundene Trefferliste.

## 3. Was bereits vorher da war (und weiter gilt)

- Das Detailpaneel nennt Herkunft, Trust, Kategorie, Paket, Hermes-Zustand, Beobachtungsquelle und den
  Ausführbarkeitshinweis; die Anleitung kommt als Text aus `SKILL.md` (DASH-10.02).
- Abschnitt „Konten und Einrichtung" listet je Integrationspunkt `setupDe`, Kontoart, Erforderlichkeit,
  Konfigurations- und Verbindungszustand sowie den Sprung in die Einstellungen (`integrationSetupLink`).
  Damit erklärt jeder Skill, welcher Zugang gebraucht wird; wiederverwendete Referenzen kommen aus dem
  Friday-Katalog (`integrationDetails`).

## 4. Nachweise

| Nachweis | Ergebnis |
|---|---|
| `SkillRegistryPanel.test.tsx` (neu) | 3 Tests: Treffer mit Quelle/Trust/Kennung und **ohne** Installationsknopf, Leermeldung, Warnung über lokal geänderte Skills plus Leerzustand |
| `SkillsPage.test.tsx` | 4 Tests unverändert grün (Panel in der Seite gemountet) |
| web-Suite | 88 Dateien / 685 Tests grün |
| `pnpm typecheck`, `pnpm lint` | 0 Fehler (3 bestehende Warnungen) |
| `styles` | `.sk-registry*` in `skills.css` ergänzt (Panel-Rahmen, Formular, Trefferliste) |

## 5. Offen (deshalb TEIL)

- **Voraussetzungen und Auditbefund je Treffer**: `hermes skills inspect` und `hermes skills audit` liefern
  keine JSON-Ausgabe (DASH-10.04-Matrix). Eine strukturierte Anzeige wäre geraten; bis eine
  maschinenlesbare Form existiert, bleibt hier nur Rohtext oder ein ehrlicher Verzicht.
- **Diff/Konflikt vor einem Update**: `hermes skills diff <name>` gibt einen Unified Diff auf stdout aus.
  Die Anzeige als Text ist möglich, der Vergleich „lokal vs. mitgeliefert" aber noch nicht umgesetzt.
- **Installation/Aktualisierung** selbst fehlt (DASH-10.07).
- **Wiederverwendung bereits eingerichteter Referenzen** beim Anlegen eines neuen Kontos ist im
  Friday-Katalog vorbereitet (`integrationDetails`), aber nicht als geführter Schritt belegt.

## 6. Nachtrag 2026-10-23 (Befund aus DASH-10.06)

Die Liste `GET /api/v1/skills/modified` stammt aus `hermes skills list-modified` und fuehrt **nur mitgelieferte**
Skills. Im Abnahmelauf (DASH-10.06) erkannte `skills update` eine lokale Aenderung an einem **Hub**-Skill korrekt
und uebersprang sie, `list-modified --json` blieb aber `[]`. Die Flaeche sagt das jetzt ausdruecklich: lokale
Aenderungen an Hub-Skills erscheinen dort nicht, werden beim Update aber ebenso erkannt (Ledger **N-055**).
