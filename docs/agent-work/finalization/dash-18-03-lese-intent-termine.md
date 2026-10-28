# DASH-18.03 (Teil 2) — Terminabfrage per Sprache (2026-10-23)

## Lücke

Nach 18.01 gab es für den Kalender nur schreibende Intents. „Zeige meine Termine heute“ fiel in den Freitextpfad.

## Änderung

Neu: `apps/control-api/src/services/calendar-day-range.ts` und die Lesefamilie `calendar` in `read-query-intent.ts`.

| Frageform | Ergebnis |
|---|---|
| „zeige meine termine heute“ | `calendar.list` mit `dayOffset: 0` |
| „zeige termine für morgen“ | `calendar.list` mit `dayOffset: 1` |
| „zeige meine termine“ | Rückfrage: welcher Tag? |
| „zeige termine diese woche / übermorgen“ | Rückfrage: Zeitraum noch nicht unterstützt |
| „zeige termine morgen um 14 uhr“ | Rückfrage: Uhrzeit grenzt den Zeitraum ein |
| „zeige termine heute und lösche den ersten“ | Rückfrage: Lesen und Ändern gemischt |
| „trage zahnarzt morgen um 14 uhr ein“ | kein Lese-Intent (bleibt Anlagepfad) |

Entscheidungen:

- **Tagesgrenzen statt 24-Stunden-Fenster.** `localDayRange` rechnet beide Enden als Wanduhr-Mitternacht in der Zone
  des Profils (`settings.area("profile").timeZone`) und korrigiert die Sommerzeit einmal. Tests belegen 23 h am
  29.03.2026 und 25 h am 25.10.2026 in `Europe/Berlin`.
- **Ohne gültige Zone keine Antwort mit erfundenem Zeitraum.** Dann sagt die Antwort, dass die Zeitzone im Profil fehlt.
- **Kein stiller Default.** Ohne Tageswort wird gefragt, nicht geraten; „diese Woche“ wird als nicht unterstützt benannt
  statt halb richtig beantwortet.
- Quelle: `registry.getPort("calendar").listCalendarEvents({ from, to, limit: 5 })`, Rolle `viewer` — derselbe Port
  wie `GET /api/v1/calendar/events`.

## Nachweise

```
vitest apps/control-api/src/services/calendar-day-range.test.ts      -> 3 bestanden (DST 23 h / 25 h, ungültige Zone)
vitest apps/control-api/src/services/calendar-read-intent.test.ts    -> 4 bestanden (Formulierungen, Rückfragen)
vitest apps/control-api/test/read-calendar.test.ts                   -> 3 bestanden
vitest (Kalender-/Befehlsumfeld, 6 Dateien)                          -> 21 bestanden
node scripts/finalization/build-voice-parity.mjs --check             -> Matrix aktuell, Kalender: lesen + schreiben
```

Der Integrationstest ist der Beweis: er liest dieselbe Tagesgrenze über die Route
(`GET /api/v1/calendar/events?from=…&to=…`) und vergleicht die Kennungen mit der Sprachantwort — heute zwei
Seed-Termine, morgen zwei andere, und die jeweils anderen dürfen nicht auftauchen.

Ein Zwischenbefund aus der Testarbeit: die Mock-Welt läuft auf einem festen Startzeitpunkt (`2026-10-14T08:15Z`,
`realTimeWorld: false`). Die erste Testfassung hatte eine feste Uhr injiziert und damit die Tagesgrenze gegen die
Seed-Daten verschoben. Der Test nutzt jetzt die Weltzeit; das ist die Größe, die `ctx.runtime.nowMs()` im Betrieb
wirklich liefert.

## Was an 18.03 offen bleibt

- Kommunikation, Memory, Dateien, Agenten, Automationen, Recherche: Lese-Intents fehlen weiterhin.
- Skills, Studio, System, Onboarding, Standort/Wetter: kein Sprachweg.
- Wochen-/Monatsbereich für Termine ist bewusst nicht implementiert (benannte Rückfrage statt Näherung).
- Persistenz- und Fehlerfallspalte je Funktion sind noch nicht für alle Bereiche belegt.