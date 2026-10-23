# DASH-14.04 — Veröffentlichung und Status „gepostet" trennen

**Datum:** 2026-10-23 · **Status:** PASS (Abnahme mit echtem API-Lauf)

## 1. Ausgangsbefund

Das Content Studio führte genau ein Statusfeld mit den Werten `geplant`, `gepostet`, `verpasst`. Der Wechsel auf
`gepostet` war an zwei Stellen direkt möglich:

- Kachel im Postingkalender (`PostingCalendar.tsx`, Titel „Veröffentlichungsstatus manuell zwischen geplant und gepostet
  wechseln"),
- Auswahlfeld „Status" in der Postingliste (`ContentStudioPage.tsx`, Option „Gepostet"),

und über den Sprach-/Textbefehl `Set status of posting "…" on … to posted` (`settings-content-mutation-intent.ts`).
Ein angebundener Publisher existiert nicht: `LinkedIn`, `Instagram`, `Facebook`, `TikTok`, `YouTube` sind reine Labels,
kein Adapter versendet Beiträge. Damit behauptete die Oberfläche eine externe Veröffentlichung, die nie stattfand
(Ledger **N-072**).

## 2. Entscheidung

`gepostet` bleibt als Status erhalten (kein Breaking Change am Enum), bekommt aber eine **Herkunftsangabe**:

```json
"veroeffentlichung": { "art": "manuell" | "bestaetigt", "am": "<date-time>", "quelle": "<1..60 Zeichen>" }
```

Regeln, die der Planparser (`parseStudioPlan`, einzige Validierungsstelle für den Plan) durchsetzt:

| Fall | Ergebnis |
| --- | --- |
| `status=gepostet` ohne `veroeffentlichung` | 422 „… ein Posting mit status=gepostet braucht veroeffentlichung." |
| `art=bestaetigt` mit `quelle=manuell` | 422 „… art=bestaetigt braucht eine Publisher-Quelle, nicht quelle=manuell." |
| `art` unbekannt, `am` kein Zeitpunkt, `quelle` leer/zu lang | 422 mit jeweils eigenem Grund |
| `veroeffentlichung` ohne `status=gepostet` | 422 „… nur bei status=gepostet erlaubt." |
| `art=manuell` mit Zeitpunkt und Quelle | 200, wird gespeichert |

Beide manuellen Pfade (Kalenderkachel, Auswahlfeld) laufen jetzt über eine Funktion, die die Herkunft mitschreibt; der
Textbefehl tut dasselbe auf dem Server. Beschriftung: **„Manuell markiert"** statt „Gepostet", mit Hinweis, dass kein
Publisher angebunden ist und die Veröffentlichung nicht extern bestätigt wird. Eine bestätigte Veröffentlichung ist damit
eine offene Implementierung (Publisher-Adapter), kein erfolgreicher Knopf.

## 3. Laufzeitnachweis

`scripts/finalization/live-studio-publication-proof.mjs` gegen die gebaute API mit echtem Datenwurzelverzeichnis:

| Aufruf | Ergebnis |
| --- | --- |
| `PUT /api/v1/content-studio/plan` mit `status=gepostet` ohne Herkunft | **422** „… ein Posting mit status=gepostet braucht veroeffentlichung." |
| dasselbe mit `art=bestaetigt`, `quelle=manuell` | **422** „… art=bestaetigt braucht eine Publisher-Quelle, nicht quelle=manuell." |
| dasselbe mit `art=manuell`, Zeitpunkt, Quelle | **200**, Revision erhöht |
| Readback `GET /api/v1/content-studio/plan` | `status=gepostet`, `veroeffentlichung.art=manuell`, `quelle=manuell` |

## 4. Belege

- Tests: `apps/web/src/features/content-studio/plan.test.ts` (Herkunftsregel, fünf Fälle),
  `ContentStudioPage.test.tsx` (Beschriftung, gespeicherte Herkunft),
  `apps/control-api/test/settings-content-mutation.test.ts` (Textbefehl schreibt die Herkunft).
- Suiten: web content-studio 11/11, node content/settings-content 61/61, `contracts:check` (breaking ok, additiv),
  `typecheck`, `lint`, `build`.
- Vertrag: `packages/contracts/schemas/content-studio/plan-document.schema.json` (+ generierte Typen in
  `packages/generated-sdk/src/generated/models.ts`).

## 5. Offen

Ein echter Publisher (Auth, Rechte, Bestätigung je Netzwerk) bleibt eine eigene Implementierung; bis dahin ist
`art=bestaetigt` nur über einen künftigen Adapter erreichbar und nicht über die Oberfläche.
