# DASH-18.01 — Befunde zur Sprach-/UI-Parität (2026-10-23)

**Status:** PASS als Inventarschritt. Die maschinelle Matrix steht in
[`dash-18-01-voice-parity.md`](dash-18-01-voice-parity.md) und wird von `scripts/finalization/build-voice-parity.mjs`
aus den Quellen erzeugt (`--check` erzwingt die Synchronität, geprüft durch `apps/control-api/test/voice-parity.test.ts`).

## 1. Was tatsächlich existiert

11 Intent-Dienste, alle im Dispatcher von `handlers/commands.ts` erreichbar:

`task-create, task-action, calendar-action, mail-action, messenger-action, agent-action, knowledge-action,
automation-action, research-action, settings-content-mutation, read-query`

Dazu zwei eingebaute Sprachintents ohne Port-Aufruf: `voice_start` und `focus_toggle`.

**Deterministisch lesbar (6 Bereiche):** Aktivität, Benachrichtigungen, Freigaben, Audit, Einstellungen,
Content-Studio-Plan. Diese Abfragen sind bewusst konservativ: eine unbekannte Formulierung oder eine fremde Kennung
führt zu einer Rückfrage, nicht zu einer erfundenen Antwort.

**Deterministisch schreibbar (11 Bereiche):** Aufgaben (anlegen/ändern/abbrechen/neu starten), Kalender
(anlegen/ändern/löschen), Kommunikation (Mail schreiben/antworten, Messenger senden/antworten), Memory
(anlegen/ändern/löschen/bestätigen), Dateien (umbenennen/löschen), Agenten (zuweisen/pausieren/fortsetzen/stoppen),
Automationen (ein-/ausschalten, pausieren/fortsetzen, Sammelpause, Testlauf), Recherche (starten), Einstellungen
(Profilwerte), Übersicht (Fokus-Modus), Sprache (Aufnahme starten).

**Ohne jeden Sprachweg (5 Bereiche):** Skills, Studio, System, Onboarding, Standort/Wetter.

## 2. Der eigentliche Befund

Für Aufgaben, Kalender, Kommunikation, Memory, Dateien, Agenten, Automationen und Recherche gibt es **keinen
deterministischen Lese-Intent**. Ein Satz wie „Zeige meine offenen Aufgaben“ wird nicht als Leseabfrage erkannt: er
fällt durch alle Parser und landet über `executeCommand` im Freitext-Pfad — also beim Kommando-Adapter und damit im
Live-Betrieb bei einem Modell. Das ist keine Parität zur Oberfläche, sondern eine offene Flanke: dort kann eine Antwort
entstehen, die niemand gegen die Daten geprüft hat.

Das ist bewusst so festgehalten und nicht in diesem Schritt „schnell“ behoben: ein Lese-Intent braucht dieselbe Sorgfalt
wie die bestehenden (Lese-Cue, Statusfilter, Kennungsprüfung, Mehrdeutigkeit als Rückfrage, Rollenprüfung). Genau diese
Einzelprüfung ist DASH-18.03, das je Funktion Quelle, Persistenz, Runtimewirkung, Rolle, Fehlerfall **und** Sprachaktion
belegen soll.

## 3. Nachweise

```
node scripts/finalization/build-voice-parity.mjs --check   -> "Paritaetsmatrix aktuell: Intents: 11, dispatched: 11, ohne Sprachweg: 5"
vitest apps/control-api/test/voice-parity.test.ts           -> 3 bestanden
```

Der Test prüft drei Dinge: die Matrix ist gegenüber den Quellen aktuell, jeder der 20 Bereiche aus der Pflichtmatrix
kommt genau einmal vor, und die Trennung „ohne Sprachweg“ / „nur lesbar“ ist korrekt.

## 4. Grenzen

- Die Matrix zählt **Intent-Kinds**, nicht Formulierungen. Ob ein bestimmter Satz wirklich greift, zeigt erst der
  Parser-Test der jeweiligen Funktion (DASH-18.03/18.04).
- „Nur lesbar“ bei Audit, Aktivität, Freigaben und Benachrichtigungen ist Absicht: ein Sprachbefehl darf einen Verlauf
  nicht verändern.
- Die fünf Bereiche ohne Sprachweg sind nicht automatisch Lücken: Onboarding und Darstellung sind Einrichtungsflächen,
  System zeigt Betriebszustand (dort fehlt tatsächlich ein Lese-Intent, siehe 18.03), Skills und Studio sind
  Inhaltsflächen mit eigenem Schreibweg über die UI.
- Die Parität „gleiche Backendaktion“ ist auf Intent-Ebene belegt; der Abgleich der konkreten UI-Controls gegen die
  jeweilige Aktion folgt in DASH-18.05.