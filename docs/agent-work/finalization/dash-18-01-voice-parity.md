# DASH-18.01 — Sprach-/UI-Parität (aus dem Repository erzeugt)

**Datum:** 2026-10-23 · **Quelle:** `scripts/finalization/build-voice-parity.mjs` gegen den Arbeitsstand des Branch
`feat/friday-finalization-20261021`. Die Zuordnung stammt aus den Intent-Dateien (`kind:`-Literale, `targetRoute`) und
dem Dispatcher in `handlers/commands.ts`, nicht aus Erinnerung.

## 1. Übersicht

- Intent-Dienste: 11 (`agent-action-intent.ts`, `automation-action-intent.ts`, `calendar-action-intent.ts`, `knowledge-action-intent.ts`, `mail-action-intent.ts`, `messenger-action-intent.ts`, `read-query-intent.ts`, `research-action-intent.ts`, `settings-content-mutation-intent.ts`, `task-action-intent.ts`, `task-create-intent.ts`)
- Im Dispatcher erreichbar: 11 von 11
- Lese-Intents: 24 · eingebaute Sprachintents: voice_start, focus_toggle
- Bereiche mit Lese- und Schreibweg: 9 von 20
- Nur lesbar: 4 · nur schreibbar: 2 · ohne Sprachweg: 5

## 2. Matrix

| Bereich | UI-Seite | Sprachlich lesen | Sprachlich schreiben | Urteil |
| --- | --- | --- | --- | --- |
| Übersicht/Orb | ja | — | `focus_toggle` | nur schreiben |
| Kommunikation | ja | `communication.list` | `mail.compose`, `mail.reply`, `messenger.reply`, `messenger.send` | lesen + schreiben |
| Kalender | ja | `calendar.list` | `calendar.create`, `calendar.delete`, `calendar.update` | lesen + schreiben |
| Memory | ja | `memory.get`, `memory.list` | `memory.confirm`, `memory.create`, `memory.delete`, `memory.update` | lesen + schreiben |
| Aufgaben | ja | `tasks.get`, `tasks.list` | `task.cancel`, `task.create`, `task.retry`, `task.update` | lesen + schreiben |
| Agenten | ja | `agents.get`, `agents.list` | `agent.assign`, `agent.pause`, `agent.resume`, `agent.stop` | lesen + schreiben |
| Skills | ja | — | — | kein Sprachweg |
| Automationen | ja | `automations.get`, `automations.list` | `automation.disable`, `automation.enable`, `automation.pause`, `automation.pauseAll`, `automation.resume`, `automation.test` | lesen + schreiben |
| Recherche | ja | `research.get`, `research.list` | `research.create` | lesen + schreiben |
| Dateien | ja | `files.get`, `files.list` | `file.delete`, `file.rename` | lesen + schreiben |
| Studio | ja | — | — | kein Sprachweg |
| Sprache | ja | — | `voice_start` | nur schreiben |
| Aktivität | ja | `activity.get`, `activity.list` | — | nur lesen |
| Benachrichtigungen | ja | `notifications.list`, `notifications.unsupportedDetail` | — | nur lesen |
| Freigaben | ja | `approvals.get`, `approvals.list` | — | nur lesen |
| Audit | ja | `audit.exportUnsupported`, `audit.get`, `audit.list` | — | nur lesen |
| System | ja | — | — | kein Sprachweg |
| Einstellungen | ja | `settings.get` | `settings.dashboard.backgroundGrid`, `settings.dashboard.compact`, `settings.dashboard.contentStudioEnabled`, `settings.dashboard.refresh`, `settings.dashboard.soundEffects`, `settings.navigation.defaultPage`, `settings.navigation.mode`, `settings.profile.assistantName`, `settings.profile.dateFormat`, `settings.profile.displayName`, `settings.profile.firstDayOfWeek`, `settings.profile.locale`, `settings.profile.timeFormat`, `settings.profile.timeZone` | lesen + schreiben |
| Onboarding | ja | — | — | kein Sprachweg |
| Standort/Wetter | nur Route | — | — | kein Sprachweg |

## 3. Bereiche ohne Sprachweg

- Skills: kein Intent-Kind und kein Parser in `services/*-intent.ts`
- Studio: kein Intent-Kind und kein Parser in `services/*-intent.ts`
- System: kein Intent-Kind und kein Parser in `services/*-intent.ts`
- Onboarding: kein Intent-Kind und kein Parser in `services/*-intent.ts`
- Standort/Wetter: kein Intent-Kind und kein Parser in `services/*-intent.ts`

## 4. Nur lesbare Bereiche

- Aktivität: `activity.get`, `activity.list`; kein Schreib-Intent vorhanden
- Benachrichtigungen: `notifications.list`, `notifications.unsupportedDetail`; kein Schreib-Intent vorhanden
- Freigaben: `approvals.get`, `approvals.list`; kein Schreib-Intent vorhanden
- Audit: `audit.exportUnsupported`, `audit.get`, `audit.list`; kein Schreib-Intent vorhanden

## 5. Was das Urteil bedeutet

- **lesen + schreiben**: mindestens ein Lese-Intent und ein Schreib-Intent nennen den Bereich.
- **nur lesen**: ein Sprachbefehl kann den Zustand vortragen, aber nichts ändern (z. B. Audit, Aktivität — Änderungen dort
  wären Fälschung des Verlaufs).
- **nur schreiben**: ein Befehl ändert etwas, aber es gibt keinen Lese-Intent (kommt derzeit nicht vor).
- **kein Sprachweg**: der Bereich ist nur über die Oberfläche erreichbar. Das ist eine Lücke, wenn dort eine sinnvolle
  Aktion existiert; es ist Absicht, wenn der Bereich reine Oberflächenkonfiguration ist (Darstellung, Onboarding).

Die Matrix ersetzt keinen Laufzeittest: sie belegt, dass ein Intent existiert und im Dispatcher hängt. Rolle, Fehlerfall
und Runtimewirkung je Funktion prüft DASH-18.03.
