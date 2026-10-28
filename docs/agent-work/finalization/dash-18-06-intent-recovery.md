# DASH-18.06 — Fehlerhafte Intentauflösung fragt nach statt zu raten

**Datum:** 2026-10-23 · **Status:** PASS (51 + 26 Tests, Codebelege)

## 1. Die Intent-Schicht erfindet keine Schreibaktion

`apps/control-api/test/calendar-action-intent.test.ts` enthält einen eigenen Negativ-Block: zwölf Sätze, die
**keine** Schreibaktion auslösen dürfen, unter anderem

```
"Verschieb den Termin auf irgendwann"      -> null   (kein Zeitpunkt erfunden)
"Verschieb den Termin Zahnarzt auf Freitag" -> null  (kein fehlendes Ziel ergänzt)
"Lösche den Termin das"                     -> null   (Artikel ist kein Termin)
"Trage Zahnarzt als Aufgabe ein"            -> null   (fremde Domäne)
"Erstelle einen Termin"                     -> null   (kein Titel)
"Plane den Urlaub"                          -> null   (kein Termin)
```

Die Auflösung selbst lehnt Pronomen und Artikel als Bezug ab: `validRef()` akzeptiert nur eine Event-ID
(`/^cal_[0-9A-Za-z]{26}$/`) oder einen echten Titel und gibt für `der|die|das|dies|es|ihn|sie|it|that|this` `null`
zurück (`apps/control-api/src/services/calendar-action-intent.ts:21–26`). Ein Pronomen kann also nie stillschweigend
zum falschen Termin führen.

Mail und Messenger haben eigene Negativgruppen (`it.each` in `mail-action-intent.test.ts` und
`messenger-action-intent.test.ts`): Betreff-/Empfängerableitung ohne echten Adressaten ergibt kein Ziel.

## 2. Sprachaktion ist keine versteckte zweite Aktion

Der Sprachpfad ist zweistufig und an den Zustand gebunden (`apps/control-api/src/handlers/voice-calendar.ts`):

1. `previewVoiceLocalCalendar` löst den Zieltermin auf und gibt einen Bestätigungs-Token aus, dessen Fingerabdruck
   Anfrage **plus** `targetId` **plus** `version` enthält (Zeilen 48–56).
2. `confirmVoiceLocalCalendar` prüft vor dem Schreiben, ob der Termin noch denselben Stand hat, und antwortet sonst
   mit `409 "Der Termin wurde inzwischen geaendert. Bitte erneut vorlesen lassen."` (Zeile 66); der Token wird
   einmalig verbraucht (`consume`, Zeilen 68–69) und eine zweite Verwendung ergibt
   `409 "Die gesprochene Bestaetigung ist ungueltig, abgelaufen oder bereits verwendet."`.

Damit führt eine gesprochene Bestätigung auf **dieselbe** Backendaktion wie die Oberfläche, aber nie auf einen
abweichenden, unbemerkten Schreibvorgang.

## 3. Mail: genaues Ziel, ein Versand, kein Tampering

`apps/control-api/test/voice-mail.test.ts`:

- „previews the exact reply target, sends once, blocks tampering and limits the voice key"
- „requires a precise existing destination and consumes a move approval only once"

Ein unpräzises oder nicht vorhandenes Ziel führt also zur Rückfrage statt zu einem geratenen Versand.

## 4. Ausgeführte Prüfungen

```
vitest --project node voice-calendar voice-mail calendar-action-intent mail-action-intent   51 Tests bestanden
vitest --project node messenger-action-intent read-command-intents                          26 Tests bestanden
```

## 5. Grenze

Mehrschritt-Dialoge mit Pronomen und Korrektur über mehrere Züge (DASH-18.04) sowie die vollständige
Inventarmatrix (18.02/18.03/18.05) bleiben offen; diese Aufgabe betrifft ausschließlich das Verhalten bei
fehlerhafter oder unvollständiger Intentauflösung.
