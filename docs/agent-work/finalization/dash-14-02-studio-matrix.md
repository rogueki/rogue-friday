# DASH-14.02 — Funktionsmatrix Studio-Worktree gegen Completion

**Datum:** 2026-10-23 · **Status:** PASS (Vergleich durchgeführt, keine Übernahme nötig)

Vergleichsquelle: `../rogue-friday-content-studio` (älterer Stand), Ziel: `rogue-friday-completion`.
Grundlage sind Dateigrößen, Service-/Schema-Listen und gezielte Stichproben in beiden Bäumen — kein Merge.

| Bereich | Studio-Worktree | Completion | Befund |
| --- | --- | --- | --- |
| Ideen/Plan | `ContentStudioPage.tsx` (8 164 B) mit Formular und Liste; Parser handgeschrieben in `plan.ts` (3 408 B) | `ContentStudioPage.tsx` (16 882 B), `IdeaKanban.tsx`, Parser im SDK (`@friday/sdk`, Legacy-Import getestet) | Completion ist Obermenge (Kanban, Legacy-Migration, Bearbeiten/Entfernen) |
| Postingkalender | nur Liste im Panel „Postingplan" | `PostingCalendar.tsx` mit Wochenraster, Überfällig-Markierung und Statuspfad mit Herkunft (`veroeffentlichung`) | Completion ist Obermenge |
| Medienwerkstatt | `MediaWorkshop.tsx` (6 247 B), zwei Schritte, Statusabfrage | `MediaWorkshop.tsx` (6 878 B) mit MP3-Download, Statusabfrage, Verbrauchsanzeige | Completion gleichwertig+, nichts zu übernehmen |
| Produktionsworkspace | nicht vorhanden (keine `ProductionWorkspace.tsx`) | `ProductionWorkspace.tsx` (9 308 B) plus `content_studio_jobs`, Artefakt-Download, Abbruch | Completion-only, im Studio nicht vorhanden |
| Provider/Keys | `content-studio-keys.ts`, `content-studio-providers.ts`, 4 Schemas | dieselben plus `content-studio-plan.ts`, `content-studio-media.ts`, `content-studio-production.ts`, 11 Schemas | Completion ist Obermenge |
| Onboarding | keine Onboarding-Komponente (`SocialPublishingOnboarding` fehlt) | `SocialPublishingOnboarding.tsx` (Meta/TikTok/YouTube) und `ContentStudioKeysArea` | Completion-only |
| Skills | keine Studio-Skill-Anbindung | Studio nutzt die Skill-API (`/skills`) für Produktionshilfe | Completion-only |
| Persistenz | Plan im Browser, Export/Import als Datei | Plan in SQLite mit Revision und `If-Match`, Aufträge in `content_studio_jobs` | Completion ist Obermenge |
| Betrieb/Build | `apps/web/out/content-studio` vorhanden | ebenso, plus Installer-`build:app` und Standardmenü | Completion gleichwertig+ |

Schlüsselwort-Zählung in `apps/web/src/features/content-studio` (Studio → Completion): Kanban 0 → 7,
Postingkalender 0 → 1, Onboarding 0 → 4, Provider 0 → 11, Stimmen 0 → 6, Qualitätsregeln 0 → 2, Vorschau 0 → 2.
Umgekehrt gibt es kein Schlüsselwort, das nur im Studio vorkommt.

## Ergebnis

- **Keine Übernahme.** Jede der neun Funktionsflächen ist im Completion-Baum vorhanden und mindestens gleichwertig;
  ein Merge des älteren Stands würde jüngeren Code überschreiben (im Plan ausdrücklich verboten).
- Die einzigen Studio-Dateien ohne Gegenstück (`plan.ts` mit handgeschriebenem Parser) sind im Completion-Baum durch
  den SDK-Parser ersetzt, der zusätzlich Legacy-Pläne und die Herkunftsregel aus DASH-14.04 prüft.
- Damit ist die Integrationsfläche für DASH-14.01 vollständig belegt: Route/Navigation, Feature-Module, Services,
  Verträge und Build/Deployment liegen im Completion-Baum, der Studio-Worktree dient nur als Vergleichsquelle.

## Belege

- Dateilisten: `apps/web/src/features/content-studio` in beiden Bäumen, `apps/control-api/src/services/content-studio*`,
  `packages/contracts/schemas/content-studio`.
- Schlüsselwortvergleich (siehe Tabelle) über `Select-String` auf beiden Feature-Ordnern.
