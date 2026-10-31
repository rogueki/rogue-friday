# Mock-Szenarien (`@friday/mock-data`)

Die Szenarien sind Testfixtures für Vitest und den E2E-Server; im ausgelieferten Dashboard gibt es sie nicht (Entscheidung 2026-10-31).

Verbindliche Mock-Szenarien nach PLAN §44/§45. Alle Szenarien sind **deklarative Zeitleisten** (`packages/mock-data/src/scenarios/definitions.ts`):
Schritte mit einem Offset `at` (ms auf der `MockClock`) und Aktionen auf der `MockWorld`. Dieses Dokument wird aus denselben Definitionen
erzeugt, die Tests (`test/scenarios.test.ts`) prüfen die hier genannten Orb-Folgen gegen die Implementierung.

## 1. Auslösen

| Weg | Aufruf |
|---|---|
| **REST (nur E2E-/Testserver, injizierte Simulation)** | `GET /api/v1/dev/scenarios` (Liste), `POST /api/v1/dev/scenarios/{id}/play` (optional `?speed=2`), `GET /api/v1/dev/scenarios/state`, `POST /api/v1/dev/scenarios/control` mit einem `ScenarioControlRequest` |
| **TypeScript / Tests** | `const engine = ScenarioEngine.for(world); engine.play(id); engine.runToCompletion();` oder `world.clock.advance(ms)` |

`play(id, { speed, reset })` lädt zuerst das Profil des Szenarios (`default`, `empty`, `highLoad`, `longGerman`), stellt den Basis-Snapshot wieder her
(`reset: false` lässt den aktuellen Zustand stehen) und beruhigt bei `baseline: "quiet"` die Welt (offene Freigaben/Alerts, laufende Arbeit und Voice-Aktivität werden entfernt).
Anschließend werden alle Schritte als Timer auf der Mock-Uhr geplant. `speed` skaliert Schritt-Offsets und Aktionsdauern (auch Eskalationsverzögerungen).

## 2. Steuerung (`ScenarioEngine`, PLAN §44.6)

| Funktion | `ScenarioEngine` | `ScenarioControlRequest` |
|---|---|---|
| Szenario wählen/abspielen | `play(id, { speed })`, `stop()` | – (eigener Endpoint) |
| Uhr vorspulen | `advanceClock(ms)` | `{ action: "clock_advance", ms }` |
| Adapter offline | `setAdapterState(idOderKategorie, "online"\|"degraded"\|"offline"\|"recovering"\|"timeout")` | `{ action: "adapter_offline", adapterId, offline }` |
| Latenz | `setLatency(ms, adapterId?)` | `{ action: "latency", adapterId?, ms }` |
| Fehlerquote | `setErrorRate(rate, adapterId?)` | `{ action: "error_rate", adapterId?, rate }` |
| Capability schalten | `setCapability(modul, fähigkeit, bool)` | `{ action: "capability_toggle", module, capability, enabled }` |
| Event abspielen | `emitEvent({ type, subject?, data })` (Daten werden gegen das Event-Schema validiert) | – |
| Orb erzwingen | `forceOrbState(mode \| null, { activityText?, audioLevel?, progress? })` | `{ action: "force_orb_state", mode, … }` |
| Snapshot zurücksetzen | `reset()` | `{ action: "reset" }` |

`getState()` liefert den vertraglichen `ScenarioState` (aktives Szenario, Schrittindex, Seed, simulierte Zeit, Overrides).

## 3. Determinismus

- **Seed** (`MockWorldOptions.seed`, Standard 42) bestimmt alle Seed-Daten, IDs (`<prefix>_` + 26 Zeichen, pro Präfix monoton), die Fehler-Stichproben und den Latenz-Jitter (getrennte PRNG-Ströme, jeweils mulberry32).
- **Uhr:** Es gibt kein `Date.now()` im Weltzustand. Startzeit `2026-10-14T08:15:00Z` (Datum der Seed-Inhalte). Timer (Freigabe-Ablauf, Eskalationsketten, Snooze, Szenarien, Audio-Pegel) laufen ausschließlich auf der `MockClock`.
  Im Dev-Betrieb folgt die Uhr der Wanduhr (`realTime: true`), in Tests treibt `clock.advance()` sie.
- **Snapshots:** `world.snapshot()` ist reines JSON (Zustand, Uhr, ID-Zähler, PRNG-Zustände). Gleicher Seed und gleiche Aufrufreihenfolge ergeben ein byte-identisches Snapshot-JSON und identische Event-Streams (Test `deterministic`).
- **Event-Sequenzen** steigen streng monoton, auch über `reset()` hinweg; nach `reset`/`loadProfile`/`restore` wird `friday.status.resync_required` (`server_restart`) veröffentlicht und der Hub-Puffer geleert.
- **Audio-Fixtures** (`silence`, `normal`, `loud`, `tts`, `spike`) sind reine Funktionen von Zeit und Dauer (12 Hz, 83 ms Takt).

## 4. Orb-Ableitung (`deriveOrbSnapshot`)

Priorität (PLAN §18.3, ergänzt): `error` > `offline` > `waiting_approval` > `listening`/`speaking` > `transcribing`/`thinking` > `success` (kurz) > `working`/`syncing` > `paused` > `warning` > `idle`.
Niedrigere Zustände bleiben in `detailText` und `layers` sichtbar (z. B. „… · 3 Agenten arbeiten weiter“). Fortschritt wird nur gemeldet, wenn der Fokus-Task echten Fortschritt hat
(`determinate`), sonst `indeterminate` (Working/Syncing) oder `none`. `friday.orb.status_changed` wird bei jeder Änderung ausgesandt (Audiopegel zählt nicht als Änderung).
Fehler = offener P0-Alert oder Voice-Fehler; `offline` = alle Adapter offline; `warning` = offener P1-Alert oder eingeschränkter Adapter.

## 5. Weitere Profile (§45.10–§45.12)

| Profil | Inhalt |
|---|---|
| `default` | „typischer Tag“: 28 Aufgaben (alle Status), 160 Aktivitäten, 8 Agenten, 40 Memories (alle 10 Typen), 12 Freigaben (alle Typen/Tiers/Status), 14 Threads, 5 Kanäle (online, read-only, nicht konfiguriert, degraded), 16 Termine + Konflikte/Briefings, 6 Automationen mit Runs, 3 Recherche-Projekte, 22 Dateien, 10 Alerts (P1–P4), 10 Dienste, Audit-Kette |
| `empty` | keine Daten, Kanäle `not_configured`, keine Voice-Profile, alle Dienste online |
| `highLoad` | 1 000 Tasks, 10 000 Aktivitäten, 100 Agenten, 500 Audit-Ereignisse; Erzeugung ≈ 0,2 s (Budget 1,5 s) |
| `longGerman` | `default` mit sehr langen Komposita-Titeln (bis 290 Zeichen, Umlaute, ß) in Tasks, Threads, Memories, Freigaben, Terminen, Alerts, Dateien |

## 6. Szenarien

### 45.1 `clean-idle` – Clean Idle

Alles online, keine Alerts, keine Freigaben, der Orb ruht.

- **Profil:** `default`, Ausgangszustand: beruhigt (keine offenen Freigaben/Alerts, keine laufende Arbeit)
- **Dauer:** 0,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `idle`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | Alles online – Keine offenen Freigaben oder Alerts. | System-Metriken veröffentlichen | `idle` |

**UI-Erwartungen**

- Orb im Zustand BEREIT, ruhige Atmung, kein Cyan-Farbumschlag
- Topbar zeigt „F.R.I.D.A.Y. online“, Attention-Zone zeigt den Leerzustand
- Alle Adapter und Dienste grün

### 45.2 `listening` – Listening

Mikrofon aktiv, simulierte Pegel (silence, normal, loud, spike) mit 12 Hz.

- **Profil:** `default`, Ausgangszustand: beruhigt (keine offenen Freigaben/Alerts, keine laufende Arbeit)
- **Dauer:** 8,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `idle` → `listening` → `idle`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | Mikrofon öffnet – Stille, Pegel um 1 %. | Voice-Modus `listening`<br>Audio-Fixture `silence` (input, 1500 ms, 12 Hz) | `listening` |
| 1 | 1,5 s | Normale Sprache | Audio-Fixture `normal` (input, 3000 ms, 12 Hz) | `listening` |
| 2 | 4,5 s | Laute Sprache | Audio-Fixture `loud` (input, 1500 ms, 12 Hz) | `listening` |
| 3 | 6,0 s | Pegelspitze – Kurzer Spike bis 100 %. | Audio-Fixture `spike` (input, 500 ms, 12 Hz) | `listening` |
| 4 | 6,5 s | Wieder still | Audio-Fixture `silence` (input, 1500 ms, 12 Hz) | `listening` |
| 5 | 8,0 s | Mikrofon schließt | Voice-Modus `idle` | `idle` |

**UI-Erwartungen**

- Mikrofon-Symbol sichtbar und nur während der Erfassung aktiv
- Audio-Halo folgt dem geglätteten Pegel und zittert nicht
- Voice-Seite zeigt Mikrofon „listening“ und den Live-Pegel

### 45.3 `voice-pipeline` – Voice Pipeline

Listening → Transcribing → Thinking → Speaking → Idle mit Partial- und Final-Transkripten.

- **Profil:** `default`, Ausgangszustand: beruhigt (keine offenen Freigaben/Alerts, keine laufende Arbeit)
- **Dauer:** 8,5 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `idle` → `listening` → `transcribing` → `thinking` → `speaking` → `idle`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | Zuhören | Voice-Modus `listening`<br>Audio-Fixture `normal` (input, 2500 ms, 12 Hz) | `listening` |
| 1 | 2,5 s | Transkribieren | Voice-Modus `transcribing` | `transcribing` |
| 2 | 2,8 s | Partial-Transkript 1 | Partial-Transkript „Wie ist“ | `transcribing` |
| 3 | 3,2 s | Partial-Transkript 2 | Partial-Transkript „Wie ist das Wetter morgen“ | `transcribing` |
| 4 | 3,7 s | Final-Transkript | Final-Transkript „Wie ist das Wetter morgen in Hannover?“ | `transcribing` |
| 5 | 4,0 s | Nachdenken | Voice-Modus `thinking` | `thinking` |
| 6 | 5,5 s | Sprechen | Voice-Modus `speaking`<br>Audio-Fixture `tts` (output, 3000 ms, 12 Hz) | `speaking` |
| 7 | 8,5 s | Bereit | Voice-Modus `idle` | `idle` |

**UI-Erwartungen**

- Orb wechselt fließend zwischen den fünf Zuständen mit deutschem Statustext
- Transkript-Zeile zeigt Partial-Text kursiv, Final-Text fest
- Stop-Schaltfläche (Barge-In) ist während F.R.I.D.A.Y. SPRICHT sichtbar

### 45.4 `multi-agent-working` – Multi-Agent Working

Drei Agenten arbeiten an zwei Aufgaben: eine mit echtem Fortschritt, eine mit unbekanntem (indeterminate).

- **Profil:** `default`, Ausgangszustand: beruhigt (keine offenen Freigaben/Alerts, keine laufende Arbeit)
- **Dauer:** 22,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `idle` → `working` → `success` → `working` → `success` → `idle`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | Drei Agenten starten | Task „Marktanalyse Büromöbel Region Hannover“ (Recherche-Agent, Fortschritt 10 %)<br>Task „Schnittstelle zum Lieferantenportal umbauen“ (Coding-Agent, indeterminate)<br>Kommunikations-Agent → `working` | `working` |
| 1 | 4,0 s | Fortschritt 35 % | Task recherche: 35 % | `working` |
| 2 | 8,0 s | Fortschritt 60 % | Task recherche: 60 % | `working` |
| 3 | 12,0 s | Fortschritt 85 % | Task recherche: 85 % | `working` |
| 4 | 14,0 s | Recherche fertig | Task recherche abschließen | `success` |
| 5 | 16,0 s | Nur noch der Coding-Agent – Aufgabe ohne bekannten Fortschritt: indeterminate. | Activity: Coding-Agent führt Tests aus | `working` |
| 6 | 20,0 s | Umbau fertig | Task coding abschließen | `success` |
| 7 | 22,0 s | Bereit | – | `idle` |

**UI-Erwartungen**

- Orb zeigt „3 AGENTEN AKTIV“ mit drei Agent-Markern und echtem Fortschrittsring (Recherche)
- Danach „CODE WIRD ERSTELLT“ mit umlaufendem Indeterminate-Ring ohne Prozentzahl
- Agents-Seite und Overview listen genau die aktiven Agenten, Tasks zeigen determinate/indeterminate Balken

### 45.5 `syncing` – Syncing

Mail und Kalender werden synchronisiert; Activity Feed erhält Ereignisse.

- **Profil:** `default`, Ausgangszustand: beruhigt (keine offenen Freigaben/Alerts, keine laufende Arbeit)
- **Dauer:** 6,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `idle` → `syncing` → `idle`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | Postfach-Abgleich | Sync starten: GMX-Postfach<br>Activity: Synchronisation GMX-Postfach gestartet | `syncing` |
| 1 | 1,5 s | Kalender-Abgleich | Sync starten: Kalender<br>Activity: Synchronisation Kalender gestartet | `syncing` |
| 2 | 2,5 s | Neue Mail eingetroffen | Neue Mail „Rückfrage zur Lieferung der Bürostühle“ | `syncing` |
| 3 | 4,0 s | Postfach fertig | Sync beenden: mail<br>Activity: Synchronisation GMX-Postfach abgeschlossen (1 neue Nachricht) | `syncing` |
| 4 | 6,0 s | Kalender fertig | Sync beenden: calendar<br>Activity: Synchronisation Kalender abgeschlossen | `idle` |

**UI-Erwartungen**

- Orb zeigt „MAILS WERDEN AKTUALISIERT“, danach „2 QUELLEN WERDEN SYNCHRONISIERT“ und die Quelle neben dem Orb
- Activity Feed erhält vier Adapter-Ereignisse in Echtzeit
- Communication-Seite zeigt den neuen Thread, Kanal-Zähler steigt

### 45.6 `approval-waiting` – Approval Waiting

Ein E-Mail-Versand wartet auf Freigabe; nichts wird ohne Entscheidung gesendet.

- **Profil:** `default`, Ausgangszustand: beruhigt (keine offenen Freigaben/Alerts, keine laufende Arbeit)
- **Dauer:** 5,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `idle` → `waiting_approval`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | Entwurf und Freigabe angefordert | Entwurf anlegen und Versandfreigabe anfordern (becker) | `waiting_approval` |
| 1 | 5,0 s | Wartet auf Entscheidung – Der Orb bleibt ruhig in Amber, es gibt keinen Auto-Approve. | Activity: Freigabe für E-Mail an Frau Becker steht aus | `waiting_approval` |

**UI-Erwartungen**

- Orb zeigt FREIGABE ERFORDERLICH, ein Klick öffnet die konkrete Freigabe
- Overview zeigt eine Attention-Card „E-Mail an Katharina Becker senden“
- Approvals-Seite: Vorschau, Risikostufe 2, Ablaufzeit; Entwurf steht auf pending_approval

### 45.7 `critical-alert` – Critical Alert

P0-Alert mit Eskalationskette Dashboard → Telegram → WhatsApp → Telefon; das System bleibt bedienbar.

- **Profil:** `default`, Ausgangszustand: beruhigt (keine offenen Freigaben/Alerts, keine laufende Arbeit)
- **Dauer:** 100,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `idle` → `error` → `idle`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | P0-Alert ausgelöst | Dienst Windows Worker → `offline`<br>Alert P0: „Kritisch: Windows-Worker nicht erreichbar, Backup überfällig“ (Eskalation dashboard → telegram → whatsapp → phone) | `error` |
| 1 | 15,0 s | Eskalation: Telegram | – | `error` |
| 2 | 40,0 s | Eskalation: WhatsApp | – | `error` |
| 3 | 80,0 s | Eskalation: Telefon | – | `error` |
| 4 | 90,0 s | Alert bestätigt | Alert alert bestätigen | `idle` |
| 5 | 100,0 s | Dienst wiederhergestellt | Dienst Windows Worker → `online` | `idle` |

**UI-Erwartungen**

- Orb im Fehler-Zustand mit kontrolliertem Eintrittsimpuls, Kern bleibt golden, kein Dauerblinken
- Alerts-Seite zeigt die Eskalationskette mit Zeitstempeln je Kanal (sent/pending)
- Alle anderen Seiten bleiben bedienbar, Command Bar weiter erreichbar

> Die Eskalationsverzögerungen (0/15/40/80 s) sind für die Demo verkürzt und werden mit der Abspielgeschwindigkeit skaliert.

### 45.8 `partial-outage` – Partial Outage

Mail-Adapter offline, Aufgaben bleiben online; die Overview bleibt nutzbar.

- **Profil:** `default`, Ausgangszustand: beruhigt (keine offenen Freigaben/Alerts, keine laufende Arbeit)
- **Dauer:** 3,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `idle` → `warning`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | Mail-Adapter fällt aus | Adapter `communication` → `offline` | `warning` |
| 1 | 3,0 s | Weitere Aktivität | Activity: Mail-Synchronisation übersprungen: Adapter offline | `warning` |

**UI-Erwartungen**

- Orb im Zustand EINGESCHRÄNKTER BETRIEB mit Hinweis auf den Mail-Ausfall
- Overview lädt vollständig, Mail-Kachel zeigt „offline“ mit Offline-Cache-Hinweis
- Tasks, Kalender, Agents liefern frische Daten; Mail-Aktionen sind deaktiviert

### 45.9 `adapter-recovery` – Adapter Recovery

Kalender-Adapter: online → timeout → degraded → offline → recovering → online.

- **Profil:** `default`, Ausgangszustand: beruhigt (keine offenen Freigaben/Alerts, keine laufende Arbeit)
- **Dauer:** 21,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `idle` → `warning` → `idle`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | Online | – | `idle` |
| 1 | 3,0 s | Timeout – ADAPTER_TIMEOUT, Lifecycle DEGRADED | Adapter `calendar` → `timeout` | `warning` |
| 2 | 7,0 s | Degraded – Antworten verzögert, Daten stale | Adapter `calendar` → `degraded` | `warning` |
| 3 | 11,0 s | Offline – Circuit open, Daten aus dem Cache | Adapter `calendar` → `offline` | `warning` |
| 4 | 16,0 s | Recovering – Circuit half-open, Lifecycle RECOVERING | Adapter `calendar` → `recovering` | `warning` |
| 5 | 21,0 s | Wieder online | Adapter `calendar` → `online` | `idle` |

**UI-Erwartungen**

- Systemseite: Adapter-Matrix wechselt Status und Lifecycle (DEGRADED → OFFLINE → RECOVERING → ONLINE)
- Kalenderansicht zeigt Freshness stale → offline-cache → fresh, nie alte Daten als live
- Orb kehrt nach der Wiederherstellung zu BEREIT zurück

### 45.10 `empty-new-installation` – Empty New Installation

Frische Installation ohne Daten: alle Listen leer, Kanäle nicht konfiguriert.

- **Profil:** `empty`, Ausgangszustand: wie generiert
- **Dauer:** 0,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `idle`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | Leeres System | – | `idle` |

**UI-Erwartungen**

- Jede Seite zeigt einen sinnvollen Empty State mit nächstem Schritt, kein kaputtes Layout
- Communication: alle Kanäle „Nicht konfiguriert“ mit Hinweis „Adapter konfigurieren“
- Orb BEREIT, Overview mit leeren Karten und Quick Commands

### 45.11 `high-load` – High Load

1 000 Aufgaben, 10 000 Aktivitätsereignisse, 100 Agenten; Live-Feed erhält zusätzlich Ereignisse.

- **Profil:** `highLoad`, Ausgangszustand: wie generiert
- **Dauer:** 8,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `waiting_approval`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | Große Datenmenge geladen | – | `waiting_approval` |
| 1 | 2,0 s | Ereignisburst – 60 Aktivitätsereignisse in 6 Sekunden. | 60 Activity-Events im Abstand von 100 ms | `waiting_approval` |

**UI-Erwartungen**

- Listen virtualisiert oder paginiert, Scrollen bleibt flüssig, keine DOM-Explosion
- Kanban zeigt Spaltenzähler statt aller Karten; Filter und Suche reagieren schnell
- Activity Feed hält die Framerate trotz Burst

### 45.12 `long-german-text` – Long German Text

Sehr lange Betreffzeilen und Titel mit Umlauten und Komposita.

- **Profil:** `longGerman`, Ausgangszustand: wie generiert
- **Dauer:** 3,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `waiting_approval`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | Lange Texte geladen | – | `waiting_approval` |
| 1 | 3,0 s | Lange Benachrichtigung | Alert P2: „Donaudampfschifffahrtsgesellschaftskapitänsmützenreinigungsauftrag: Rückfrage zur Abrechnung der Betriebskostennachzahlungsüberprüfung“ (Eskalation dashboard) | `waiting_approval` |

**UI-Erwartungen**

- Titel brechen um oder werden mit Ellipse und Tooltip gekürzt, nichts läuft aus den Panels
- Umlaute und ß werden korrekt gerendert, Kopfzeilen in Großbuchstaben bleiben lesbar
- Drawer, Tabellen und Cards behalten ihr Layout

### 45.13 `reduced-motion` – Reduced Motion

Alle 14 Orb-Zustände nacheinander, für Reduced-Motion-Prüfung der Informationsvollständigkeit.

- **Profil:** `default`, Ausgangszustand: beruhigt (keine offenen Freigaben/Alerts, keine laufende Arbeit)
- **Dauer:** 42,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `idle` → `booting` → `idle` → `listening` → `transcribing` → `thinking` → `syncing` → `working` → `speaking` → `waiting_approval` → `success` → `warning` → `error` → `offline` → `paused` → `idle`
- **UI-Hinweise:** `meta.features.reducedMotion=true`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | Zustand booting | Orb erzwingen: `booting`<br>UI-Hinweis `reducedMotion=true` | `booting` |
| 1 | 3,0 s | Zustand idle | Orb erzwingen: `idle` | `idle` |
| 2 | 6,0 s | Zustand listening | Orb erzwingen: `listening` | `listening` |
| 3 | 9,0 s | Zustand transcribing | Orb erzwingen: `transcribing` | `transcribing` |
| 4 | 12,0 s | Zustand thinking | Orb erzwingen: `thinking` | `thinking` |
| 5 | 15,0 s | Zustand syncing | Orb erzwingen: `syncing` | `syncing` |
| 6 | 18,0 s | Zustand working | Orb erzwingen: `working` | `working` |
| 7 | 21,0 s | Zustand speaking | Orb erzwingen: `speaking` | `speaking` |
| 8 | 24,0 s | Zustand waiting_approval | Orb erzwingen: `waiting_approval` | `waiting_approval` |
| 9 | 27,0 s | Zustand success | Orb erzwingen: `success` | `success` |
| 10 | 30,0 s | Zustand warning | Orb erzwingen: `warning` | `warning` |
| 11 | 33,0 s | Zustand error | Orb erzwingen: `error` | `error` |
| 12 | 36,0 s | Zustand offline | Orb erzwingen: `offline` | `offline` |
| 13 | 39,0 s | Zustand paused | Orb erzwingen: `paused` | `paused` |
| 14 | 42,0 s | Override aufgehoben | Orb-Override aufheben | `idle` |

**UI-Erwartungen**

- Animation reduziert (keine Rotationen, nur Opazitäts- und Farbwechsel), Information bleibt vollständig
- Jeder Zustand zeigt seinen deutschen Statustext und die Zustandsakzentfarbe
- Prefers-reduced-motion und Orb-Einstellung „reduced“ liefern dasselbe Ergebnis

### 45.14 `webgl-failure` – WebGL Failure

WebGL ist nicht verfügbar: der Orb wechselt auf den 2D-Fallback, die Startseite bleibt bedienbar.

- **Profil:** `default`, Ausgangszustand: beruhigt (keine offenen Freigaben/Alerts, keine laufende Arbeit)
- **Dauer:** 8,0 s Mock-Zeit bei `speed=1`
- **Erwartete Orb-Modi:** `idle` → `working`
- **UI-Hinweise:** `meta.features.forceOrbFallback2D=true`

| # | t | Schritt | Aktionen | Orb danach |
|---:|---:|---|---|---|
| 0 | 0,0 s | WebGL-Fehler simuliert – meta.features.forceOrbFallback2D = true, danach resync_required. | UI-Hinweis `forceOrbFallback2D=true` | `idle` |
| 1 | 2,0 s | Arbeit im Fallback | Task „Wochenbericht zusammenstellen“ (Task-Agent, Fortschritt 20 %) | `working` |
| 2 | 8,0 s | Fortschritt im Fallback | Task task: 70 % | `working` |

**UI-Erwartungen**

- Orb-Bereich zeigt den 2D-Fallback (OrbFallback2D) mit denselben Zuständen und Texten
- Hinweis „WebGL nicht verfügbar“, keine unbedienbare Startseite
- Klick auf den Orb öffnet weiterhin die laufende Aktivität

