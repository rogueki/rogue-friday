# DASH-18.03 (Teil 3) — Unterhaltungsabfrage per Sprache (2026-10-23)

## Lücke

Kommunikation hatte nur schreibende Intents (`mail.compose`, `mail.reply`, `messenger.send`, `messenger.reply`).
„Zeige meine offenen Unterhaltungen“ fiel in den Freitextpfad.

## Änderung

Die Lesefamilie `communication` in `read-query-intent.ts`:

| Frageform | Ergebnis |
|---|---|
| „zeige meine unterhaltungen / threads / mails“ | `communication.list` ohne Filter |
| „zeige offene unterhaltungen“ | Status `open` |
| „welche unterhaltungen sind wartend“ | Status `waiting` |
| „zeige beantwortete threads“ | Status `replied` |
| „zeige archivierte mails“ | Status `archived` |
| „zeige unterhaltungen, die eine antwort brauchen“ | `needsReply: true` |
| „zeige ungelesene mails“ | Rückfrage: Ungelesen ist kein Filter der Route |
| „unterhaltungen der letzten Woche“ | Rückfrage: Zeitraum nicht unterstützt |
| „offene und wartende unterhaltungen“ | Rückfrage: genau ein Status |
| „offene unterhaltungen, die eine antwort brauchen“ | Rückfrage: Status oder „braucht Antwort“, nicht beides |
| „antworte auf die unterhaltung“ | kein Lese-Intent (bleibt Schreibpfad) |

Entscheidungen:

- **Nur Filter, die die Route wirklich hat.** `/api/v1/communication/threads` kennt `status`, `priority`,
  `needsReply`, `hasDraft`, `q`. „Ungelesen“ ist keiner davon — deshalb Rückfrage statt eines clientseitigen Filters auf
  einer gekürzten Seite, der falsche Vollständigkeit vortäuschen würde.
- **Kein Nachrichtentext in der Antwort.** Gerendert werden Kennung, Kanal, Status, Betreff und Zeitstempel. Der Test
  prüft das gegen echte Seed-Texte („Guten Tag Frau Becker …“, Zusammenfassung) und schlägt fehl, wenn sie auftauchen.
- Quelle: `registry.getPort("communication").listThreads(...)`, Rolle `viewer`, `limit: 5`.
- Schreibverben („antworte“, „archiviere“, „markiere“) führen zur Rückfrage, nicht zu einer stillen Leseantwort.

## Nachweise

```
vitest apps/control-api/src/services/communication-read-intent.test.ts  -> 4 bestanden
vitest apps/control-api/test/read-communication.test.ts                 -> 4 bestanden
node scripts/finalization/build-voice-parity.mjs --check                -> Kommunikation: lesen + schreiben
pnpm typecheck                                                          -> gruen
```

Der Integrationstest vergleicht gegen die Route: ungefilterte Liste, `status=open` (und `replied` darf nicht
auftauchen), `needsReply=true` (und `needsReply=false` darf nicht auftauchen). Damit ist belegt, dass Sprache und
Oberfläche dieselbe Quelle und dieselbe Filtersemantik nutzen.

## Was an 18.03 offen bleibt

- Lesepfade für Memory, Dateien, Agenten, Automationen und Recherche fehlen weiterhin.
- Skills, Studio, System, Onboarding, Standort/Wetter: kein Sprachweg.
- Kalender nur heute/morgen; Unterhaltungen ohne Zeitraum- und Ungelesen-Filter (jeweils benannte Rückfrage).
- Persistenz- und Fehlerfallspalte sind noch nicht je Funktion belegt.