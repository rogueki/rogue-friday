# DASH-18.02 — Pflichtmatrix (aus dem Repository erzeugt)

**Datum:** 2026-10-23 · **Quelle:** `scripts/finalization/build-area-matrix.mjs` gegen den Arbeitsstand des Branch
`feat/friday-finalization-20261021`. Alle Zahlen stammen aus den Dateien, nicht aus Erinnerung.

## 1. Navigation (echte Seiten)

18 Seiten: `/`, `/tasks`, `/activity`, `/memory`, `/agents`, `/skills`, `/approvals`, `/communication`, `/calendar`, `/automations`, `/research`, `/content-studio`, `/files`, `/voice`, `/alerts`, `/system`, `/audit`, `/settings`

## 2. Bereiche mit Fläche, Routen, Operationen und Tests

| Bereich | Oberfläche | API-Pfade | Operationen | Testdateien | Beispiel-Test |
| --- | --- | --- | --- | --- | --- |
| Übersicht/Orb | `features/overview` | 2 | 2 | 19 | `apps/web/src/features/orb/audioStore.test.ts` |
| Kommunikation | `features/communication` | 45 | 45 | 21 | `apps/web/src/features/communication/channelList.test.ts` |
| Kalender | `features/calendar` | 15 | 16 | 16 | `apps/web/src/features/calendar/CalDavCreateDialog.test.tsx` |
| Memory | `features/memory` | 14 | 18 | 1 | `apps/web/src/features/memory/memory.test.tsx` |
| Aufgaben | `features/tasks` | 10 | 12 | 6 | `apps/web/src/features/tasks/tasks.test.tsx` |
| Agenten | `features/agents` | 5 | 5 | 4 | `apps/web/src/features/agents/agents.test.tsx` |
| Skills | `features/skills` | 16 | 14 | 26 | `apps/web/src/features/settings/skillAccountPlan.test.ts` |
| Automationen | `features/automations` | 9 | 12 | 4 | `apps/web/src/features/automations/automations.test.tsx` |
| Recherche | `features/research` | 6 | 8 | 7 | `apps/web/src/features/research/research.test.tsx` |
| Dateien | `features/files` | 6 | 8 | 3 | `apps/web/src/features/files/files.test.tsx` |
| Studio | `features/content-studio` | 9 | 4 | 10 | `apps/web/src/features/content-studio/ContentStudioPage.test.tsx` |
| Sprache | `features/voice` | 32 | 30 | 14 | `apps/web/src/features/orb/bridge/browserVoiceBridge.test.ts` |
| Aktivität | `features/activity` | 2 | 2 | 2 | `apps/web/src/features/activity/activity.test.tsx` |
| Benachrichtigungen | `features/alerts` | 4 | 4 | 2 | `apps/web/src/features/alerts/alerts.test.tsx` |
| Freigaben | `features/approvals` | 6 | 6 | 3 | `apps/web/src/features/approvals/approvals.test.tsx` |
| Audit | `features/audit` | 4 | 4 | 2 | `apps/web/src/features/audit/audit.test.tsx` |
| System | `features/system` | 10 | 7 | 3 | `apps/web/src/features/system/format.test.ts` |
| Einstellungen | `features/settings` | 35 | 11 | 32 | `apps/web/src/features/settings/CalendarAccountWizard.test.tsx` |
| Onboarding | `app/(dashboard)/onboarding` | 1 | 2 | 3 | `apps/web/src/features/skills/OnboardingPage.test.tsx` |
| Standort/Wetter | `features/settings` | 2 | 2 | 4 | `apps/web/src/features/settings/LocationWeatherArea.test.tsx` |

Summen: 244 API-Pfade, 282 Operationen, 33 Tabellen, 15 Ports,
67 Scopes, 83 Web-Tests, 117 Node-Tests, 8 Adapter-Tests.

## 3. Datenbanktabellen (Persistenz)

`kv`, `settings_areas`, `audit_log`, `idempotency_keys`, `command_history`, `library_items`, `adapter_overrides`, `content_studio_plan`, `content_studio_jobs`, `owner_onboarding`, `coding_voice_repository`, `himalaya_send_journal`, `caldav_create_journal`, `local_calendar_events`, `telephony_calls`, `telephony_previews`, `cloudtalk_previews`, `cloudtalk_calls`, `cloudtalk_reminder_calls`, `mail_send_journal`, `messenger_send_journal`, `messenger_outbound_targets`, `notifications`, `audit_archive_segments`, `notification_messenger_stages`, `native_approval_requests`, `research_projects`, `research_sources`, `research_findings`, `pending_command_clarifications`, `encrypted_clarified_mail_drafts`, `schema_migrations`, `schema_migrations`

## 4. Ports (Rollen/Scopes)

`tasks`, `activity`, `memory`, `agents`, `approvals`, `communication`, `calendar`, `automations`, `research`, `files`, `voice`, `notifications`, `system`, `audit`, `commands`

## 5. Wie diese Matrix zu lesen ist

Die Spalten belegen **Fläche** (Seite/Modul), **API** (Pfade und Operationen), **Tests** (Dateien, die den Bereich
abdecken). Sie belegen noch **nicht** je Zeile Quelle/Persistenz/Runtimewirkung/Rolle/Fehler/Sprachaktion — das ist
DASH-18.03 und wird Bereich für Bereich nachgezogen. Zeilen mit 0 Tests bleiben sichtbar und werden nicht als
„vorhanden" gezählt.

## 6. Hinweise zur Erhebung

- **Testzahlen sind Untergrenzen.** Gezählt werden Dateien, deren Pfad einen Bereichsbegriff enthält (Heuristik).
  Ein Bereich kann durch Tests abgedeckt sein, die anders heißen; umgekehrt zählt ein Treffer wie
  `features/settings/skillAccountPlan.test.ts` beim Bereich Skills mit.
- **Onboarding** hat keine eigene Navigationsseite, sondern die App-Route `app/(dashboard)/onboarding` mit
  `features/skills/OnboardingPage.tsx`.
- **Standort/Wetter** liegt in den Einstellungen (`features/settings/LocationWeatherArea.tsx`), nicht als eigene Seite.
- **Memory** hat genau einen Web-Test gefunden; die Persistenzprüfung läuft über die Node-Tests und wird in 18.03
  zeilengenau zugeordnet.
- Die Erhebung ist reproduzierbar: `node scripts/finalization/build-area-matrix.mjs` schreibt diese Datei neu.

## 7. Was hier bewusst nicht behauptet wird

Keine Zeile behauptet Runtime-Wirkung, Rollenprüfung, Fehlerpfad oder Sprachaktion **pro Funktion**. Genau das ist
DASH-18.03, und DASH-18.05 verlangt für jede Inventarzeile einen echten Beleg. Bereiche ohne Live-Anbindung
(Automationen: kein Adapter) bleiben in der Matrix sichtbar statt als „vorhanden" gezählt zu werden.
