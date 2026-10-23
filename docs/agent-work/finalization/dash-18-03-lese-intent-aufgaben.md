# DASH-18.03 (Teil) — Lese-Intent für Aufgaben (2026-10-23)

## Lücke

DASH-18.01 hat sie nachgewiesen: für Aufgaben gab es nur Schreib-Intents. „Zeige meine offenen Aufgaben“ fiel durch
alle Parser und lief über `executeCommand` in den Freitextpfad — im Live-Betrieb also in eine Modellantwort, die
niemand gegen die Daten geprüft hat.

## Änderung

`apps/control-api/src/services/read-query-intent.ts` kennt jetzt die Familie `tasks`:

| Frageform | Ergebnis |
|---|---|
| „zeige meine offenen aufgaben“ | `tasks.list`, Status `todo, ready, running, waiting, review` |
| „zeige meine aufgaben“ | `tasks.list` **ohne** Statusfilter (zeigt den echten Stand, rät nichts) |
| „zeige laufende / fehlgeschlagene / erledigte / wartende aufgaben“ | `tasks.list` mit genau einem Status |
| „zeige aufgabe task_…“ | `tasks.get` |
| „zeige aufgabe act_…“ (fremde Kennung) | Rückfrage |
| „zeige aufgaben und lösche die erste“ | Rückfrage (Lesen und Ändern gemischt) |
| „zeige genehmigte aufgaben“ (Status gibt es nicht) | Rückfrage |
| „Trage Zahnarzt als Aufgabe ein“ | kein Lese-Intent (bleibt Anlagepfad) |

Entscheidungen, die im Code stehen und hier begründet sind:

- **„offen“ ist eine Menge, kein Einzelstatus.** Offen heißt „nicht abgeschlossen“: `todo, ready, running, waiting,
  review`. `done`, `failed`, `cancelled` sind ausgeschlossen. Ein explizit genannter Status bleibt eins zu eins.
- **Kein Statuswort, kein Filter.** Lieber alle Aufgaben zeigen als einen Filter erfinden.
- **Rollen:** `read:tasks` mit mindestens `viewer` — dieselbe Schwelle wie `GET /api/v1/tasks`.
- **Quelle:** `registry.getPort("tasks").listTasks` mit `limit: 5`, `sort: "priority"` — derselbe Port wie die Route.
  Kein eigener Datenpfad, keine Beispieldaten.
- **Fremder Status → Rückfrage.** Der Parser prüft weiterhin gegen die Whitelist; „genehmigt“ ist bei Aufgaben kein
  Status und wird nicht stillschweigend ignoriert.
- Die Wortliste akzeptiert jetzt auch `meine/meinen/mein/my` sowie die deutschen Flexionen `offenen, laufenden,
  wartenden, erledigten, abgebrochenen, abgeschlossenen`. Das entspannt nebenbei die bestehenden Lesebereiche, ohne
  deren Statuszuordnung zu verändern (der bestehende Parser-Test deckt alle Familien weiter ab).

## Nachweise

```
vitest apps/control-api/test/read-tasks.test.ts                     -> 3 bestanden
vitest apps/control-api/src/services/task-read-intent.test.ts       -> 6 bestanden
vitest apps/control-api/src/services/read-query-intent.test.ts      -> 5 bestanden (angepasst: tasks-Spalte)
node scripts/finalization/build-voice-parity.mjs --check            -> Matrix aktuell, Aufgaben: lesen + schreiben
vitest --project node --maxWorkers=1 (Gesamtsuite)                  -> 213 Dateien, 2878 Tests bestanden, 60 uebersprungen
pnpm typecheck / pnpm lint                                          -> gruen / 0 Fehler
```

Ein paralleler Lauf derselben Suite hatte zwei Fehlschlaege (`messenger-inbound-routes`, `secrets`) bei 21 s bzw. 39 s
Laufzeit; seriell waren genau diese Dateien gruen, der anschliessende Serienlauf der Gesamtsuite ebenfalls. Das ist
Lastflakiness der bestehenden Tests, kein Zusammenhang mit dem Lese-Intent (die beiden Dateien fassen Aufgaben nicht an).

Der Integrationstest ist der eigentliche Beweis: er holt `GET /api/v1/tasks?limit=50&sort=priority`, filtert die
offenen Aufgaben wie die Sprachabfrage und vergleicht die Kennungen mit der Antwort des Befehls. Damit ist belegt:
Sprache und Oberfläche lesen dieselbe Quelle.

## Was an 18.03 offen bleibt

Die Aufgabe verlangt das je Funktion, nicht je Bereich. Offen sind weiterhin:

- Kalender-Lesepfad („zeige meine termine heute“) — braucht Tagesgrenzen mit Zeitzone, nicht nur einen Statusfilter.
- Kommunikation, Memory, Dateien, Agenten, Automationen, Recherche: Lesepfade fehlen (Befund aus 18.01).
- System/Skills/Studio/Onboarding/Wetter: kein Sprachweg (18.01, Abschnitt 3).
- Die Prüfspalten Persistenz und Fehlerfall sind für die bestehenden Funktionen noch nicht je Funktion belegt.

Deshalb bleibt DASH-18.03 im Plan offen und trägt nur einen TEIL-Vermerk.