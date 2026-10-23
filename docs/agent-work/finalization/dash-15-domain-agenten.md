# DASH-15 — Sieben Domain-Agenten als echte Profile

**Datum:** 2026-10-23 · **Status:** 15.05 PASS, 15.02 TEIL (Lücken benannt), 15.01/15.03/15.04 offen

## 1. Angelegt (echte Hermes-Konfiguration, kein Kartenmodell)

Im echten Profilspeicher der WSL-Distribution `FRIDAY-2` (`~/.hermes/profiles/`) existieren jetzt sieben Profile:

```
hermes profile list
 tasks          k3   Aufgabenzuschnitt und Fortschritt
 communication  k3   Mail/Messenger-Entwuerfe, Senden nur nach Freigabe
 calendar       k3   Termine lesen/anlegen, Konflikte melden
 automations    k3   Zeitplaene und Ausloeser, Laufpruefung
 research       k3   Quellen suchen, pruefen, zusammenfassen
 alerts         k3   Grenzwerte ueberwachen, nur melden
 audit          k3   Protokolle lesen, nichts veraendern
```

Angelegt mit `hermes profile create --no-skills --no-alias --description "<Rolle>" <name>` (bewusst ohne `--clone`,
damit keine `.env`-Geheimnisse in sieben Profile vervielfacht werden).

## 2. Definition je Profil (15.02, teilweise)

Jedes Profil hat eine echte `config.yaml` und eine `SOUL.md`:

| Feld | Umsetzung |
| --- | --- |
| Rolle | `SOUL.md` Kopf „Rolle" |
| Zulässige Domänen | `SOUL.md` Abschnitt „Erlaubte Domaenen" |
| Verbotene Aktionen | `SOUL.md` Abschnitt „Nicht erlaubt" (z. B. Audit darf nichts schreiben, Meldungen nichts reparieren) |
| Datenzugriff | `SOUL.md` Abschnitt „Datenzugriff" |
| Modellroute | `config.yaml` → `model.default: k3`, `model.provider: kimi-coding` (die eine real konfigurierte Route) |
| Budget/Timeout | `agent.max_turns`, `code_execution.timeout`, `code_execution.max_tool_calls`, `terminal.timeout` — je Domäne unterschiedlich (Meldungen 60 Turns/90 s, Recherche 200 Turns/300 s) |
| Arbeitsverzeichnis | Profilstandard `workspace/` (Hermes legt es je Profil an) |
| Eskalation | `SOUL.md` Abschnitt „Eskalation" (einmal knapp nachfragen, dann warten; nichts erfinden) |
| Ergebnisformat | `SOUL.md` Abschnitt „Ergebnisformat" (drei bis vier feste Zeilen) |
| Routing-Hinweis | `--description` im Hermes-Profil, das der Kanban-Zerleger laut `hermes profile create --help` nutzt |

Verifiziert mit `hermes profile show <name>`: Modell, Pfad, Gateway-Zustand und `SOUL.md: exists` werden von Hermes
selbst aus der echten Konfiguration gelesen.

**Noch offen in 15.02:** eine *domänenspezifische* Tool-/Skill-Allowlist je Profil (aktuell verweist
`skills.external_dirs` auf den gemeinsamen Friday-Skillordner, Hermes kennt keine reine Allowlist-Datei) und ein
explizit gesetztes Arbeitsverzeichnis statt des Profilstandards.

## 3. Recovery: ein kaputtes Profil reisst nicht die anderen mit (15.05, PASS)

Reversibler Test im echten Speicher (`alerts/config.yaml` absichtlich zerstört, danach aus der Sicherung
zurückgespielt):

```
Skipping broken secondary profile /home/ubuntu/.hermes/profiles/alerts during dependency
verification: could not parse plugin selection: .../alerts/config.yaml

 Profile          Model       Gateway
 ◆default         k3          stopped
  alerts          —           stopped      <- kein erfundenes Modell, kein Online-Status
  audit           k3          stopped
  automations     k3          stopped
  calendar        k3          stopped
  communication   k3          stopped
  research        k3          stopped
  tasks           k3          stopped
```

`hermes profile show alerts` zeigt danach keine Modellzeile (statt eines Platzhalters), der gesunde Nachbar
`calendar` bleibt vollständig; nach dem Zurückspielen ist `alerts` wieder `k3 (kimi-coding)`. Ein ungültiges Profil
deaktiviert also nur sich selbst, und es entsteht keine Ersatzkarte mit erfundenem Status.

## 4. Was für 15.03/15.04 noch fehlt

- Die Profile sind **definiert**, aber noch nicht als laufende Worker gegen eine Aufgabe belegt: dafür muss der
  Hermes-API-Server (Port 43693 im Live-Setup) laufen und der `agents`-Adapter konfiguriert sein. In der
  Nachweisumgebung ohne diesen Dienst antwortet die API korrekt mit
  `403 CAPABILITY_MISSING "Für 'agents' ist kein Adapter konfiguriert."` — sie erfindet keine Agenten.
- Eigene Testaufgabe je Profil mit korreliertem Ergebnis, Routing-Regeln für mehrdeutige Aufgaben und die
  Backend-Sperre für bereichsfremde Mutationen folgen in 15.03/15.04.

## 5. Belege

- `hermes profile list` / `hermes profile show <name>` auf `FRIDAY-2` (Ausgaben oben).
- `~/.hermes/profiles/<name>/{config.yaml,SOUL.md}` (sieben Profile).
- Isolations-/Recovery-Lauf mit zerstörter und wiederhergestellter `alerts/config.yaml`.
