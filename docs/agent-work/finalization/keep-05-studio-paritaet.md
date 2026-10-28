# KEEP-05 — Studio-Funktionsparität statt bloßem Menülink (Stand 2026-10-23)

**Status:** PASS — 12 von 12 Punkten belegt; der zuvor fehlende Skill-Bridge-Punkt ist implementiert und getestet.

## 1. Belegte Punkte

| Anforderung | Beleg | Ergebnis |
| --- | --- | --- |
| Werkzeugübersichten Stimme/Video | `StudioGuide.tsx:3–17` (`voiceTools`, `videoTools`) | vorhanden |
| Formate | `StudioGuide.tsx:18–27` (`formats`) + „Format-Cheatsheet" | vorhanden |
| Workflow | `StudioGuide.tsx:28–37` (`workflow`) + „Standard-Workflow" | vorhanden |
| Ordner-/Qualitätshinweise | `StudioGuide.tsx:47` „Ordnerstruktur" | vorhanden |
| Kanban/Bearbeiten | `IdeaKanban.tsx`, `IdeaDialog` | vorhanden |
| Wochenplan | `PostingCalendar.tsx:11–20` „Wochen-Postingkalender" | vorhanden |
| Postingformular | `ContentStudioPage.tsx` + `plan.test.ts` | vorhanden |
| Persistenter gemeinsamer Plan mit Revision | `PUT /api/v1/content-studio/plan` mit `If-Match`; `content-studio-plan.test.ts` | vorhanden |
| Migration nur bei echten Browserdaten | `ContentStudioPage.tsx:71–83`: nur bei leerem Serverplan und nur bei Inhalt; Browser-Original bleibt Sicherung | vorhanden |
| Produktionsjob Vorschau/Start/Status/Cancel | `ProductionWorkspace.tsx`, `content-studio-production.test.ts` (7 Tests) | vorhanden |
| kie.ai / ElevenLabs / lokaler FFmpeg-Pfad | `content-studio-providers.ts`, `content-studio-media.ts`; ohne Keys `403 CAPABILITY_MISSING` | vorhanden |
| Socialziele Instagram/Facebook/TikTok/YouTube | `SocialPublishingOnboarding.tsx:5–13` | vorhanden |
| **Skill-/Voice-Bridge authentifiziert und revisionssicher** | **neu:** `POST /api/v1/content-studio/skill-production-jobs` | **implementiert und getestet** |

## 2. Die neue Skill-Bridge

Contract-first eingeführt:

- Schema `packages/contracts/schemas/content-studio/skill-production-request.schema.json`
  (`ideaId`, `planRevision`, `voiceId?`, `skillId` mit Muster, `confirmed: true`, `additionalProperties: false`).
- Pfad `POST /api/v1/content-studio/skill-production-jobs`, `operationId: createSkillContentProductionJob`,
  `x-capability: meta.read`, `x-required-role: owner`, `x-max-body-bytes: 4096`, `Idempotency-Key` erforderlich.
- Handler `createSkillContentProductionJob` (`apps/control-api/src/handlers/content-studio.ts`) delegiert an
  denselben Produktionsservice wie der manuelle Weg. Dadurch gelten unverändert: Bestätigungspflicht,
  Revisionsprüfung (`409` bei veraltetem Plan), Ideenprüfung (`404`), Anbieter-/FFmpeg-Prüfung (`503`),
  Idempotenz. Der Idempotenzschlüssel wird pro Skill namensräumig gebunden (`skill:<skillId>:<key>`), damit derselbe
  Schlüssel verschiedener Skills nicht kollidiert.
- Audit: `content_studio.skill_production_started` mit `jobId`, `ideaId`, `skillId` — der Auslöser ist damit im
  durabilen, hash-verketteten Auditpfad nachvollziehbar.

## 3. Ausgeführte Prüfungen (aktuell)

```
vitest --project node content-studio-skill-bridge           5 Tests bestanden
vitest --project node content-studio (6 Dateien)           19 Tests bestanden
vitest --project node contract + openapi-additions +
  authorization-contract                                   381 Tests bestanden
vitest --project web apps/web/src/features/content-studio  11 Tests bestanden
pnpm contracts:check                                       bestanden
pnpm typecheck                                             bestanden
pnpm lint                                                  bestanden
pnpm test:conformance                                      415 bestanden, 60 übersprungen
```

Die Bridge-Tests decken ab: genau ein durabler Auftrag je Idempotenzschlüssel (`Idempotent-Replayed: true`),
`409` bei veralteter Planrevision vor jedem Anbietereinsatz, `404` bei unbekannter Idee, `422` bei fehlendem oder
missgebildetem `skillId`, `401` ohne Sitzung, `422` ohne Bestätigung und den Audit-Eintrag mit `skillId`.

## 4. Neue Zählung im Vertrag

Die Vertrags- und Routen-Assertions wurden bewusst von 282 auf **283** Operationen erhöht und im Kommentar mit
Begründung versehen (`openapi-additions.test.ts`, `contract.test.ts`), die Mock-Plattform führt die Route als
live-only (`packages/mock-data/test/api.test.ts`).
