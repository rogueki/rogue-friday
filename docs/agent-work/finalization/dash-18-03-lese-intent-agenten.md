# DASH-18.03 (Teil 4) — Agentenabfrage per Sprache (2026-10-23)

## Lücke

Agenten hatten nur schreibende Intents (`agent.assign`, `agent.pause`, `agent.resume`, `agent.stop`, `codingrun.stop`).
„Zeige meine laufenden Agenten“ fiel in den Freitextpfad.

## Änderung

Die Lesefamilie `agents` in `read-query-intent.ts`:

| Frageform | Ergebnis |
|---|---|
| „zeige meine agenten“ | `agents.list` ohne Filter |
| „zeige laufende agenten“ | Status `working` |
| „welche agenten sind pausiert“ | Status `paused` |
| „zeige agenten mit fehlern“ | Status `error` |
| „zeige offline agenten“ | Status `offline` |
| „zeige aktive agenten“ | Status `idle, starting, working, waiting` |
| „zeige agent agent_…“ | `agents.get` |
| „laufende und pausierte agenten“ | Rückfrage: genau ein Status |
| „zeige agenten und stoppe den ersten“ | Rückfrage: Lesen und Ändern gemischt |
| „pausierten agenten agent_…“ | Rückfrage: Kennung plus Statusfilter |

Entscheidungen:

- **„aktiv“ ist eine Menge, kein Einzelstatus.** Aktiv heißt hier: nicht pausiert, nicht offline, nicht fehlerhaft —
  dieselbe Denkweise wie „offene Aufgaben“. Die Wortformen je Status stehen in `AGENT_STATUS_WORDS`, damit
  „laufende/laufenden/pausierte/fehlerhafte“ nicht an einer fehlenden Flexion scheitern.
- Quelle: `registry.getPort("agents").listAgents({ limit: 5, status? })`, Rolle `viewer` — derselbe Port wie
  `GET /api/v1/agents`.
- Einzelabfrage rendert Name, Status, Modell und ggf. den letzten Fehler — keine Konfiguration, keine Secrets.

## Nachweise

```
vitest apps/control-api/src/services/agent-read-intent.test.ts  -> 4 bestanden
vitest apps/control-api/test/read-agents.test.ts                -> 4 bestanden
node scripts/finalization/build-voice-parity.mjs --check        -> Agenten: lesen + schreiben
pnpm typecheck / pnpm lint                                      -> gruen / 0 Fehler
```

Der Integrationstest vergleicht gegen die Route: ungefilterte Liste, `status=working` (und `idle` darf nicht
auftauchen), „aktive Agenten“ als Mengengleichheit mit `status=idle&status=starting&status=working&status=waiting`
(und pausierte dürfen nicht enthalten sein), Einzelabfrage über die Kennung.

## Was an 18.03 offen bleibt

- Lesepfade für Memory, Dateien, Automationen und Recherche fehlen weiterhin.
- Skills, Studio, System, Onboarding, Standort/Wetter: kein Sprachweg.
- Kalender nur heute/morgen; Unterhaltungen ohne Zeitraum- und Ungelesen-Filter (jeweils benannte Rückfrage).
- Persistenz- und Fehlerfallspalte sind noch nicht je Funktion belegt.