# DASH-10.06 — Abnahme: ansehen, verwalten, Zustand nach Neustart

Stand: 2026-10-23. Der Hub-Fall wurde in einem **wegwerfbaren** Hermes-Profil geprüft (`friday-accept`), damit
die Installation des Operators unberührt bleibt; das Profil und sein Wrapper sind danach gelöscht.

## 1. Auftrag

> **DASH-10.06** **Abnahme:** ein Builtin, ein Friday-Skill und ein kontrollierter Hub-Skill lassen sich jeweils
> ansehen und entsprechend realen Möglichkeiten verwalten; Zustand nach Neustart/Readback gleich. Fehlendes
> Laufwerk, ungültiger Skill, Auditfehler und modifizierter Builtin werden nicht still überschrieben.

## 2. Matrix (echte Läufe, Windows-CLI v0.20.5 und WSL v0.22.2)

| Fall | Ansehen | Verwalten | Readback in neuem Prozess | Belegt in |
|---|---|---|---|---|
| Builtin (`arxiv`, 72 Stück) | Inventar + `SKILL.md` über die Bridge | An/Aus über `PUT /api/v1/skills/{id}/activation` → `skills.disabled` | Ja: 72 → 71 (`arxiv` disabled) → 72, Zeile `arxiv disabled` gesehen, Default-Profil unverändert | `dash-10-03-skill-enable.md` |
| Friday-Skill (Paket, `packaged: true`) | Katalog + `SKILL.md`-Detailseite (DASH-10.02), Herkunft/Trust getrennt | derselbe Schalter, sobald Hermes den Skill entdeckt | Ja, Katalog-Readback nach Neustart | `dash-10-02-skill-inventory.md` |
| **Hub-Skill** (`skill-creator`, `skills-sh/anthropics/skills/skill-creator`) | `skills list` zeigt `skill-creator │ skills.sh │ trusted │ enabled`; `SKILL.md` über die Bridge lesbar | Installation real ausgeführt, danach Verwaltung wie oben | Ja: neuer Prozess listet den Skill als `enabled` | dieser Bericht, Abschnitt 3 |
| Fehlendes Laufwerk | nicht geprüft (kein externes Laufwerk verfügbar) | — | — | offen |
| Ungültiger Skill | `skills diff skill-creator` → `Error: 'skill-creator' is not a tracked bundled skill …` | — | — | Abschnitt 4 |
| Modifizierter Builtin/Hub-Skill | `skills update` erkennt lokale Änderungen | ohne `--force` **übersprungen**, mit `--force` überschrieben | lokale Zeile überlebt das Skippen, verschwindet beim Überschreiben | Abschnitt 3 |

## 3. Hub-Skill: Installation, lokale Änderung, Update

1. Profil: `hermes profile create friday-accept` (erbt keine Zugänge des Operators, Standardprofil bleibt aktiv).
2. Suche: `friday-accept skills search "skill-creator" --json --limit 5` → u. a.
   `skills-sh/anthropics/skills/skill-creator` (`trust_level: trusted`).
3. Installation: `friday-accept skills install "skills-sh/anthropics/skills/skill-creator" --yes`
   - `Quarantined to .hub\quarantine\skill-creator`, danach `Running security scan ... Verdict: CAUTION`
     (HIGH exfiltration in `SKILL.md:67`), `Decision: ALLOWED — Allowed (trusted source, caution verdict)`,
     `Scan provenance: fresh; scanner skills-guard-v1; hash sha256:b909eabd…`
   - `Installed: skill-creator`, `Files: SKILL.md, assets/eval_review.html, references/schemas.md`
4. Readback (neuer Prozess): `friday-accept skills list` → `skill-creator │ skills.sh │ trusted │ enabled`.
5. Lokale Änderung: eine Zeile an `SKILL.md` angehängt.
   - `friday-accept skills update skill-creator` →
     `Skipping: skill-creator — you have local edits (update would overwrite them).`
     `1 skill(s) kept your local edits: skill-creator.` `Overwrite with: hermes skills update <name> --force`
   - Die lokale Zeile ist danach **noch vorhanden** — nichts wurde still überschrieben.
6. Bewusstes Überschreiben: `friday-accept skills update skill-creator --force` → `Updated 1 skill(s).`,
   die lokale Zeile ist **weg**. Der Wiederherstellungsweg existiert also, ist aber ausdrücklich (`--force`).
7. Aufräumen: `hermes profile delete friday-accept --yes`, Wrapper `friday-accept.bat` entfernt,
   `hermes profile list` zeigt nur noch `◆default`.

## 4. Grenzen, die dabei sichtbar wurden

- `skills diff` gilt **nur** für mitgelieferte (getrackte) Skills. Für Hub-Skills endet es mit
  `Error: 'skill-creator' is not a tracked bundled skill (no stock version to diff against). Hub-installed skills
  use \`hermes skills inspect\`.` Unsere API meldet dafür `ADAPTER_UNAVAILABLE`, **ohne** diesen Text
  weiterzugeben — Ledger **N-054**.
- `skills inspect skill-creator` löst den Namen erneut gegen die Registries auf (37 s) und liefert eine
  Mehrdeutigkeitstabelle statt eines lokalen Berichts — auch für bereits installierte Skills. Ledger **N-053**.
- `skills list-modified --json` war nach der lokalen Änderung am **Hub**-Skill weiterhin `[]`: die Liste führt nur
  mitgelieferte Skills. Die Registry-Fläche (DASH-10.05) formuliert das jetzt entsprechend eng.
- Ein fehlendes externes Laufwerk (`skills.external_dirs`) konnte nicht geprüft werden.

## 5. Ergebnis

**TEIL** — ansehen und verwalten ist für Builtin, Friday- und Hub-Skill real belegt, der Zustand überlebt einen
neuen Prozess, und ein modifizierter Skill wird nachweislich nicht still überschrieben. Offen bleiben das
fehlende Laufwerk, die Fehlertexte bei `diff`/`inspect` (N-053, N-054) und der Nachweis am laufenden
Operator-System (dort wurde nichts verändert).