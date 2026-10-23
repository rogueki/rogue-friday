# KEEP-05 — Studio-Funktionsparität statt bloßem Menülink (Stand 2026-10-23)

**Status:** TEIL — 11 von 12 Punkten belegt, ein Punkt fehlt nachweislich. Keine Abnahme.

## 1. Belegte Punkte

| Anforderung | Beleg | Ergebnis |
| --- | --- | --- |
| Werkzeugübersichten Stimme/Video | `StudioGuide.tsx:3–17` (`voiceTools`, `videoTools`) mit Links, gerendert als „Stimmen-Tools" und „Video-KI und Schnitt" | vorhanden |
| Formate | `StudioGuide.tsx:18–27` (`formats`) + „Format-Cheatsheet"-Tabelle | vorhanden |
| Workflow | `StudioGuide.tsx:28–37` (`workflow`) + „Standard-Workflow"-Liste | vorhanden |
| Ordner-/Qualitätshinweise | `StudioGuide.tsx:47` „Ordnerstruktur" | vorhanden |
| Kanban/Bearbeiten | `IdeaKanban.tsx`, `IdeaDialog` über `ContentStudioPage` | vorhanden |
| Wochenplan | `PostingCalendar.tsx:11–20` („Wochen-Postingkalender", `weekOffset`, `aria-label="Postings dieser Woche"`) | vorhanden |
| Postingformular | `ContentStudioPage.tsx` Formulare + `plan.test.ts` (4 Tests) | vorhanden |
| Persistenter gemeinsamer Plan mit Revision | `PUT /api/v1/content-studio/plan` mit `If-Match` (`ContentStudioPage.tsx:101–107`), `content-studio-plan.test.ts` (2 Tests) | vorhanden |
| Migration nur bei echten Browserdaten | `ContentStudioPage.tsx:71–83`: Browserplan wird **nur** gelesen, wenn der Serverplan leer ist, nur bei `content.length > 0 \|\| postings.length > 0`; das Browser-Original bleibt als Sicherung, unlesbare Daten führen zu einer Meldung statt zu Löschung | vorhanden |
| Produktionsjob Vorschau/Start/Status/Cancel | `ProductionWorkspace.tsx` (`POST /production-jobs`, `GET …/{id}`, Zustände inkl. `provider_unknown`/`speech_unknown`), `content-studio-production.test.ts` (7 Tests) | vorhanden |
| kie.ai / ElevenLabs / lokaler FFmpeg-Pfad | `content-studio-providers.ts`, `content-studio-media.ts` (`renderContentVideo`, `ffmpegPath`, `ffmpegAvailable`), 403 `CAPABILITY_MISSING` ohne Keys | vorhanden |
| Socialziele Instagram/Facebook/TikTok/YouTube | `SocialPublishingOnboarding.tsx:5–13` Meta (Instagram+Facebook), TikTok, YouTube je mit Einrichtung, Konto, Leitfaden | vorhanden |

Zusätzlich belegt: Studio ist standardmäßig aktiv, aber jeder Handler prüft
`settings.area("dashboard").contentStudioEnabled` und antwortet sonst `403 "Content Studio ist deaktiviert."`
(`handlers/content-studio.ts:10–60`); Produktionsstart und Provider-Aufrufe sind idempotent
(`ctx.mutation.idempotencyKey`), Plan-Schreiben ist revisionsgebunden.

## 2. Fehlender Punkt (deshalb keine Abnahme)

**„Skill-/Voice-Bridge authentifiziert und revisionssicher anbinden."**

- Der Voice-Teil existiert: `POST /api/v1/content-studio/elevenlabs/speech` läuft über denselben authentifizierten
  Handler (`createElevenSpeech`) und ist idempotent.
- Der **Skill**-Teil existiert nicht: weder `handlers/skills.ts` noch `handlers/commands.ts` enthalten einen
  Studio-Bezug (0 Treffer für `studio`/`content_studio`), und es gibt keinen Studio-Skill-Bridge-Service. Ein
  Studio-Auftrag kann also nicht aus einem Skill oder Sprachkommando heraus gestartet werden.

## 3. Ausgeführte Prüfungen

```
vitest --project web  apps/web/src/features/content-studio     11 Tests bestanden (4 Dateien)
vitest --project node content-studio                           19 Tests bestanden (6 Dateien)
```

## 4. Nächster Schritt für die Abnahme

Skill-/Voice-Bridge als echte Route definieren (Studio-Produktion aus Skill/Kommando, mit denselben
Rechte-/Revisions-/Idempotenzgarantien) und mit einem Lauf gegen die laufende API belegen. Danach kann KEEP-05 auf
PASS.
