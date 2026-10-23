# DASH-17.05 — Recovery der Automationen (2026-10-23)

**Status:** PASS. Drei Recovery-Eigenschaften sind belegt: ein defekter Job reißt die anderen nicht mit, ein Auslösen mit
unbekanntem Ausgang wird nicht blind wiederholt, und eine frühere Konfiguration ist wiederherstellbar.

## 1. Schadhaftes Scheduling bleibt lokal

`listAutomations` bildet jetzt **pro Job** ab. Ein unlesbarer Eintrag wird übersprungen, mit ID und Grund im Log
vermerkt, und die übrigen Automationen bleiben nutzbar. Ist **kein** Eintrag lesbar, meldet der Adapter den Defekt
(`INTERNAL` mit der Liste der betroffenen IDs) statt einen stillen leeren Erfolg — sonst sähe die Oberfläche „keine
Automationen" statt „Daten kaputt".

Belege (`adapters/hermes/test/automations.test.ts`):

| Test | Aussage |
| --- | --- |
| `skips an unreadable job and keeps the other automations usable` | ein `null`-Eintrag im Job-Store → Liste enthält nur die gesunde Automation, `getAutomation` auf sie funktioniert |
| `reports the defect instead of an empty list when no automation is readable` | nur defekte Einträge → `INTERNAL` mit `broken` in den Details, kein leerer Erfolg |

## 2. Unbekannter Ausgang wird nicht wiederholt

`POST /api/cron/jobs/{id}/trigger` läuft mit **genau einem Versuch** (`retry: false` im Cron-Client). Läuft die Antwort in
den Timeout, ist der Ausgang unbekannt; ein zweiter Aufruf könnte dieselbe Automation doppelt starten. Der Adapter
meldet `ADAPTER_TIMEOUT`/`ADAPTER_UNAVAILABLE` und behauptet keinen Erfolg.

Beleg: `reports an unknown trigger outcome once and never repeats the external action` — der Fake antwortet erst nach
1 200 ms, der Client bricht nach 250 ms ab; `cronTriggerAttempts` steht danach auf **1**.

## 3. Frühere Konfiguration wiederherstellbar

Die Version einer Automation ist ein Fingerabdruck ihrer Konfiguration (`id`, Zeitplan, Name, `enabled`, Laufzähler).
Wer die vorher gelesenen Werte erneut schreibt, bekommt **dieselbe Version** zurück — ohne dass F.R.I.D.A.Y. eine eigene
Versionshistorie erfindet (Hermes führt keine).

Belege:

| Test | Aussage |
| --- | --- |
| `restores the previous configuration by reapplying it` (Adapter) | ändern → andere Version; zurückschreiben → wieder die Ausgangsversion |
| `restores an earlier configuration over the real API` (live, Hermes 0.22.2) | `PATCH 10 5 * * *` → `PATCH 20 6 * * *` (andere Version) → `PATCH 10 5 * * *` (Ausgangsversion wieder identisch) |

## 4. Nachweise

```
vitest adapters/hermes/test/automations.test.ts        12 bestanden
vitest apps/control-api/test/automations-live-hermes    3 bestanden (18,6 s)
vitest adapters/hermes                                  205 bestanden, 4 uebersprungen
pnpm typecheck / pnpm lint                              bestanden (0 Fehler)
```

## 5. Grenzen

- **Kein Löschen:** Der Contract bietet kein `DELETE /api/v1/automations/{id}`; Recovery heißt deaktivieren und die
  Automation in Hermes entfernen. Bewusst nicht erfunden.
- **Keine automatische Reparatur:** Ein defekter Job wird übersprungen, nicht stillschweigend umgeschrieben. Wer ihn
  reparieren will, ändert ihn in Hermes oder schreibt eine gültige Konfiguration über die API.
- **Wiederherstellung braucht die alten Werte:** Sie kommen aus der zuletzt gelesenen Automation (oder dem Audit-Eintrag
  der Änderung). F.R.I.D.A.Y. führt keine Konfigurationshistorie — das ist die dokumentierte Grenze, keine Behauptung.