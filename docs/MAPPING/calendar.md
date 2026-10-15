# Mapping: CalDAV / ICS -> Calendar

Zielpaket: `adapters/calendar-placeholder` (Provider `caldav-calendar`, Kategorie `calendar`).

## Quellen

| `sourceType` | Zugriff                                                                                                                                     | Mögliche Capabilities                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ics`        | HTTP-GET der ICS-Abo-URL (ggf. Token in der URL = Secret)                                                                                   | `calendar.read`                                                                                             |
| `caldav`     | CalDAV (`REPORT calendar-query`/`calendar-multiget`, `PROPFIND`, `PUT`/`DELETE` für Schreiben), Basic-Auth `username` + `password` (Secret) | `calendar.read`, später `calendar.propose` (Entwurf), `calendar.create/reschedule/cancel` nur über Freigabe |

Schreibende Änderungen eines Termins (verschieben, absagen, einladen) sind Tier-2/3-Aktionen: `createCalendarProposal` erzeugt einen
`CalendarProposal` mit `approvalId`; erst nach `approveApproval` führt der Adapter `PUT`/`DELETE` aus.

## Felder

| iCalendar (VEVENT)                    | `CalendarEvent`                                  | Regel                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UID` (+ `RECURRENCE-ID`)             | `id`, `source.externalId`                        | `createIdCodec("cal")`; Instanz einer Serie = `UID#RECURRENCE-ID`                                                                                                 |
| `SEQUENCE`                            | `version`                                        | Start 1                                                                                                                                                           |
| `CREATED` / `LAST-MODIFIED`           | `createdAt` / `updatedAt`                        | UTC                                                                                                                                                               |
| `SUMMARY`                             | `title`                                          |                                                                                                                                                                   |
| `DESCRIPTION`                         | `description`                                    |                                                                                                                                                                   |
| `DTSTART` / `DTEND` (bzw. `DURATION`) | `start` / `end`                                  | in UTC umgerechnet; `TZID` -> `timeZone`                                                                                                                          |
| `VALUE=DATE`                          | `allDay = true`                                  | `end` exklusiv wie in iCal                                                                                                                                        |
| `LOCATION`                            | `location`                                       |                                                                                                                                                                   |
| `ATTENDEE` / `ORGANIZER` (`PARTSTAT`) | `attendees[]`                                    | `Attendee {name, email?, response}`; `PARTSTAT`: `ACCEPTED` -> `accepted`, `DECLINED` -> `declined`, `TENTATIVE` -> `tentative`, `NEEDS-ACTION` -> `needs_action` |
| `STATUS`                              | `status`                                         | `CONFIRMED` -> `confirmed`, `TENTATIVE` -> `tentative`, `CANCELLED` -> `cancelled`                                                                                |
| `VALARM` (`TRIGGER`)                  | `reminderMinutes[]`                              | negative Trigger in Minuten                                                                                                                                       |
| `RRULE` / `EXDATE`                    | (expandiert)                                     | Serie wird im Zeitfenster `from..to` zu Einzelinstanzen expandiert; `lookaheadDays` begrenzt                                                                      |
| (berechnet)                           | `conflictIds`                                    | Überschneidung zweier `confirmed`/`tentative` Termine                                                                                                             |
| (Hermes)                              | `linkedTaskIds`, `linkedThreadIds`, `briefingId` | nicht Teil des Kalenders; Verknüpfungen hält die Control API                                                                                                      |

## Konflikte und Briefings

`CalendarConflict` entsteht im Adapter aus überlappenden Terminen (`kind = overlap`, beteiligte `eventIds`) -> `friday.calendar.conflict_detected`.
`CalendarBriefing` ist Agentenausgabe (Hermes), nicht Kalenderdaten; `listCalendarBriefings` bleibt bis zur Hermes-Anbindung leer (gültige leere Seite).

## Synchronisation und Ereignisse

CalDAV: `ctag`/`getctag` und `sync-token` (RFC 6578) für inkrementelle Abfragen; ICS: `ETag`/`Last-Modified` (`If-None-Match`).
Änderungen -> `friday.calendar.event_updated`. `freshness.asOf` = Zeitpunkt des letzten erfolgreichen Syncs; bei Fehlern `stale`/`offline-cache`
(nie veraltete Daten als live ausgeben).

## Fehler

401/403 -> `UNAUTHENTICATED`/`FORBIDDEN`; 404 (Kalender weg) -> `NOT_FOUND`; 412 (ETag) -> `CONFLICT`; 5xx/Timeout -> `ADAPTER_UNAVAILABLE`/`ADAPTER_TIMEOUT`;
ungültiges ICS (Parser) -> `VALIDATION_FAILED`.
