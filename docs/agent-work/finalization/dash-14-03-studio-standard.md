# DASH-14.03 — Studio standardmäßig ausliefern, ohne Zugang ehrlich bleiben

**Datum:** 2026-10-23 · **Status:** PASS (Build-, Test- und Laufzeitnachweis)

## 1. Was geprüft wurde

| Anforderung | Nachweis |
| --- | --- |
| Studio standardmäßig bauen/installieren | `pnpm build` erzeugt `apps/web/out/content-studio.html` (11 915 B) und den Routenordner `out/content-studio/`; keine manuelle Auswahl nötig |
| Menü standardmäßig freischalten | `ui.contentStudio` ist per Vorgabe `true` (`packages/config` Test „contentStudio default"), live `GET /api/v1/settings` → `dashboard.contentStudioEnabled: true` |
| Individuelle Navigationspräferenz bei Upgrade achten | `orderNavPages` übernimmt die gespeicherte Reihenfolge, hängt unbekannte Seiten an, respektiert `navigation.hidden` und hält Einstellungen erreichbar; Tests: „keeps a stored order and appends pages the stored order does not know yet", „hides what the operator hid but keeps the settings page reachable", „shows the studio only while the feature switch is on" |
| Zugang fehlt → geführte Einrichtung statt Mockproduktion | `ContentStudioKeysArea` (Einstellungen) führt kie.ai und ElevenLabs mit Zweck, Env-Name und Kostenhinweis; ohne Schlüssel antwortet die API ehrlich: `503 ADAPTER_UNAVAILABLE "kie ist nicht konfiguriert."` bzw. `"elevenlabs ist nicht konfiguriert."` |
| Providerjobs mit echtem Output/Datei/Persistenz | `content_studio_jobs` speichert Auftrag mit Anfrage-Hash, Provider-Task-ID, Zustand und Ergebnis-URL; `content-studio-production.test.ts` belegt den durchgehenden Auftrag inklusive autorisiertem Artefakt-Download, Idempotenz, Abbruch und „kein zweiter bezahlter Aufruf nach unklarem Netzausgang" (7 Tests) |
| Fehler-/Quota-/Kosteninformation | `429` wird zu `RATE_LIMITED`, Zeitüberschreitung zu `ADAPTER_TIMEOUT` mit Hinweis auf die Auftrags-ID; `creditsConsumed` aus kie.ai wird in der Oberfläche angezeigt, wo der Anbieter es liefert |

## 2. Laufzeitnachweis

`scripts/finalization/live-studio-access-proof.mjs` gegen die gebaute API mit echtem Datenwurzelverzeichnis:

```
build artefact apps/web/out/content-studio.html: present (11915 B)
login 200, csrf present
studio switch default: true
media job without provider key: HTTP 503 - ADAPTER_UNAVAILABLE kie ist nicht konfiguriert.
speech without provider key: HTTP 503 - ADAPTER_UNAVAILABLE elevenlabs ist nicht konfiguriert.
unknown production job: HTTP 404 - NOT_FOUND Produktionsauftrag … wurde nicht gefunden.
```

Ohne Zugang entsteht also weder ein Platzhalterbild noch ein erfundener Auftrag — der Zustand wird benannt.

## 3. Bewusste Grenze

Ein echter, bezahlter Produktionslauf wurde **nicht** ausgelöst (DASH-14.05 verlangt ausdrücklich „kein heimlicher
kostenpflichtiger Testlauf"). Der Nachweis der Providerkette stammt aus dem kontrollierten Test mit lokalem
Provider-Stub und dem persistierten Auftragsmodell, nicht aus einer Rechnung.

## 4. Belege

- Tests: `apps/web/src/features/shell/navModel.test.tsx` (4), `apps/control-api/test/content-studio-production.test.ts` (7),
  `apps/web/src/features/content-studio/*` (11), `apps/control-api/test/content-studio-*.test.ts` (18).
- Konfiguration: `packages/config` (`contentStudio` default), `packages/contracts/schemas/settings/navigation-settings.schema.json`.
- Laufzeit: `scripts/finalization/live-studio-access-proof.mjs`.
