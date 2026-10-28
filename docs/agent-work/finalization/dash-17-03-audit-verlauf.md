# DASH-17.03 — Audit, Alarme und Verlauf aus echten Ereignissen (2026-10-23)

**Status:** PASS. Der Audit-Verlauf liest jetzt die dauerhafte Hash-Kette statt eines Adapters, der Export ist
redigiert, die Rollen sind getrennt und Alarme entstehen nur aus einer echten Quelle.

## 1. Der Befund, der die Aufgabe ausgelöst hat

`GET /api/v1/audit/events`, `…/events/{id}` und `…/audit/export` wurden vom Audit-**Adapter** beantwortet. Im
Testbetrieb war das `mock-audit` mit 80 Fixtures: der Export enthielt ausschließlich erfundene Ereignisse, während der
echte, hashverkettete Verlauf (`audit_log`) unsichtbar blieb. Im Live-Betrieb existiert kein Audit-Adapter — dort wäre
die Audit-Ansicht schlicht nicht erreichbar gewesen.

Belegt durch den Vorher-Lauf: `record()` schrieb eine Zeile in `audit_log` (Anzahl 1 → 2), der Export enthielt danach
weiterhin nur Sequenz 1–80 aus dem Fixture-Satz, das neue Ereignis fehlte.

## 2. Was jetzt gilt

| Bereich | Umsetzung | Beleg |
| --- | --- | --- |
| Quelle | `services/audit-trail.ts` liest `audit_log` (Seq, JSON, `prev_hash`, `hash`); Route **und** Sprach-Lesebefehl nutzen dieselbe Funktion | `read-command-intents` vergleicht Direktaufruf und Kommandopfad zeilengleich |
| Quelle/Korrelations-ID | jedes zurückgegebene Ereignis trägt `source` und `correlationId` aus dem gespeicherten Datensatz | `audit.test.ts` (Actor/Action/Result/Correlation), neuer Export-Test |
| Keine Secrets/QR/Embeddings | `services/audit-redaction.ts` ersetzt Werte von `password`, `token`, `apiKey`, `authorization`, `cookie`, `otp` … durch `[redigiert]` und entfernt `qr*`/`embedding`/`voiceprint`-Felder | Unit-Tests + Export-Test: der Klartext-Secret steht **nicht** im Export, wohl aber unverändert in der Datenbank |
| Kette bleibt prüfbar | Redaktion passiert nur beim Export; gespeicherte Zeilen und Hashes bleiben unangetastet | `audit.verifyNow().valid === true` nach dem Export |
| Rollen | Liste/Detail `viewer`, Export `owner`; Operator und Viewer erhalten 403 | `keeps the export owner-only` |
| Aufbewahrung | bestehende Archiv-/Ankerlogik (`audit-archive`, `audit-anchor`) unverändert; Truncation-Erkennung deckt Löschungen auf | `audit-anchor-migration`, `audit.test.ts` (Tail-Truncation) |
| Keine erfundenen Alarme | die Übersicht zeigt `kind: "alert"` nur, wenn eine Notifications-Quelle P0/P1 liefert; ohne Quelle bleibt die Liste leer | `shows alerts only when a real notification source delivers them` |

## 3. Nachweise

```
vitest apps/control-api/test/audit-governance.test.ts     5 bestanden
vitest apps/control-api/test/audit.test.ts               25 bestanden
vitest apps/control-api/test/read-command-intents.test.ts  7 bestanden
vitest apps/control-api/test/contract.test.ts            30 bestanden
pnpm --filter @friday/control-api typecheck              bestanden
pnpm lint                                                0 Fehler (3 bestehende Warnungen)
```

## 4. Grenzen

- **Redaktion ist eine Ausgangskontrolle, keine Reparatur.** Was versehentlich in die Kette geschrieben wurde, bleibt dort
  (die Kette lässt sich nicht rückwirkend ändern, ohne sie ungültig zu machen). Der Export zeigt `[redigiert]`, nicht den
  Wert — und der Vorfall wäre über den Marker sichtbar.
- **Filterumfang:** unterstützt werden `from`/`to`, `actor`, `agentId`, `taskId`, `tool`, `adapterId`, `action`-Präfix,
  `category`, `severity`, `result`, `cursor`, `limit` — genau die Parameter, die der Contract für die Operation nennt.
- **Reihenfolge:** neueste zuerst (`ORDER BY seq DESC`), Cursor `s<offset>`; die Oberfläche muss nicht nachsortieren.
- **Alarme ohne Quelle:** Solange keine Notifications-Anbindung konfiguriert ist, gibt es keine Alarme. Das ist die
  ehrliche Anzeige, keine Lücke im UI.