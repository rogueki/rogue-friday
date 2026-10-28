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

## 7. Diff-Ansicht je lokal geaendertem Skill (2026-10-23)

Jeder in `GET /api/v1/skills/modified` genannte Skill bekommt einen Schalter **Diff anzeigen**. Er ruft
`GET /api/v1/skills/{name}/diff` ab und zeigt den Unified Diff unveraendert in einem `<pre>` (monospace, scrollbar,
per Tastatur fokussierbar), dazu Groesse in Byte und den Hinweis „gekuerzt", wenn die 65536-Grenze greift. Erneutes
Druecken schliesst die Ansicht wieder; `aria-expanded` und die Beschriftung folgen dem Zustand.

**Der lehrreiche Teil ist der Fehlerfall.** `hermes skills diff` funktioniert nur fuer *mitgelieferte* Skills. Bei
allem anderen antwortet die CLI mit einer genauen Begruendung — und die wurde vorher verschluckt: die API meldete
generisch `503 ADAPTER_UNAVAILABLE` (**N-054**). Jetzt reicht die Bridge den CLI-Text als `detail` durch, der Service
antwortet **409 CONFLICT** mit dieser Begruendung im Fehlertext (und `{action, name, cliDetail}` in den Details), und
die Oberflaeche zeigt sie im Warnhinweis. Ein kaputter Adapter bleibt weiterhin `503`; die Grenze ist getestet
(`skills-report-reason.test.ts`).

**Belegt durch:** `SkillRegistryPanel.test.tsx` (5 Tests: Diff oeffnen/schliessen mit Inhalt und Byte-Zahl, Fehlerfall
mit CLI-Begruendung, Registry-Treffer ohne Installationsknopf), `skills-report-reason.test.ts` (2 Tests: 409 mit Grund,
503 bei kaputtem Adapter), `test_skill_report.py` (13 Pruefungen, davon 3 fuer den durchgereichten Grund), OpenAPI mit
`409` fuer `inspect`, `audit` und `diff`.

**Weiterhin offen fuer DASH-10.05:** Voraussetzungen und Auditbefund *je Registry-Treffer* (die CLI liefert dafuer
kein JSON, siehe Abschnitt 5) und der gefuehrte Wiederverwendungsschritt fuer bereits eingerichtete Referenzen.

## 8. Voraussetzungen und Auditbefund je Treffer (2026-10-23)

Jeder Registry-Treffer hat jetzt zwei Schalter: **Quelle ansehen** (`inspect`) und **Prüfung ansehen** (`audit`). Beide
zeigen den CLI-Text unveraendert in einem fokussierbaren `<pre>`; ein Abbruch der CLI erscheint im Warnhinweis mit
ihrem eigenen Grund. Eine aus Tabellen geratene Struktur gibt es bewusst nicht — die CLI liefert fuer beide Befehle
kein JSON (Abschnitt 5), und geratene Felder waeren schlimmer als ehrlicher Text.

**Der Blocker aus Abschnitt 5 ist damit geloest, aber anders als zunaechst angenommen.** Die API nahm fuer
`inspect`/`audit` nur einen Namen entgegen, waehrend ein Treffer eine Kennung wie
`official/devops/hermes-s6-container-supervision` nennt (**N-053**). Der Parameter der drei Berichtsoperationen
akzeptiert jetzt beides — Name **oder** Kennung mit bis zu drei Segmenten — und die Oberflaeche schickt die Kennung
des Treffers, weil sie eindeutig ist.

**Live am echten CLI geprueft (FRIDAY-2, Hermes v0.22.2), und dabei fiel eine falsche Annahme auf:**

| Aufruf | Antwort |
|---|---|
| `inspect official/devops/hermes-s6-container-supervision` | rc 0, Bericht mit `Source: official`, `Trust: official` |
| `inspect hermes-s6-container-supervision` | rc 0, zusaetzlich `Resolved to: official/devops/hermes-s6-container-supervision` |

Der blosse Name funktioniert also, solange er eindeutig ist — die CLI loest ihn auf und **sagt, worauf**. Die
Mehrdeutigkeit tritt erst bei Namenskollision auf. Die Kennung bleibt trotzdem die richtige Wahl in der Oberflaeche,
weil sie die Aufloesung ueberhaupt nicht braucht; der frueher behauptete harte Blockierer war keiner.

**Belegt durch:** `SkillRegistryPanel.test.tsx` (7 Tests, davon 2 fuer Quellen-/Pruefbefund mit Kennung und fuer den
Fehlerfall), `skills-report-reason.test.ts` (3 Tests, u. a. Kennung akzeptiert, `a/b/c/d`, `/leading`, `with space/name`
und `../etc` abgelehnt), `test_skill_report.py` (13 Pruefungen, davon 9 fuer die Kennungsform). Offen bleibt allein der
gefuehrte Wiederverwendungsschritt fuer bereits eingerichtete Referenzen.
