# Mapping: CalDAV / ICS -> Calendar

Vollständige Feldtabellen: [`docs/MAPPING/calendar.md`](../../docs/MAPPING/calendar.md).

| Feld                                                | Standard        | Bedeutung                                                       |
| --------------------------------------------------- | --------------- | --------------------------------------------------------------- |
| `sourceType`                                        | `caldav`        | `caldav` (lesen/schreiben nach Freigabe) oder `ics` (nur lesen) |
| `url`                                               | -               | Kalender-URL bzw. ICS-Feed                                      |
| `username` / `password`                             | - / Secret      | Basic-Auth für CalDAV                                           |
| `timezone`                                          | `Europe/Berlin` | Anzeige-Zeitzone                                                |
| `syncIntervalSeconds`, `lookaheadDays`, `timeoutMs` | 300, 60, 15 000 |                                                                 |

Solange `url` fehlt: `offline` / "Nicht konfiguriert".
