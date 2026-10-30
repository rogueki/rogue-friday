# DASH-18.03 (Teil 7) — Dateiabfrage per Sprache (2026-10-30)

## Lücke

Dateien hatten per Sprache nur Schreibwege (`file.rename`, `file.delete`). „Zeige meine Dateien“ fiel in den
Freitextpfad, obwohl `GET /api/v1/files` existiert. Die Paritätsmatrix führte Dateien als „nur schreiben“.

## Änderung

Die Lesefamilie `files` in `read-query-intent.ts`:

| Frageform | Ergebnis |
|---|---|
| „zeige meine dateien“, „welche dokumente habe ich“ | `files.list` ohne Filter |
| „zeige hochgeladene dateien“, „zeige rechnungen bei den dateien“ | Kategorie `uploaded` bzw. `invoices` |
| „zeige berichte und präsentationen in den dateien“ | Kategorien `reports`, `presentations` |
| „zeige datei file_…“ | `files.get` |
| „suche die datei angebot“ | Rückfrage: keine Namenssuche, Kategorie oder Kennung nennen |
| „zeige rechnungen datei file_…“ | Rückfrage: Kennung plus Filter |
| „zeige dateien und lösche die erste“ | Rückfrage: Lesen und Ändern gemischt |
| „zeige meine dateien und aufgaben“ | Rückfrage: zwei Bereiche |

Entscheidungen:

- Quelle: `registry.getPort("files").listFiles({ limit: 5, category? })` bzw. `getFile`, Rolle `viewer` — derselbe
  Port wie `GET /api/v1/files`.
- Kategorien nur aus der festen Wortliste `FILE_CATEGORY_WORDS` (acht Vertragswerte); Freitext wird nie als `q` an den
  Adapter gegeben, darum ist die Namenssuche eine benannte Rückfrage.
- Einzelabfrage nennt Name, Kategorie, Größe, Version und Änderungszeit, keinen Inhalt.
- Schreibsätze („lösche die datei …“, „benenne die datei … um in …“) erreichen den Lesepfad nicht.

## Nachweise

```
vitest apps/control-api/src/services/files-read-intent.test.ts  -> 4 bestanden
vitest apps/control-api/test/read-files.test.ts                 -> 4 bestanden (Gegenprobe ohne Parser: 7 von 8 rot)
node scripts/finalization/build-voice-parity.mjs --check        -> Dateien: lesen + schreiben
pnpm typecheck / eslint                                         -> gruen / 0 Fehler
```

Der Integrationstest vergleicht gegen die Route: ungefilterte Liste, Kategorie wie `GET /api/v1/files?category=…`
(Dateien anderer Kategorien dürfen nicht genannt werden) und Einzelabfrage über die Kennung.

## Was an 18.03 offen bleibt

- Skills, Studio (außer Plan), System, Onboarding, Standort/Wetter: kein Sprach-Leseweg.
- Kalender nur heute/morgen; Unterhaltungen ohne Zeitraum- und Ungelesen-Filter (jeweils benannte Rückfrage).
- Persistenz- und Fehlerfallspalte sind noch nicht je Funktion belegt.
