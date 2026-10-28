# DASH-14.05 / 14.06 — Studio-Abnahme und Recovery

**Datum:** 2026-10-23 · **Status:** beide PASS

## 1. Neue Zielinstallation (14.05)

Der Installer baut das Command Center selbst; ein manueller Checkout ist nicht nötig:

- `installer/install-friday.ps1` ruft im Dashboard-Schritt `pnpm build:app` auf (`--filter @friday/web --filter
  @friday/control-api`) und bricht ab, wenn `apps/control-api/dist/main.js` fehlt (Zeilen 2668–2673).
- `pnpm build:app` baut `@friday/web`; der Web-Build enthält die Studio-Route (`apps/web/out/content-studio.html`,
  11 915 B) und den Routenordner. Das Menü zeigt die Seite per Vorgabe (`ui.contentStudio: true`), siehe DASH-14.03.

## 2. Plan und Medienjobs überleben den Neustart (14.05)

Neuer Test `apps/control-api/test/content-studio-restart.test.ts` startet die API **zweimal auf demselben
Datenwurzelverzeichnis**:

| Schritt | Ergebnis |
| --- | --- |
| Lauf 1: Plan speichern, Produktionsauftrag anlegen, Auftrag abschließen | Plan-Revision 1, Auftrag `completed`, `artifactReady: true` |
| API schließen, neu starten | — |
| Lauf 2: Plan lesen | Revision 1, Idee `restart-idea` vorhanden |
| Lauf 2: Auftragszeile lesen | genau eine Zeile, `state: completed`, `providerTaskId: restart-task` |
| Lauf 2: Artefakt laden | HTTP 200, Bytes `restart-mp4` (identisch zum Lauf davor) |

Ergänzend live (`scripts/finalization/live-studio-restart-proof.mjs`, echte API mit `dataMode: live`):
Plan-Revision 3 blieb über einen Prozessneustart identisch (Inhalt und Posting), und ein Produktionsauftrag ohne
Anbieterschlüssel endet mit **503**, ohne eine Phantomzeile anzulegen (unbekannte ID → 404).

## 3. Kontrollierte Generierung liefert ein abrufbares Artefakt (14.05)

`content-studio-production.test.ts` belegt den durchgehenden Auftrag: Kie-Anfrage → ElevenLabs → Schnitt → Download
über `GET /production-jobs/{id}/artifact` mit `video/mp4`; ohne Sitzung **401**. Genau ein bezahlter Aufruf pro
Auftrag (`createTask` und `text-to-speech` je 1). Ein echter bezahlter Lauf wurde nicht ausgelöst — die Providerkette
läuft im Test gegen einen Stub, die Schlüssel sind Wegwerfwerte („restart-kie").

## 4. Rücksetzbare Integration ohne Datenverlust (14.06)

Live: `contentStudioEnabled: false` → Plan-Endpunkt **403**, aber der Plan bleibt gespeichert; nach dem Wiedereinschalten
liefert `GET /plan` dieselbe Revision mit Inhalt und Posting. Die Integration ist also abschaltbar, ohne Nutzermedien
oder Plan zu verlieren.

## 5. Unklarer Produktionsausgang wird abgeglichen statt dupliziert (14.06)

- Der Auftrag wird über `Idempotency-Key` und `request_hash` eindeutig identifiziert; ein Replay liefert denselben
  Auftrag, ein abweichender Hash wird mit **409** abgelehnt.
- Nach einem unklaren Netzausgang bleibt der Auftrag in `provider_unknown`/`speech_unknown`; der Test „does not repeat a
  paid submission after an unknown network outcome" belegt, dass kein zweiter bezahlter Aufruf erfolgt.
- `cancel` beendet nur Aufträge, die noch nicht abgeschlossen sind; abgeschlossene Aufträge und Artefakte bleiben
  unangetastet.

## 6. Belege

- Tests: `content-studio-restart.test.ts` (1), `content-studio-production.test.ts` (7), `content-studio-plan.test.ts`,
  `content-studio-media.test.ts`, `content-studio-keys.test.ts`, `content-studio-providers.test.ts`.
- Live: `scripts/finalization/live-studio-restart-proof.mjs`, `live-studio-access-proof.mjs`.
- Installer: `installer/install-friday.ps1` (Dashboard-Build), `installer/tests/dashboard-update-progress.Tests.ps1`.
