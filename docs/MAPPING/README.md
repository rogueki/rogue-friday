# Mapping-Dokumente

Jedes Fremdsystem bekommt ein Dokument, das **Feld für Feld** festlegt, wie seine Objekte und Ereignisse auf die kanonischen Modelle
(`@friday/sdk`, Quelle: `packages/contracts`) abgebildet werden. Sie sind die Spezifikation für den jeweiligen Adapter und die
Grundlage der Conformance-Tests.

| Dokument                             | Fremdsystem                            | Paket                           | Status                               |
| ------------------------------------ | -------------------------------------- | ------------------------------- | ------------------------------------ |
| [example-tasks.md](example-tasks.md) | ExampleTasks REST API (fiktiv)         | `adapters/example-http`         | implementiert, Conformance bestanden |
| [hermes.md](hermes.md)               | Hermes (Aufgaben, Aktivität, Agenten)  | `adapters/hermes-placeholder`   | Platzhalter                          |
| [voice.md](voice.md)                 | lokaler Voice-Dienst `friday_voice.py` | `adapters/voice-placeholder`    | Platzhalter                          |
| [mail-gmx.md](mail-gmx.md)           | GMX IMAP/SMTP                          | `adapters/mail-placeholder`     | Platzhalter                          |
| [calendar.md](calendar.md)           | CalDAV / ICS                           | `adapters/calendar-placeholder` | Platzhalter                          |
| [system.md](system.md)               | Windows + WSL (Metriken, Dienste)      | `adapters/system-placeholder`   | Platzhalter                          |

Jedes Paket enthält zusätzlich eine kurze `MAPPING.md`, die auf das Dokument hier verweist und die Config-Felder erklärt.

## Regeln für alle Mappings

1. **Kein Source-Leak** (PLAN §10.2): Fremdfelder, Rohobjekte und Fremd-IDs erreichen weder Control API noch Frontend. Die kanonischen
   Schemas haben `additionalProperties: false`; `defineMapper` prüft jedes Ergebnis dagegen.
2. **IDs** sind opak und tragen das Präfix der Ressource (`createIdCodec`). Die Fremd-ID steht nur in `source.externalId`.
3. **Unbekannt ist `null`/leer**, nie erfunden: kein Fortschrittsprozent ohne Messwert, keine GPU-Last ohne Sensor.
4. **Zeit** immer UTC-ISO-8601; Zeitzone nur als Zusatzfeld (`timeZone`).
5. **Fehler** laufen durch `normalizeError` und tragen einen kanonischen `ErrorCode`.
6. **Secrets** nur über `AdapterContext.getSecret`; sie tauchen in keinem Mapping-Ergebnis, Log oder Event auf.
7. **Schreibende Aktionen** mit Außenwirkung (Senden, Löschen, Termin ändern) laufen über Freigaben (`Approval`), nie direkt.
8. **Keine direkten Datenbankzugriffe** auf Fremdsysteme, solange API, CLI oder Eventquelle verfügbar sind (PLAN §1.1 Nr. 17).
