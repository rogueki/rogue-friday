# JARVIS COMMAND CENTER
## Vollständiger Fertigstellungsplan für ein adapterbasiertes, Contract-First Dashboard

**Dokumenttyp:** Verbindliche Implementierungs- und Abnahmespezifikation  
**Ziel:** Das komplette Dashboard soll zunächst ohne Kenntnis der späteren Hermes-, Voice-, Memory-, Mail-, Kalender- oder Systemanbindungen gebaut und vollständig mit Mock-Daten geprüft werden.  
**Primäres Deployment-Ziel:** `D:\Jarvis\dashboard\` unter Windows/WSL2  
**Sprache der Oberfläche:** Deutsch als Standard, Englisch optional  
**Designrichtung:** Verbindlich an den mitgelieferten Referenzbildern orientiertes JARVIS Command Center: tiefes Navy-/Schwarzblau, leuchtende Cyan-HUD-Linien, modulare technische Panels und ein zentraler gold-/orangefarbener, mehrschichtiger Hologramm-Orb  
**Verbindliche Designreferenz Dashboard:** `design-references/jarvis_dashboard_reference.webp`  
**Verbindliche Designreferenz Orb:** `design-references/jarvis_orb_reference.webp`  
**Priorität 1:** Der zentrale, vollständig animierte goldene Hologramm-Orb auf der Overview-Seite  
**Priorität 2:** Die visuelle Designsprache des Referenz-Dashboards, angepasst an die in diesem Plan definierten Menüs und Funktionen  
**Priorität 3:** Contract-First, Adapter-Architektur und vollständiger Mock-Betrieb  
**Priorität 4:** Klare Transparenz über alles, was Jarvis gerade macht, gemacht hat oder vom Benutzer benötigt

---

# 1. Auftrag an den ausführenden Entwicklungsagenten

Dieses Dokument ist als verbindlicher Projektplan für Kimi, Codex oder einen menschlichen Entwickler zu behandeln.

## 1.1 Nicht verhandelbare Regeln

1. Das Frontend darf niemals direkt mit Hermes, Kimi, Qwen, Voice, GMX, Telegram, WhatsApp, Kalender, lokalen Datenbanken oder Betriebssystemdiensten sprechen.
2. Das Frontend kommuniziert ausschließlich mit einer eigenen, stabilen **Jarvis Control API**.
3. Die Control API arbeitet ausschließlich über definierte **Ports/Interfaces** und austauschbare Adapter.
4. Alle REST-Verträge werden zuerst in OpenAPI beschrieben.
5. Alle Echtzeitereignisse werden zuerst in AsyncAPI und JSON Schema beschrieben.
6. UI-Typen dürfen nicht manuell parallel zu den API-Verträgen gepflegt werden.
7. Clients, Typen, Validatoren und Mock-Grundlagen werden aus den Verträgen generiert.
8. Das Dashboard muss vollständig in `mock` funktionieren, bevor ein echter Adapter implementiert wird.
9. Kein Providername und kein Port darf im Frontend hardcodiert sein.
10. Fehlende Adapter dürfen niemals die gesamte Anwendung unbenutzbar machen.
11. Jede Ansicht benötigt Loading-, Empty-, Stale-, Degraded-, Offline- und Error-Zustände.
12. Der Orb muss semantische Zustände anzeigen und darf seinen Zustand nicht aus zufälligen Texten erraten.
13. Der Orb ist ein funktionaler Systemindikator, keine reine Dekoration.
14. Keine kritische Aktion darf allein über eine hübsche UI ausgelöst werden; Berechtigungen und Freigaben werden serverseitig geprüft.
15. Alle Screens, Komponenten und Orb-Zustände benötigen reproduzierbare Mock-Szenarien.
16. Keine Secrets im Browser, in Git, in Mock-Dateien oder in Screenshots.
17. Keine direkten Zugriffe auf interne Hermes-Datenbanken, solange eine unterstützte API, CLI oder Eventquelle verfügbar ist.
18. Adapter müssen einen gemeinsamen Conformance-Test bestehen.
19. Jede Änderung an einem Datenmodell beginnt im Contract-Verzeichnis.
20. Das Dashboard muss später individualisierbar sein, ohne den Quellcode für Farben, Orb-Verhalten, Navigation oder Adapter neu zu schreiben.
21. Die beiden mitgelieferten Referenzbilder sind verbindliche Designvorgaben für Formensprache, Farbklima, Dichte, Tiefenwirkung und Panelgestaltung.
22. Das Dashboard-Referenzbild darf nicht einfach als Hintergrundbild eingebaut werden; das Layout muss als echte responsive Oberfläche neu aufgebaut werden.
23. Das Orb-Referenzbild darf nicht als animiertes Bild, Video oder Sprite verwendet werden; der Orb wird als echte prozedurale 3D-Szene rekonstruiert.
24. Die Anordnung einzelner Dashboard-Felder darf von der Referenz abweichen, die visuelle Sprache darf jedoch nicht in ein generisches SaaS-Dashboard abdriften.
25. Das gold-/orangefarbene Orb-Erscheinungsbild bleibt die feste visuelle Identität des AI Core; Statusänderungen werden primär über Bewegung, Intensität, Ringverhalten und sekundäre Akzentfarben vermittelt.
26. Die Navigationspunkte und Datenmodule aus diesem Plan haben Vorrang vor den im Referenzbild sichtbaren Beispielmenüs.

---

# 2. Projektziel

Das Dashboard soll als zentrale Bedien-, Kontroll- und Beobachtungsoberfläche für Jarvis dienen.

Der Benutzer muss innerhalb weniger Sekunden erkennen können:

- Ist Jarvis online?
- Hört Jarvis gerade zu?
- Verarbeitet Jarvis Sprache?
- Synchronisiert Jarvis Daten?
- Denkt oder arbeitet Jarvis?
- Welcher Agent arbeitet?
- An welcher Aufgabe wird gearbeitet?
- Welche Tools werden verwendet?
- Muss der Benutzer etwas freigeben?
- Gibt es Warnungen oder Fehler?
- Welche Aufgaben sind offen, blockiert oder abgeschlossen?
- Welche wichtigen E-Mails, Termine oder Benachrichtigungen liegen vor?
- Welche Erinnerungen und gespeicherten Informationen existieren?
- Wie gesund sind Hermes, Kimi, Qwen, Voice, WSL, GPU und Adapter?
- Welche Aktionen wurden bereits ausgeführt?
- Welche Kosten, Laufzeiten, Modelle und Tools wurden verwendet?

---

# 3. Abgrenzung

## 3.1 Im Umfang

- vollständiges Dashboard-Frontend
- Jarvis Control API
- Contract-Paket
- Adapter SDK
- Adapter Registry
- Mock Adapter für jeden Kernbereich
- Mock-Szenario-Engine
- Orb Renderer
- Orb State Controller
- Design System
- Settings- und Theme-System
- Echtzeit-Event-Schicht
- Tests
- Dokumentation
- lokale Deployment-Struktur
- Beispieladapter
- Integration Handoff für den Kollegen

## 3.2 Nicht Bestandteil der ersten Dashboard-Fertigstellung

- produktive Hermes-Anbindung
- produktive GMX-Anbindung
- produktive WhatsApp-Anbindung
- produktive Telefonie
- produktive Loxone-Anbindung
- produktive Banking-Anbindung
- direkte Steuerung kritischer Systeme
- vollständige LifeOS-Integration
- Cloud-Deployment

Diese Punkte werden über Adapter später ergänzt, ohne die UI-Architektur zu ändern.

---

# 4. Technische Zielarchitektur

```text
┌───────────────────────────────────────────────────────────────────┐
│                       JARVIS DASHBOARD                            │
│                                                                   │
│  Next.js / React / TypeScript                                     │
│  ├── Overview + Orb                                               │
│  ├── Tasks                                                        │
│  ├── Activity                                                     │
│  ├── Memory                                                       │
│  ├── Agents                                                       │
│  ├── Approvals                                                    │
│  ├── Communication                                                │
│  ├── Calendar                                                     │
│  ├── Automations                                                  │
│  ├── Research                                                     │
│  ├── Files                                                        │
│  ├── Voice                                                        │
│  ├── Alerts                                                       │
│  ├── System                                                       │
│  ├── Audit                                                        │
│  ├── Settings                                                     │
│  └── Global Command Bar                                           │
│                                                                   │
└───────────────────────────┬───────────────────────────────────────┘
                            │
                            │ Generated SDK
                            │ REST + WebSocket
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│                    JARVIS CONTROL API                             │
│                                                                   │
│  Authentication / Authorization                                  │
│  Capability Discovery                                            │
│  Data Normalization                                               │
│  Adapter Registry                                                 │
│  Realtime Event Hub                                               │
│  Approval Enforcement                                             │
│  Audit                                                            │
│  Error Normalization                                              │
│  Cache / Snapshot                                                  │
│                                                                   │
└───────────────────────────┬───────────────────────────────────────┘
                            │
              Canonical Ports / Adapter Interfaces
                            │
    ┌───────────────────────┼─────────────────────────┐
    │                       │                         │
    ▼                       ▼                         ▼
Mock Adapters          Production Adapters       Hybrid Mode
    │                       │                         │
    ├ Tasks                 ├ Hermes                 ├ Mock Memory
    ├ Activity              ├ Voice HTTP             ├ Live Tasks
    ├ Memory                ├ GMX                    ├ Mock Mail
    ├ Agents                ├ Calendar               └ Live System
    ├ Mail                  ├ Windows Worker
    ├ Calendar              ├ System Metrics
    ├ Voice                 └ spätere Adapter
    └ System
```

---

# 5. Empfohlener Technologie-Stack

## 5.1 Monorepo

```text
pnpm workspaces
```

Optional mit einem Build-Orchestrator, wenn dies den Build messbar vereinfacht. Kein zusätzlicher Monorepo-Overhead ohne echten Nutzen.

## 5.2 Frontend

```text
Next.js App Router
React
TypeScript strict
TanStack Query
XState v5
React Three Fiber
Three.js
Motion for React
CSS Variables + Utility CSS
Headless accessible UI primitives
```

### Verantwortlichkeiten

- **Next.js:** Routing, Layouts, Loading- und Error-Grenzen
- **TanStack Query:** Serverzustand, Caching, Mutations, Invalidierung
- **XState v5:** deterministische Orb- und Verbindungszustände
- **React Three Fiber / Three.js:** 3D-Orb und Shader
- **Motion:** Panel-, Drawer-, Dialog- und Layoutanimationen
- **CSS Variables:** vollständig austauschbare Themes
- **Headless UI:** zugängliche Controls ohne Design-Lock-in

## 5.3 Backend / Control API

Empfehlung:

```text
NestJS
Fastify Adapter
TypeScript strict
native WebSocket oder ws
AJV / JSON-Schema-Validierung
SQLite für lokale Dashboard-Daten
```

NestJS wird für modulare Dependency Injection und Adapter-Registrierung verwendet. Das OpenAPI-Dokument bleibt trotzdem **Contract-First** und wird nicht aus dem Code zur alleinigen Wahrheit generiert.

## 5.4 Contract-Technologien

```text
OpenAPI 3.1.x
AsyncAPI 3.1.x
JSON Schema 2020-12
CloudEvents-kompatibles Event Envelope
OpenAPI Generator
AsyncAPI CLI / Generator
```

OpenAPI 3.2 kann später nach Tooling-Kompatibilitätsprüfung übernommen werden. Für den ersten stabilen Build wird 3.1.x empfohlen, weil die Toolkette zunächst reproduzierbar funktionieren muss.

## 5.5 Testsystem

```text
Vitest
Storybook
Mock Service Worker
Playwright
axe-basierte Accessibility-Prüfung
OpenAPI/AsyncAPI Linting
Contract-Diff-Prüfung
Adapter Conformance Suite
```

---

# 6. Vorgeschlagene Projektstruktur

```text
D:\Jarvis\dashboard\
│
├── apps\
│   ├── web\                         # Dashboard-Frontend
│   ├── control-api\                 # Jarvis Control API
│   ├── mock-console\                # Dev/QA-Szenario-Steuerung
│   └── storybook\                   # Komponenten- und Orb-Katalog
│
├── packages\
│   ├── contracts\
│   │   ├── openapi\
│   │   │   └── jarvis-api.yaml
│   │   ├── asyncapi\
│   │   │   └── jarvis-events.yaml
│   │   ├── schemas\
│   │   │   ├── common\
│   │   │   ├── tasks\
│   │   │   ├── memory\
│   │   │   ├── agents\
│   │   │   ├── approvals\
│   │   │   ├── communication\
│   │   │   ├── calendar\
│   │   │   ├── automations\
│   │   │   ├── research\
│   │   │   ├── files\
│   │   │   ├── voice\
│   │   │   ├── notifications\
│   │   │   ├── system\
│   │   │   ├── audit\
│   │   │   └── orb\
│   │   └── examples\
│   │
│   ├── generated-sdk\
│   ├── ui\
│   ├── design-tokens\
│   ├── orb\
│   ├── adapter-core\
│   ├── adapter-testkit\
│   ├── mock-data\
│   ├── config\
│   ├── auth\
│   └── observability\
│
├── adapters\
│   ├── mock\
│   ├── example-http\
│   ├── hermes-placeholder\
│   ├── voice-placeholder\
│   ├── mail-placeholder\
│   ├── calendar-placeholder\
│   └── system-placeholder\
│
├── docs\
│   ├── ARCHITECTURE.md
│   ├── CONTRACT_FIRST.md
│   ├── ADAPTER_SDK.md
│   ├── ADAPTER_CONFORMANCE.md
│   ├── ORB_SPECIFICATION.md
│   ├── DESIGN_SYSTEM.md
│   ├── MOCK_SCENARIOS.md
│   ├── SECURITY.md
│   ├── DEPLOYMENT.md
│   ├── TESTING.md
│   └── HANDOFF.md
│
├── config\
│   ├── dashboard.example.yaml
│   ├── adapters.example.yaml
│   ├── themes\
│   └── layouts\
│
├── scripts\
├── tests\
├── pnpm-workspace.yaml
├── package.json
└── README.md
```

---

# 7. Contract-First als verbindlicher Entwicklungsprozess

## 7.1 Reihenfolge jeder Funktion

```text
1. Use Case beschreiben
2. Domainmodell definieren
3. JSON Schema anlegen
4. REST-Vertrag in OpenAPI anlegen
5. Event-Vertrag in AsyncAPI anlegen
6. Beispiele anlegen
7. Verträge linten
8. SDK und Typen generieren
9. Mock Handler generieren/implementieren
10. UI implementieren
11. Backend-Port definieren
12. Adapter implementieren
13. Contract- und E2E-Tests
```

## 7.2 Verbotener Ablauf

```text
UI baut irgendein Objekt
→ Backend passt sich spontan an
→ später wird Swagger generiert
```

Das ist ausdrücklich nicht zulässig.

## 7.3 Source of Truth

```text
packages/contracts/
```

ist die alleinige Wahrheit für:

- Requests
- Responses
- Events
- Enums
- Fehler
- Pagination
- IDs
- Zeitstempel
- Capability-Modelle
- Orb-Zustände

## 7.4 CI-Regeln

Der Build muss fehlschlagen, wenn:

- OpenAPI ungültig ist
- AsyncAPI ungültig ist
- JSON Schema ungültig ist
- generierter SDK-Code nicht aktuell ist
- eine Breaking Contract-Änderung ohne Major-Version vorgenommen wird
- Beispiele nicht gegen die Schemas validieren
- Backendantworten nicht dem Contract entsprechen
- Mockantworten nicht dem Contract entsprechen

---

# 8. Vertragskonventionen

## 8.1 API-Versionierung

```text
/api/v1/
```

Contract-Version zusätzlich in Responses:

```json
{
  "contractVersion": "1.0.0"
}
```

## 8.2 Zeit

Alle Zeitstempel:

```text
UTC
ISO 8601
```

Frontend lokalisiert anhand der Benutzereinstellung.

## 8.3 IDs

Stabile, opaque IDs verwenden.

Beispiel:

```text
task_01J...
agent_01J...
approval_01J...
```

Keine Datenbankzeilennummern an das Frontend geben.

## 8.4 Pagination

Cursor-basiert:

```json
{
  "items": [],
  "pageInfo": {
    "nextCursor": null,
    "hasNextPage": false
  }
}
```

## 8.5 Optimistische Parallelität

Änderbare Ressourcen benötigen:

```text
version
updatedAt
```

Optional:

```text
ETag / If-Match
```

## 8.6 Fehlerformat

```json
{
  "error": {
    "code": "ADAPTER_UNAVAILABLE",
    "message": "Der Kalender-Adapter ist derzeit nicht erreichbar.",
    "severity": "warning",
    "retryable": true,
    "correlationId": "corr_...",
    "details": {}
  }
}
```

## 8.7 Idempotenz

Kritische POST-Aktionen unterstützen:

```text
Idempotency-Key
```

Doppelklicks dürfen keine E-Mail doppelt senden oder eine Freigabe doppelt ausführen.

## 8.8 Datenherkunft

Jede kanonische Ressource erhält:

```json
{
  "source": {
    "adapterId": "mock-tasks",
    "system": "mock",
    "externalId": "optional",
    "lastSyncedAt": "2026-10-13T20:00:00Z"
  }
}
```

## 8.9 Freshness

Jede View kann erkennen:

```text
fresh
stale
unknown
offline-cache
```

Keine alten Daten als live darstellen.

---

# 9. Capability Discovery

## 9.1 Endpoint

```http
GET /api/v1/capabilities
```

## 9.2 Beispiel

```json
{
  "contractVersion": "1.0.0",
  "modules": {
    "tasks": {
      "read": true,
      "create": true,
      "update": true,
      "cancel": true,
      "stream": true,
      "sources": ["mock-tasks"]
    },
    "memory": {
      "read": true,
      "write": false,
      "delete": false,
      "search": true,
      "sources": ["mock-memory"]
    },
    "mail": {
      "read": true,
      "draft": true,
      "send": false,
      "sources": ["mock-mail"]
    },
    "telephony": {
      "read": false,
      "call": false,
      "sources": []
    }
  }
}
```

## 9.3 UI-Verhalten

Wenn ein Modul nicht verbunden ist:

```text
Mail
○ Nicht verbunden
[Adapter konfigurieren]
```

Wenn ein Modul read-only ist:

```text
Lesen verfügbar
Senden nicht verfügbar
```

Aktionen werden capability-basiert angezeigt oder deaktiviert.

---

# 10. Adapterarchitektur

## 10.1 Prinzip

Jeder Adapter übersetzt zwischen einem konkreten Fremdsystem und dem kanonischen Jarvis-Modell.

```text
Hermes Task
      ↓
HermesTaskAdapter
      ↓
Canonical Task
      ↓
Control API
      ↓
Dashboard
```

## 10.2 Kein Source-Leak

Das Frontend darf keine Hermes-spezifischen, GMX-spezifischen oder Voice-spezifischen Rohobjekte erhalten.

Rohdaten dürfen nur in einer geschützten Debugansicht angezeigt werden.

## 10.3 Base Adapter

```ts
interface JarvisAdapter {
  readonly manifest: AdapterManifest;

  initialize(context: AdapterContext): Promise<void>;
  healthCheck(): Promise<AdapterHealth>;
  getCapabilities(): Promise<CapabilitySet>;
  shutdown(): Promise<void>;
}
```

## 10.4 Adapter Manifest

```ts
interface AdapterManifest {
  id: string;
  name: string;
  adapterVersion: string;
  contractVersion: string;
  apiVersion: string;
  category:
    | "tasks"
    | "activity"
    | "memory"
    | "agents"
    | "approvals"
    | "communication"
    | "calendar"
    | "automations"
    | "research"
    | "files"
    | "voice"
    | "notifications"
    | "system"
    | "audit"
    | "commands";
  capabilities: string[];
  configSchemaRef: string;
  secretFields: string[];
}
```

## 10.5 Domain Ports

Mindestens:

```text
TaskPort
ActivityPort
MemoryPort
AgentPort
ApprovalPort
CommunicationPort
CalendarPort
AutomationPort
ResearchPort
FilePort
VoicePort
NotificationPort
SystemPort
AuditPort
CommandPort
```

## 10.6 Adapter Lifecycle

```text
UNREGISTERED
→ INITIALIZING
→ ONLINE
→ DEGRADED
→ OFFLINE
→ STOPPING
→ STOPPED
```

## 10.7 Adapter Health

```json
{
  "adapterId": "hermes-tasks",
  "status": "degraded",
  "latencyMs": 342,
  "lastSuccessAt": "2026-10-13T20:00:00Z",
  "lastError": {
    "code": "TIMEOUT",
    "message": "..."
  }
}
```

## 10.8 Retry und Circuit Breaker

Adapter benötigen:

- Timeout
- begrenzte Retries
- exponentielles Backoff
- Jitter
- Circuit Breaker
- saubere Fehlernormalisierung
- Health Recovery

Kein unendlicher Retry-Loop.

## 10.9 Adapter Registry

Die Registry lädt ausschließlich allowlistete Adapterpakete.

Beispiel:

```yaml
adapters:
  tasks:
    provider: mock-tasks
    enabled: true

  voice:
    provider: mock-voice
    enabled: true

  system:
    provider: mock-system
    enabled: true
```

Später:

```yaml
adapters:
  tasks:
    provider: hermes-tasks
    enabled: true
    config:
      baseUrl: ${HERMES_BASE_URL}

  voice:
    provider: jarvis-voice-http
    enabled: true
    config:
      baseUrl: ${VOICE_BASE_URL}
```

## 10.10 Betriebsmodi

```text
mock
hybrid
live
```

Beispiel Hybrid:

```yaml
mode: hybrid

adapters:
  tasks:
    provider: hermes-tasks

  activity:
    provider: hermes-activity

  memory:
    provider: mock-memory

  mail:
    provider: mock-mail

  system:
    provider: windows-wsl-system
```

---

# 11. Adapter Conformance Suite

Jeder neue Adapter muss dieselben Tests bestehen.

## 11.1 Pflichtprüfungen

- Manifest valide
- Contract-Version kompatibel
- Capability-Angaben korrekt
- Healthcheck
- Timeout
- Offline-Verhalten
- Retry-Verhalten
- Empty Response
- Pagination
- ungültige Fremddaten
- Schema Mapping
- Fehlernormalisierung
- Event Mapping
- Reconnect
- Auth-Fehler
- Berechtigungsfehler
- Idempotenz
- Shutdown
- keine Secret-Leaks
- keine provider-spezifischen Felder im Canonical Model

## 11.2 Goldene Regel

Ein produktiver Adapter darf gegen den Mock Adapter ausgetauscht werden, ohne:

- Frontendcode zu ändern
- Routen zu ändern
- UI-Typen zu ändern
- Komponenten neu zu bauen

---

# 12. Echtzeitarchitektur

## 12.1 Transport

```text
WebSocket /api/v1/events
```

Fallback:

```text
polling / snapshot refresh
```

## 12.2 Vertrag

AsyncAPI ist die Source of Truth.

## 12.3 Event Envelope

CloudEvents-inspiriert:

```json
{
  "specversion": "1.0",
  "id": "evt_01J...",
  "type": "jarvis.task.updated",
  "source": "adapter://mock-tasks",
  "subject": "task/task_01J...",
  "time": "2026-10-13T20:10:00Z",
  "sequence": 1842,
  "correlationId": "corr_01J...",
  "causationId": "evt_01J...",
  "contractVersion": "1.0.0",
  "data": {}
}
```

## 12.4 Event-Gruppen

```text
jarvis.status.*
jarvis.orb.*
jarvis.task.*
jarvis.activity.*
jarvis.memory.*
jarvis.agent.*
jarvis.approval.*
jarvis.communication.*
jarvis.calendar.*
jarvis.automation.*
jarvis.research.*
jarvis.file.*
jarvis.voice.*
jarvis.notification.*
jarvis.system.*
jarvis.audit.*
jarvis.adapter.*
```

## 12.5 Reconnect

Client muss:

1. letzte Sequence speichern
2. reconnecten
3. letzten Cursor mitsenden
4. fehlende Events nachladen
5. bei Event-Gap Snapshot neu laden
6. nicht doppelt anwenden

## 12.6 Heartbeat

```text
ping/pong
```

Anzeige im Systembereich:

```text
Event Stream: online
Roundtrip: 28 ms
Last Event: vor 2 s
```

---

# 13. Kanonische Kernmodelle

## 13.1 Common Resource

```ts
interface CanonicalResource {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  labels?: string[];
  source: SourceDescriptor;
}
```

## 13.2 Status

```text
online
degraded
offline
unknown
paused
```

## 13.3 Priorität

```text
P0 critical
P1 urgent
P2 important
P3 normal
P4 informational
```

## 13.4 Taskstatus

```text
triage
todo
ready
running
waiting
review
done
failed
cancelled
```

## 13.5 Agentstatus

```text
idle
starting
working
waiting
paused
error
offline
```

## 13.6 Approvalstatus

```text
pending
approved
rejected
expired
cancelled
executed
failed
```

---

# 14. Verbindliche Designreferenzen

Für die visuelle Umsetzung gelten zwei mitgelieferte Referenzbilder:

```text
design-references/jarvis_dashboard_reference.webp
design-references/jarvis_orb_reference.webp
```

## 14.1 Dashboard-Referenz

Die Dashboard-Referenz definiert verbindlich:

- tiefes, fast schwarzes Navy als Grundfläche
- leuchtende Cyan-/Türkis-HUD-Linien
- dünne technische Panelrahmen
- leicht transparente, klar abgegrenzte Module
- abgeschnittene beziehungsweise abgeschrägte Ecken
- feine Hintergrundraster und punktförmige Datenflächen
- hohe Informationsdichte bei klarer visueller Hierarchie
- linke vertikale Hauptnavigation
- obere Status-/Such-/Benutzerleiste
- zentrale AI-Core-Fläche
- rechts angeordnete Aufmerksamkeit-/Live-Feed-Fläche
- modulare Karten für Agenten, Tasks, Timeline, System, Memory und Provider
- eine dauerhaft erreichbare Command-/Voice-Leiste im unteren Bereich
- technisch wirkende Typografie, Großbuchstaben und großzügige Buchstabenabstände bei Überschriften

Die genaue Kartenanordnung ist **nicht** verbindlich. Verbindlich ist die visuelle Sprache.

## 14.2 Orb-Referenz

Die Orb-Referenz definiert verbindlich:

- gold-/orangefarbene Hologrammenergie als Hauptidentität
- einen sehr hellen, fast weiß-goldenen Energiekern
- mehrere halbtransparente konzentrische Sphären
- zahlreiche technische Ring-, Bogen- und Segmentebenen
- komplexe, schwebende Leiterbahn-/Schaltkreisstrukturen
- unregelmäßige geometrische Fragmente und Datenplatten
- starke Tiefenwirkung mit sichtbaren Vorder- und Rückseiten
- volumetrisches Leuchten und kontrollierten Bloom
- hohe geometrische Dichte, ohne zu einer geschlossenen massiven Kugel zu werden
- teilweise über die Kugelsilhouette hinausragende Segmente
- eine leicht asymmetrische, organisch-technische Gesamtform

Der bisher im Dashboard-Referenzbild sichtbare blaue Drahtgitter-Globus mit dem Schriftzug `JARVIS AI CORE` wird **vollständig durch diesen goldenen Orb ersetzt**.

## 14.3 Verbindliche Interpretationsregel

Die Referenzbilder sind ein Design-Briefing, keine Produktionsassets.

Nicht zulässig:

- das Dashboard-Bild als Hintergrund zu verwenden
- den Orb als statisches Bild oder Video zu verwenden
- die Referenzbilder pixelgenau abzuzeichnen und UI-Texte daraus zu übernehmen
- fremde Logos, Filmgrafiken oder Soundeffekte zu extrahieren

Erforderlich:

- eine eigenständig implementierte UI in derselben visuellen Designsprache
- ein echter, in Echtzeit gerenderter 3D-Orb
- Anpassung an alle in diesem Plan definierten Menüs
- responsive Komponenten statt einer festen Screenshot-Komposition
- Mock-Zustände für jede Animation und jedes Dashboard-Modul

---

# 15. Der goldene Hologramm-Orb – verbindliche Zielgestaltung

## 15.1 Rolle

Der Orb ist das visuelle Zentrum des gesamten Command Centers.

Er ist gleichzeitig:

- AI-Core-Visualisierung
- Live-Statusanzeige
- Voice-Indikator
- Agentenaktivitätsanzeige
- Fortschrittsanzeige
- Freigabeindikator
- Fehlerindikator
- Interaktionspunkt zum Öffnen der aktuellen Aktivität

Der Orb darf niemals wie ein gewöhnlicher Lade-Spinner, ein einfacher Drahtgitterglobus oder eine glatte leuchtende Kugel wirken.

## 15.2 Visuelle Identität

Der Grundzustand des Orbs bleibt in allen normalen Betriebszuständen:

```text
Gold
Amber
Orange
heißes Weiß im Kern
```

Cyan bleibt die Hauptfarbe des Dashboards, nicht des Orb-Kerns.

Die bewusste Kombination lautet:

```text
Dashboard = kaltes Navy/Cyan
AI Core   = warmes Gold/Orange
```

Dadurch wird der Orb zum klaren visuellen Fokus.

## 15.3 Räumlicher Aufbau

Der Orb wird in mindestens fünf Tiefenebenen aufgebaut:

```text
OrbRoot
├── WhiteHotCore
├── InnerReactor
├── MidCircuitSphere
├── OuterFragmentShell
├── OrbitalRingSystem
├── FloatingDataFragments
├── ParticleField
├── StateOverlays
└── InteractionLayer
```

### Ebene 1 – WhiteHotCore

- sehr kleiner, heller Kern
- Weißgold bis Hellgelb
- kontrollierter Bloom
- keine dauerhaft überstrahlte Vollfläche
- Pulsfrequenz abhängig vom Zustand
- bei Working/Thinking sichtbare Energiezufuhr aus äußeren Ebenen

### Ebene 2 – InnerReactor

- mehrere konzentrische Mini-Ringe
- radiale Speichen
- dichte technische Linien
- rotierende Kreissegmente
- leichte Tiefenparallaxe
- höhere Animationsgeschwindigkeit als die äußere Schale

### Ebene 3 – MidCircuitSphere

- kugelförmig verteilte Leiterbahn-/Schaltkreislinien
- horizontale, vertikale und geneigte Bögen
- instanzierte technische Rechtecke, Linien und Knotenpunkte
- transparente Materialien
- deutlich sichtbare Rückseite durch die Kugel hindurch
- keine vollständig geschlossene Oberfläche

### Ebene 4 – OuterFragmentShell

- größere, unregelmäßige Ringfragmente
- eckige Datenplatten
- unterbrochene Kugelbögen
- radial versetzte geometrische Elemente
- einzelne Fragmente ragen aus der idealen Kugelform heraus
- asymmetrische Verteilung wie in der Referenz

### Ebene 5 – OrbitalRingSystem

Mindestens fünf unabhängig steuerbare Ringgruppen:

```text
Core Ring
Inner Gyro Ring
Primary Orbital Ring
Secondary Tilted Ring
Outer Telemetry Ring
```

Jede Ringgruppe benötigt:

- eigene Rotationsachse
- eigene Geschwindigkeit
- eigene Segmentierung
- eigenen Opazitätsbereich
- Zustandseinfluss
- Quality-Level-Skalierung

## 15.4 Zusätzliche visuelle Elemente

```text
CircuitNodes
DataPackets
EnergyArcs
SegmentTrails
MicroParticles
DepthDust
ScanPlane
AudioReactiveHalo
ProgressOrbit
AgentMarkers
ErrorFractures
```

## 15.5 Transparenz und Tiefe

Der Orb muss visuell durchsichtig bleiben.

Erforderlich:

- vordere und hintere Ringlagen sichtbar
- abgestufte Opazität
- Tiefenfading
- additive Materialien nur kontrolliert
- keine flache 2D-Linienkugel
- leichte perspektivische Verzerrung
- Kameraparallaxe bei Mausbewegung, maximal sehr dezent

## 15.6 Material- und Lichtcharakter

- Emission statt metallischer Vollflächen
- warme Amber-/Goldpalette
- lokale weißgoldene Hotspots
- dünne orangefarbene Linien
- kontrollierter Bloom
- dunkle transparente Zwischenräume
- leichte Lichtreflexion auf dem umgebenden AI-Core-Panel
- kein übermäßiger Nebel
- keine unleserliche Vollüberstrahlung

## 15.7 Produktionsverfahren

Bevorzugt:

- React Three Fiber
- Three.js
- InstancedMesh für wiederholte Fragmente
- LineSegments/BufferGeometry für technische Linien
- Custom Shader für Energiefluss und Noise
- Postprocessing Bloom nur für ausgewählte Emissive-Layer
- Offscreen/low-power Reduktion

Nicht verwenden:

- GIF
- MP4
- animiertes WebP
- Lottie als Haupt-Orb
- simples CSS-Kreis-Element
- vollständiges 3D-Modell mit unnötig hoher Polygonzahl

---

# 16. Orb-Komponenten

```text
OrbRoot
├── OrbCameraRig
├── WhiteHotCore
├── CoreCorona
├── InnerReactor
├── InnerGyroRings
├── MidCircuitSphere
├── CircuitNodes
├── OuterFragmentShell
├── PrimaryOrbitalRing
├── SecondaryTiltedRing
├── TelemetryRing
├── ProgressOrbit
├── FloatingDataFragments
├── DataPackets
├── EnergyArcs
├── MicroParticleHalo
├── DepthDust
├── ScanPlane
├── AudioReactiveHalo
├── AgentMarkers
├── ApprovalOverlay
├── WarningOverlay
├── ErrorFractureOverlay
├── StateLabel
├── ActivityText
└── OrbHitTarget
```

## 16.1 WhiteHotCore

- bleibt im Normalbetrieb weißgolden
- skaliert nur subtil
- steuert die wahrgenommene Energie
- reagiert auf Voice- und TTS-Amplitude
- darf das umliegende Liniennetz nicht überblenden

## 16.2 Circuit Sphere

- bildet die dichte technische Kugelstruktur der Referenz
- besteht aus vielen dünnen Linien und Segmenten
- verwendet instanzierte Geometrien
- bewegt sich langsam und nicht vollständig synchron

## 16.3 Fragment Shell

- sorgt für die unregelmäßige Silhouette
- hat Lücken, Überstände und unterschiedliche Radien
- enthält keine gleichmäßig verteilten Standardringe
- reagiert stärker auf Working, Syncing und Error

## 16.4 AudioReactiveHalo

- liegt außerhalb des goldenen Hauptorbs
- kann im Listening-Zustand ein sehr dünnes Cyan-Signal aufnehmen
- verwendet echte normalisierte Audio-Level
- ist geglättet und darf nicht nervös zittern
- zeigt klar an, wann das Mikrofon tatsächlich aktiv ist

## 16.5 ProgressOrbit

Nur anzeigen, wenn realer Fortschritt vorliegt.

```text
progressMode = determinate
```

Bei unbekanntem Fortschritt:

```text
progressMode = indeterminate
```

Keine erfundenen Prozentwerte.

---

# 17. Orb Semantic State Contract

```ts
type OrbMode =
  | "booting"
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "syncing"
  | "working"
  | "speaking"
  | "waiting_approval"
  | "success"
  | "warning"
  | "error"
  | "offline"
  | "paused";

interface OrbStatus {
  mode: OrbMode;
  activityText?: string;
  detailText?: string;
  progress?: number | null;
  progressMode?: "determinate" | "indeterminate" | "none";
  audioLevel?: number;
  urgency?: "none" | "info" | "warning" | "critical";
  health?: "online" | "degraded" | "offline";
  activeAgentCount?: number;
  currentAgentId?: string;
  taskId?: string;
  approvalId?: string;
  since: string;
  sourceEventId?: string;
}
```

Regeln:

- Backend liefert ausschließlich semantische Zustände.
- Das Frontend übersetzt diese in Ringgeschwindigkeit, Lichtintensität und Overlays.
- Der Adapter darf keine Three.js- oder Shaderparameter liefern.
- Der goldene Grundcharakter bleibt erhalten.
- Statusfarben sind sekundäre Akzente, keine vollständige Neulackierung des Orbs.

---

# 18. Orb State Machine

XState v5 verwenden.

## 18.1 Hauptereignisse

```text
SYSTEM_BOOT
SYSTEM_READY
MIC_OPENED
VOICE_ACTIVITY_STARTED
VOICE_ACTIVITY_ENDED
TRANSCRIPTION_STARTED
TRANSCRIPTION_FINISHED
THINKING_STARTED
SYNC_STARTED
SYNC_FINISHED
TASK_STARTED
TASK_PROGRESS
TASK_COMPLETED
TTS_STARTED
TTS_ENDED
APPROVAL_REQUIRED
APPROVAL_RESOLVED
WARNING_RAISED
ERROR_RAISED
ERROR_CLEARED
SYSTEM_OFFLINE
SYSTEM_ONLINE
PAUSE
RESUME
```

## 18.2 Parallele Zustände

Der Orb muss parallele Aktivität darstellen.

Beispiel:

```text
Jarvis spricht
+
drei Agenten arbeiten
+
System ist online
```

Darstellung:

- Core und Audio Halo = Speaking
- Mid Circuit Sphere = Speaking
- Outer Fragment Shell = Working
- drei kleine AgentMarkers = aktive Agenten
- Telemetry Ring = System Health

## 18.3 Priorität

```text
1. Error / Offline
2. Waiting Approval
3. Listening / Speaking
4. Transcribing / Thinking
5. Working / Syncing
6. Idle / Paused
```

Ein kritischer Zustand überlagert niedrigere Zustände, darf deren Kontext aber in der Detailanzeige nicht löschen.

---

# 19. Orb-Zustände im verbindlichen Referenzstil

## 19.1 Booting

Visuell:

- WhiteHotCore entzündet sich zuerst
- technische Linien werden schrittweise aus dem Kern aufgebaut
- Ringgruppen erscheinen nacheinander
- Fragmente fahren aus verschiedenen Radien in Position
- Farbe beginnt dunkelbraun/gold und erreicht normales Amber

Text:

```text
JARVIS WIRD INITIALISIERT
```

Kein gewöhnlicher Kreis-Loader.

---

## 19.2 Idle – ruhig und edel

Dies ist der wichtigste Dauerzustand.

Visuell:

- warme Gold-/Amber-Grundfarbe
- Kern atmet langsam
- äußere Fragmente bewegen sich nur minimal
- Ringgruppen driften auf unterschiedlichen Achsen
- sehr wenige Datenpakete
- dezente Tiefenpartikel
- keine aggressive Bewegung
- kein Cyan-Farbumschlag

Richtwerte:

```text
Core breath: 4.5–6.0 s
Outer rotation: sehr langsam
Inner rotation: langsam
Core scale: ±2 %
Glow intensity: 35–50 %
```

Text:

```text
BEREIT
```

---

## 19.3 Listening

Visuell:

- WhiteHotCore wird heller
- AudioReactiveHalo erscheint außerhalb der goldenen Kugel
- Halo darf Cyan enthalten, der Orb selbst bleibt Gold
- Ringsegmente richten sich leicht zur Kamera aus
- äußere Linien reagieren weich auf die Mikrofonamplitude
- bei Sprache laufen kurze Energieimpulse nach innen

Text:

```text
ICH HÖRE ZU
```

Datenschutz:

- Mic-Symbol sichtbar
- Zustand nur bei real aktivem Mikrofon
- kein dauerhafter Listening-Look bei geschlossenem Mikrofon

---

## 19.4 Transcribing

Visuell:

- AudioHalo friert weich aus
- dünne cyan-goldene Scanfläche fährt durch den Orb
- äußere Datenfragmente bewegen sich zum Kern
- Kern bleibt stabil
- kurze Segmentfolgen laufen wie Datenpakete entlang der Ringe

Text:

```text
SPRACHE WIRD VERARBEITET
```

---

## 19.5 Thinking

Visuell:

- innere Gyro-Ringe rotieren gegenläufig
- Energie zieht sich zum Kern
- der Kern wird weißgoldener
- einzelne violette Akzente sind nur in sehr kleinen inneren Segmenten erlaubt
- äußere Schale bleibt relativ ruhig
- kein Fortschrittsring ohne echte Daten

Text:

```text
ANALYSE
```

---

## 19.6 Syncing

Visuell:

- äußere Fragmente beginnen sich kurzzeitig auszurichten
- Datenpakete bewegen sich entlang mehrerer Umlaufbahnen
- dünne Cyan-Markierungen zeigen eingehende externe Daten
- goldene Ringsegmente schließen und öffnen sich zyklisch
- Quelle wird neben dem Orb genannt

Textbeispiele:

```text
KALENDER WIRD SYNCHRONISIERT
MAILS WERDEN AKTUALISIERT
HERMES-STATUS WIRD GELADEN
```

---

## 19.7 Working

Visuell:

- höchste kontrollierte geometrische Aktivität
- innere und mittlere Ebenen drehen auf unterschiedlichen Achsen
- goldene Energiepakete bewegen sich entlang der Circuit Sphere
- Fragmente verschieben sich leicht radial
- echte Agentenzahl über kleine Orbit-Marker
- echter Fortschritt über ProgressOrbit
- der Orb bleibt transparent und lesbar

Textbeispiele:

```text
RECHERCHE LÄUFT
PRÄSENTATION WIRD ERSTELLT
3 AGENTEN AKTIV
```

Klick:

```text
Live Activity oder Task Detail öffnen
```

---

## 19.8 Speaking

Visuell:

- goldene Wellen laufen vom Kern nach außen
- Ringsegmente reagieren auf die echte TTS-Amplitude
- AudioReactiveHalo arbeitet jetzt in Gold/Weiß statt dominantem Cyan
- äußere Working-Aktivität kann parallel sichtbar bleiben

Text:

```text
JARVIS SPRICHT
```

Barge-In:

- Stop-Schaltfläche sichtbar
- Unterbrechung sofort möglich

---

## 19.9 Waiting Approval

Visuell:

- Bewegung beruhigt sich bewusst
- äußerer Ring pulsiert in Amber
- mehrere Segmente halten in einer offenen Position
- dezentes Approval-Symbol außerhalb des Kerns
- keine aggressive Warnanimation

Text:

```text
FREIGABE ERFORDERLICH
```

Klick:

```text
konkretes Approval öffnen
```

---

## 19.10 Success

Visuell:

- kurzer weißgoldener Energieimpuls
- Ringe richten sich für einen Moment aus
- ProgressOrbit schließt sich
- danach Rückkehr zu Idle oder Working

Dauer:

```text
1–2 s
```

---

## 19.11 Warning

Visuell:

- Gold verschiebt sich etwas stärker zu Orange
- ein äußerer Ring bleibt unvollständig
- ruhiger Amber-Puls
- keine permanente Blinkanimation

Text:

```text
EINGESCHRÄNKTER BETRIEB
```

---

## 19.12 Error

Visuell:

- kurzer kontrollierter Eintrittsimpuls
- einzelne Fragmente verschieben sich unregelmäßig
- tiefes Orange/Rot nur als sekundärer Fehlerakzent
- Kern wird nicht vollständig rot eingefärbt
- ErrorFractureOverlay zeigt gebrochene Ringsegmente
- danach stabiler, gut lesbarer Zustand

Text:

```text
FEHLER
```

Klick:

```text
Error Detail / Audit öffnen
```

---

## 19.13 Offline

Visuell:

- fast vollständig entsättigtes Bronze
- Emission stark reduziert
- Ringbewegungen stoppen
- nur schwacher Core sichtbar
- Cached-/Offline-Kennzeichnung im Panel

Text:

```text
OFFLINE
```

---

## 19.14 Paused

Visuell:

- gedimmtes Gold/Bronze
- innere Ringe stehen
- äußere Fragmente bleiben sichtbar
- dezentes Pause-Symbol

Text:

```text
PAUSIERT
```

---

# 20. Orb-Übergänge

## 20.1 Ziel

Übergänge sollen wie eine Rekonfiguration eines technischen Hologrammkerns wirken, nicht wie ein Wechsel zwischen separaten Animationen.

## 20.2 Richtwerte

```text
Idle → Listening:       120–220 ms
Listening → Transcribe: 180–300 ms
Transcribe → Thinking:  220–400 ms
Thinking → Working:     300–550 ms
Working → Speaking:     180–320 ms
Any → Error:            max. 180 ms
Error → Recovered:      700–1200 ms
Offline → Online:       900–1600 ms
```

## 20.3 Technische Regel

- Szene nicht unmounten
- Geometrien wiederverwenden
- Shader-Uniforms interpolieren
- Rotation und Energiefluss im Renderloop ändern
- keine React-State-Updates pro Frame
- keine abrupten Materialwechsel
- bei Statuswechseln Crossfade über Intensität und Geschwindigkeit

---

# 21. Orb-Interaktionen

## Klick

- öffnet den Live-Activity-Drawer
- bei Approval direkt Approval Detail
- bei Error direkt Error Detail
- bei Working aktuellen Task öffnen
- bei Idle Command Bar fokussieren

## Hover

- aktueller Zustand
- aktuelle Aktion
- Laufzeit
- aktiver Agent
- Task-ID
- Datenquelle

## Maus-Parallaxe

- maximal 2–4 Grad Kameraversatz
- langsam geglättet
- abschaltbar
- deaktiviert bei Reduced Motion

## Tastatur

```text
Enter = Detail öffnen
Space = Voice starten oder Speaking stoppen
Esc   = Drawer schließen
```

## Screenreader

Beispiel:

```text
Jarvis arbeitet. Aufgabe Wettbewerbsanalyse. Drei Agenten aktiv. Fortschritt 62 Prozent.
```

---

# 22. Orb Performance

## 22.1 Qualitätsstufen

```text
auto
low
medium
high
ultra
```

`ultra` nur für leistungsfähige Systeme und nicht als Standard.

## 22.2 Skalierbare Elemente

- Partikelanzahl
- Fragmentanzahl
- Circuit-Line-Dichte
- Device Pixel Ratio
- Bloom-Auflösung
- Schatten vollständig vermeiden, sofern nicht zwingend
- ScanPlane-Komplexität
- AgentMarker-Anzahl
- Noise-Octaves

## 22.3 Zielwerte

```text
High/Ultra Desktop: 60 FPS Ziel
p95 Frame Time:      < 20 ms
Fallback:            stabile 30 FPS
```

## 22.4 Hintergrundtab

- Renderloop stark reduzieren oder pausieren
- nur Statusereignisse weiterverarbeiten
- bei Rückkehr Zustand sauber synchronisieren

## 22.5 WebGL-Kontextverlust

- erkennen
- 2D-Fallback aktivieren
- Recovery versuchen
- UI bleibt vollständig bedienbar

---

# 23. Reduced Motion, Accessibility und 2D-Fallback

## 23.1 Reduced Motion

Wenn `prefers-reduced-motion` aktiv ist:

- keine dauerhaften großen Rotationen
- keine Kameraparallaxe
- keine schnellen Fragmentbewegungen
- Status über Text, Icons, Opazität und langsame Helligkeitsänderung
- AudioWave stark vereinfacht
- Error ohne Flackern

## 23.2 Benutzereinstellungen

```text
Animationen: Voll / Reduziert / Aus
Orb-Qualität: Auto / Low / Medium / High / Ultra
Orb-Intensität: 0–100
Partikeldichte: 0–100
Audio-Reaktivität: Ein/Aus
Maus-Parallaxe: Ein/Aus
Bloom: Ein/Aus
```

## 23.3 2D-Fallback

Ein eigener SVG-/Canvas-Fallback bildet die Referenzidee vereinfacht ab:

- goldener Kern
- mehrere unvollständige technische Ringe
- fragmentierte Außenbögen
- Fortschrittsbogen
- Audio-Puls
- Approval/Error-Overlay
- alle Statuslabels

Keine Funktion darf durch fehlendes WebGL verloren gehen.

---

# 24. Dashboard-Designsystem gemäß Referenzbild

## 24.1 Gesamtwirkung

Das Dashboard muss wie ein hochwertiges technisches Command Center wirken:

- dunkel
- präzise
- datenreich
- modular
- leuchtend, aber nicht bunt
- futuristisch, aber weiterhin gut lesbar
- Desktop-first
- keine generische Admin-Template-Optik

## 24.2 Farbaufteilung

```text
80–85 % dunkles Navy/Schwarzblau
10–15 % Cyan/Türkis für Linien, Status und Interaktion
2–5 % semantische Akzentfarben
Gold/Orange primär im Orb und Orb-bezogenen Kontext
```

Gold darf nicht wahllos über alle Panels verteilt werden. Es kennzeichnet den AI Core und besondere direkte Jarvis-Aktivität.

## 24.3 Seitenhintergrund

- fast schwarzes Navy
- leichte radiale Aufhellung hinter dem Orb
- sehr feines Punkt-/Koordinatenraster
- vereinzelte horizontale HUD-Linien
- kein auffälliger Fotohintergrund
- keine starken Gradient-Bänder

## 24.4 Panel-Stil

Panels erhalten:

- tiefes transparentes Navy
- 1-Pixel-Cyanrahmen mit niedriger bis mittlerer Opazität
- feine innere Highlight-Linie
- abgeschrägte oder ausgesparte Ecken
- kleine technische Eckmarkierungen
- schwachen äußeren Cyan-Glow nur bei aktiven Panels
- klare Innenabstände
- möglichst wenig schwere Blur-Effekte

Beispiel:

```css
clip-path: polygon(
  0 10px,
  10px 0,
  calc(100% - 12px) 0,
  100% 12px,
  100% calc(100% - 8px),
  calc(100% - 8px) 100%,
  0 100%
);
```

Die konkrete Form darf pro Paneltyp leicht variieren, muss aber systematisch bleiben.

## 24.5 Panelhierarchie

```text
Level 0 = Seitenhintergrund
Level 1 = normale Module
Level 2 = aktive/ausgewählte Module
Level 3 = Attention / Approval / Critical
Level 4 = Dialog / Drawer / Command Overlay
```

## 24.6 Linien und Glow

- Linien scharf und dünn
- Glow sparsam
- Text niemals durch Glow unscharf
- keine Neonröhre um jedes Element
- aktiver Fokus stärker als statische Panels
- Gold-Glow nur im AI-Core-Bereich

## 24.7 Typografie

Empfehlung:

```text
Headings: Oxanium oder Rajdhani
Body:     Inter oder vergleichbare klare Sans-Serif
Metrics:  JetBrains Mono oder vergleichbare Monospace
```

Verwendung:

- Überschriften uppercase
- Letter Spacing moderat bis deutlich
- Zahlen/Metriken klar und kompakt
- Fließtext normal lesbar
- keine durchgängige Sci-Fi-Schrift für längere Inhalte

## 24.8 Icons

- dünne lineare Icons
- gleichmäßige Strichstärke
- Cyan im Normalzustand
- semantische Akzentfarbe bei Status
- keine gemischten Iconstile
- Menüpunkte immer Icon + Text

## 24.9 Tabellen und Listen

- keine weißen Standardtabellen
- dunkle Zeilen
- feine Cyan-Trennlinien
- Hover nur leicht aufgehellt
- Statuschips kompakt
- dichte Datenansicht, aber mit ausreichender Zeilenhöhe

## 24.10 Karten

Agenten-, Task-, Alert- und Providerkarten orientieren sich an der Referenz:

- dunkler technischer Körper
- kleines farbiges Iconfeld
- klarer Titel
- Statuszeile
- optionale Mini-Waveform oder Aktivitätslinie
- feiner Außenrahmen
- aktiver Zustand mit kontrolliertem Glow

## 24.11 Topbar

Enthält:

- Systemstatus links beziehungsweise links der Mitte
- Datum und Uhrzeit zentral oder zentral-nah
- globale Suche
- Notifications
- Settings
- Benutzer-/Operator-Profil
- Verbindungsstatus

Die Topbar bleibt flach, technisch und darf nicht wie eine normale Website-Navigation wirken.

## 24.12 Linke Navigation

Verbindliche Eigenschaften:

- vertikale Navigation
- Brandbereich oben
- Icon + Menütext
- aktive Auswahl mit Cyanrahmen/Glow
- Badge-Zähler bei Tasks, Approvals und Alerts
- scrollbar bei kleiner Höhe
- Voice-/Focus-Status kann im unteren Bereich sitzen
- einklappbar auf Iconbreite

## 24.13 Rechte Attention-Zone

Auf der Overview-Seite befindet sich eine priorisierte rechte Zone für:

- Live Intelligence / Live Activity
- offene Approvals
- kritische Alerts
- wichtige Mail
- blockierte Tasks

Diese Zone darf bei kleineren Displays unter den Orb wandern.

## 24.14 Persistente untere Command Bar

Angelehnt an die Referenz:

- über fast die gesamte Breite
- zentraler Voice-/Command-Call-to-Action
- Audio-Waveform oder Voice-Level
- aktuelle Voice-Aussage wie `Ich höre zu` oder `Jarvis arbeitet`
- schneller Stop-/Pause-Zugriff
- optionale Kontextchips links, zum Beispiel Wetter, Standort und Netzwerk
- Quick Action rechts, beispielsweise Executive Briefing

Die Command Bar darf auf Detailseiten kompakter werden, bleibt aber immer erreichbar.

## 24.15 Verbindliche Design-Tokens

```css
:root {
  --jarvis-bg-0: #01060c;
  --jarvis-bg-1: #03111d;
  --jarvis-bg-2: #061a2a;

  --jarvis-panel-0: rgba(3, 15, 27, 0.92);
  --jarvis-panel-1: rgba(5, 24, 39, 0.84);
  --jarvis-panel-active: rgba(6, 36, 54, 0.92);

  --jarvis-border-dim: rgba(30, 178, 218, 0.20);
  --jarvis-border: rgba(38, 215, 255, 0.42);
  --jarvis-border-active: rgba(79, 232, 255, 0.82);

  --jarvis-cyan: #27dcff;
  --jarvis-cyan-bright: #7af3ff;
  --jarvis-teal: #20e0d0;
  --jarvis-blue: #168cff;

  --jarvis-orb-gold: #ffb52e;
  --jarvis-orb-orange: #ff7a00;
  --jarvis-orb-hot: #fff2ba;
  --jarvis-orb-deep: #a94c00;

  --jarvis-success: #42efb0;
  --jarvis-warning: #ffc857;
  --jarvis-error: #ff4d54;
  --jarvis-violet: #9b7bff;

  --jarvis-text: #e8fbff;
  --jarvis-text-strong: #ffffff;
  --jarvis-muted: #7fa6b8;
  --jarvis-disabled: #405d6b;

  --jarvis-grid: rgba(39, 220, 255, 0.055);
  --jarvis-focus: #7af3ff;
}
```

Diese Werte sind die verbindliche Ausgangsbasis, bleiben aber themefähig.

## 24.16 Designkomponenten

Mindestens:

```text
JarvisShell
LeftCommandNav
TopStatusBar
BottomCommandBar
HudPanel
HudPanelHeader
CornerBrackets
StatusChip
HealthBadge
MetricCard
CircularMetric
TaskCard
AgentCard
ApprovalCard
AlertCard
ProviderCard
Timeline
ActivityFeed
ActivityRow
DataTable
FilterBar
SearchField
CommandPalette
VoiceControl
Drawer
Dialog
ConfirmDialog
SourceBadge
FreshnessBadge
EmptyState
ErrorState
OfflineState
Skeleton
```

---

# 25. Individualisierung

## 25.1 Unveränderliche Markenmerkmale des Default-Themes

Das Default-Theme behält:

- dunkle Navy-Grundfläche
- Cyan-HUD-Linien
- technische Panelrahmen
- goldenen Orb
- modulare Command-Center-Struktur

Alternative Themes dürfen später möglich sein. Das ausgelieferte Haupttheme bleibt jedoch die Referenzumsetzung.

## 25.2 Ohne Rebuild änderbar

- Cyan-Intensität
- Paneltransparenz
- Gold-Intensität des Orbs
- Orb-Größe
- Animationsintensität
- Partikeldichte
- Ringdichte innerhalb sicherer Presets
- Hintergrundraster
- Schriftgröße
- Menü-Reihenfolge
- sichtbare Widgets
- Startseitenlayout
- Sprache
- Datumsformat
- Zeitzone
- Soundeffekte
- Quality Mode

## 25.3 Theme-Datei

```json
{
  "id": "jarvis-command-gold-core",
  "name": "Jarvis Command / Gold Core",
  "tokens": {
    "color.primary": "#27dcff",
    "color.background": "#01060c",
    "color.orb": "#ffb52e",
    "color.orbHot": "#fff2ba"
  },
  "orb": {
    "preset": "gold-fragment-core",
    "particleDensity": 0.72,
    "fragmentDensity": 0.82,
    "glowIntensity": 0.78,
    "motionSpeed": 1.0,
    "mouseParallax": true
  },
  "panels": {
    "cornerStyle": "technical-cut",
    "borderIntensity": 0.55,
    "backgroundOpacity": 0.88
  }
}
```

## 25.4 Layout-Datei

```json
{
  "layoutId": "jarvis-command-overview",
  "widgets": [
    {
      "id": "ai-core-orb",
      "x": 3,
      "y": 0,
      "w": 6,
      "h": 7,
      "visible": true
    },
    {
      "id": "attention-feed",
      "x": 9,
      "y": 0,
      "w": 3,
      "h": 7,
      "visible": true
    }
  ]
}
```

## 25.5 Export/Import

- Theme exportieren
- Layout exportieren
- Orb-Preset exportieren
- Settings exportieren
- Secrets niemals exportieren
- JSON Schema vor Import validieren
- beschädigte Themes auf Default zurücksetzen

---

# 26. Navigationsstruktur im Referenzdesign

Linke Hauptnavigation:

```text
Overview
Tasks
Live Activity
Memory
Agents
Approvals
Mail & Communication
Calendar
Automations
Research
Files & Documents
Voice
Notifications & Alerts
System
Audit & History
Settings
```

## 26.1 Regeln

- aktive Seite mit Cyanrahmen und leichtem Innen-Glow
- Icon links, Text rechts
- Zähler für Tasks, Approvals, Mail und Alerts
- Untergruppen nur bei Bedarf
- Navigation einklappbar
- Tooltips im kompakten Modus
- Menüreihenfolge über Settings änderbar

## 26.2 Global immer sichtbar

```text
Global Search / Command Palette
Voice Button
Stop
Pause
Connection Status
Current Mode
User / Operator Profile
```

---

# 27. Overview / Home im neuen Design

## 27.1 Ziel

Die Startseite übernimmt die visuelle Struktur des Referenz-Dashboards, wird aber an die in diesem Plan definierten Module angepasst.

Der Benutzer muss innerhalb von drei Sekunden erkennen:

- Jarvis-Zustand
- aktuelle Arbeit
- offene Aufmerksamkeitspunkte
- aktive Agenten und Tasks
- Systemzustand
- nächste Termine
- wichtige Kommunikation

## 27.2 Verbindliches Desktop-Grundraster

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Top Status Bar: System | Datum/Zeit | Suche | Alerts | Settings | User   │
├──────────────┬──────────────────────────────────────┬────────────────────┤
│              │                                      │                    │
│ Left Nav     │         AI CORE / GOLD ORB           │ Attention / Live   │
│              │                                      │ Intelligence       │
│              │  Status + aktuelle Tätigkeit         │ Approvals / Alerts │
│              │                                      │ Important Mail     │
├──────────────┼──────────────────────┬───────────────┼────────────────────┤
│ Voice Status │ Active Agents        │ Mission/Tasks │ Quick Commands     │
├──────────────┼──────────────────────┼───────────────┼────────────────────┤
│ Focus Mode   │ System Monitor       │ Memory        │ Models/Services    │
├──────────────┴──────────────────────┴───────────────┴────────────────────┤
│ Persistent Bottom Command / Voice Bar                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

Die Karten dürfen je nach Bildschirmbreite anders verteilt werden.

## 27.3 AI-Core-Panel

Das zentrale Panel enthält:

- goldenen 3D-Orb
- keinen blauen Drahtgitterglobus
- keinen dauerhaft großen `JARVIS AI CORE`-Text mitten in der Kugel
- Statuslabel unter oder oberhalb des Orbs
- aktuelle Tätigkeit
- aktiven Agenten
- Fortschritt, sofern real
- Klickfläche zum Öffnen von Live Activity

Optional außerhalb des Orbs:

```text
JARVIS
AI CORE
Version / Mode
```

Der Text darf den Orb nicht verdecken.

## 27.4 Linke kompakte Core-Übersicht

In einem schmalen Panel neben oder unter dem Orb:

```text
AI Core
Memory
Voice
Agents
Models
System
```

Jeder Eintrag:

- Icon
- Zustand
- kurzer Wert
- Farbakzent
- Klickziel

## 27.5 Rechte Attention-/Intelligence-Zone

Enthält priorisiert:

```text
P0/P1 Alerts
Approvals
wichtige Mails
blockierte Tasks
überfällige Tasks
kritische Systemmeldungen
```

Live-Feed-Zeilen erhalten:

- Icon
- Titel
- kurze Beschreibung
- Severity
- Zeit
- Zielseite

## 27.6 Active Agents

Kompakte Agentenkarten wie in der Referenz:

- farbiges Iconfeld
- Agentenname
- Status
- aktuelle Aufgabe
- Mini-Aktivitätslinie
- Klick zum Agent Detail

## 27.7 Mission Timeline / Tasks

Zeigt:

- heutige Termine
- aktuelle Tasks
- Deadlines
- erwartete Fertigstellung
- Blocker

Die Timeline ist kein Ersatz für das vollständige Kanban.

## 27.8 Quick Commands

Capability-basiert:

```text
Neue Aufgabe
Kalender öffnen
Voice starten
Executive Briefing
E-Mail prüfen
Aktuelle Arbeit öffnen
Automationen pausieren
```

## 27.9 System Monitor

Angelehnt an die runden Metriken der Referenz:

```text
CPU
RAM
GPU / VRAM
D:\ Speicher
```

Zusätzlich kleine Zustände für:

```text
WSL
Hermes
Kimi
Local LLM
Voice
```

## 27.10 Memory Insights

- gespeicherte Memories
- neue Memories heute
- verbundene Personen/Projekte
- letzte Aktualisierung
- kleine Netzwerk-/Graphvorschau
- Link zu Memory

## 27.11 Models & Services

Statt der im Referenzbild sichtbaren Beispielanbieter werden die realen Systemkomponenten angezeigt:

```text
Kimi K3
Qwen Local
Hermes
Voice STT
Voice TTS
Windows Worker
weitere konfigurierte Provider
```

## 27.12 Voice-Status im linken unteren Bereich

- Wake Word
- Mic Status
- Speaker Verification
- Trusted Session
- Mini-Waveform
- Push-to-talk
- Focus Mode

## 27.13 Untere Command Bar

Verbindlich dauerhaft erreichbar.

Enthält:

- Text-/Voice-Eingabe
- `Talk to Jarvis` beziehungsweise deutsche Beschriftung
- Live-Audio-Waveform
- Status `Ich höre zu`, `Jarvis arbeitet`, `Bereit`
- Stop
- Pause
- optional Wetter-/Standort-/Netzwerkchips
- Executive Briefing als Quick Action

## 27.14 Pflichtinhalte

- goldener Orb
- Jarvis Online/Degraded/Offline
- aktuelle Tätigkeit
- aktiver Agent
- aktive Agentenzahl
- laufende Tasks
- offene Approvals
- kritische Alerts
- wichtige Mailanzahl
- nächste Termine
- Systemzustand
- letzte Aktualisierung
- Quick Commands
- permanente Command Bar

## 27.15 Responsive Verhalten

### Breiter Desktop

- linke Navigation
- zentraler großer Orb
- rechte Attention-Zone
- mehrere Kartenreihen

### Standard-Laptop

- Orb bleibt größte Fläche
- rechte Zone schmaler
- Karten in zwei Reihen
- Navigation kompakter

### Tablet

- Navigation als Drawer
- Orb oben
- Attention direkt darunter
- Karten in zwei Spalten

### Mobile

- kompakter Orb
- Command Bar prominent
- Approvals/Alerts zuerst
- Detailmodule als gestapelte Karten

## 27.16 Abnahme

- Design ist auf den ersten Blick derselben visuellen Familie wie die Referenz
- Orb entspricht der goldenen holografischen Referenzform
- kein blauer Standardglobus bleibt übrig
- keine statischen Screenshot-Hintergründe
- alle Panels sind echte responsive Komponenten
- alle Menüpunkte dieses Plans sind erreichbar
- Orb reagiert auf sämtliche Mock-Zustände
- Startseite bleibt bei ausgefallenem Adapter nutzbar
- Layout ist konfigurierbar
- Gold und Cyan sind klar getrennt eingesetzt
- Command Bar bleibt immer erreichbar

---

# 28. Tasks / Kanban

## 28.1 Ansichten

```text
Kanban
Liste
Timeline
Meine Entscheidungen
```

## 28.2 Spalten

```text
Triage
Todo
Ready
Running
Waiting
Review
Done
```

## 28.3 Taskkarte

- Titel
- Priorität
- Status
- Agent
- Modell
- Fortschritt
- Laufzeit
- Blocker
- letzte Aktivität
- Artefaktanzahl
- Quelle
- Freshness

## 28.4 Task Detail

Tabs:

```text
Overview
Steps
Activity
Tools
Sources
Artifacts
Approvals
Errors
Audit
```

## 28.5 Aktionen

Capability-basiert:

```text
Create
Assign
Move
Pause
Resume
Cancel
Retry
Open Artifact
Approve Result
```

## 28.6 Regeln

- Drag & Drop nur, wenn Update-Capability vorhanden
- unbekannter Fortschritt = indeterminate
- Cancel benötigt Bestätigung
- Task-Historie bleibt erhalten

---

# 29. Live Activity

## 29.1 Zweck

Die wichtigste Transparenzansicht neben dem Orb.

## 29.2 Inhalte

- Echtzeit-Events
- aktueller Agent
- aktuelle Aktion
- Tool Call
- Adapter
- Modell
- Task-ID
- Dauer
- Status
- Correlation ID
- Ergebnis
- Fehler

## 29.3 Filter

```text
Agent
Task
Tool
Adapter
Severity
Model
Status
Time Range
```

## 29.4 Aktivitätsbaum

```text
User Request
└── Task
    ├── Agent
    │   ├── Tool Call
    │   ├── Source Read
    │   └── Result
    └── Artifact
```

## 29.5 Funktionen

- Live pausieren
- automatisch scrollen
- Event Detail
- Copy Correlation ID
- zu Task springen
- zu Agent springen
- Raw JSON nur in Debug/Admin

---

# 30. Memory

## 30.1 Memory-Typen

```text
Profile
Preference
Fact
Person
Company
Project
Relationship
Instruction
Episode
Decision
```

## 30.2 Pflichtfelder

- Inhalt
- Typ
- Quelle
- Confidence
- erstellt
- zuletzt bestätigt
- Ablauf/TTL
- Tags
- verknüpfte Entitäten
- locked/pinned

## 30.3 Funktionen

- semantische Suche
- Filter
- Detailansicht
- Bearbeiten
- Vergessen/Löschen
- Sperren
- Konflikte anzeigen
- Herkunft anzeigen
- Memory-Verlauf
- Export

## 30.4 Datenschutz

- sensible Memories markieren
- Löschung nachvollziehbar
- keine versteckten Memories
- Benutzer kann Herkunft und Nutzung sehen

---

# 31. Agents

## 31.1 Agentenkarte

- Name
- Rolle
- Status
- aktueller Task
- Modell
- Reasoning-Stufe
- Fähigkeiten
- aktive Tools
- Laufzeit
- Heartbeat
- Erfolgs-/Fehlerquote
- letzte Aktivität

## 31.2 Detail

Tabs:

```text
Overview
Capabilities
Current Task
History
Tools
Performance
Errors
Configuration
```

## 31.3 Aktionen

```text
Pause
Resume
Stop
Assign Task
Open Activity
```

Nur wenn Adapter diese Aktionen unterstützt.

---

# 32. Approvals

## 32.1 Ziel

Alle Aktionen, die eine menschliche Freigabe benötigen, an einer Stelle.

## 32.2 Approval-Karte

- Aktion
- Risikostufe
- Agent
- Task
- Begründung
- Auswirkungen
- Vorschau
- Ablaufzeit
- benötigte Authentifizierung

## 32.3 Typen

```text
E-Mail senden
Termin ändern
Nachricht senden
Datei löschen
Bestellung
Zahlung
Vertrag
Systemänderung
```

## 32.4 Aktionen

```text
Approve
Reject
Edit then Approve
Request More Context
Open Source
```

## 32.5 Sicherheit

- Tier 3 nie nur per Voice
- Approval-Token kurzlebig
- serverseitige Rechteprüfung
- Idempotenz
- vollständiges Audit
- vor Ausführung finaler Recheck

---

# 33. Mail & Communication

## 33.1 Kanäle

```text
E-Mail
Telegram
WhatsApp
SMS
Telefon
weitere Adapter
```

## 33.2 Unified Inbox

- Priorität
- Kanal
- Absender
- Thread
- Zusammenfassung
- Antwort nötig
- Entwurf
- Deadline
- verknüpfter Task
- Status

## 33.3 E-Mail-Detail

- Thread
- Anhänge
- AI-Zusammenfassung
- extrahierte Termine
- extrahierte Aufgaben
- vorgeschlagene Antwort
- Versandfreigabe
- Quelle und Original

## 33.4 Kanalstatus

```text
Online
Degraded
Offline
Read-only
Nicht konfiguriert
```

## 33.5 Kein automatisches Senden

Standard:

```text
Entwurf automatisch
Versand mit Freigabe
```

---

# 34. Calendar

## 34.1 Ansichten

```text
Tag
Woche
Monat
Agenda
```

## 34.2 Funktionen

- Termine
- Konflikte
- freie Zeit
- Vorschläge
- Meeting Briefing
- Teilnehmerkontext
- verknüpfte Mails
- verknüpfte Tasks
- Reminder
- Zeitzone

## 34.3 Schreibaktionen

Capability- und Approval-basiert:

```text
Create
Reschedule
Cancel
Invite
Respond
```

---

# 35. Automations

## 35.1 Modell

```text
Trigger
Conditions
Actions
Escalation
```

## 35.2 Beispiele

```text
Neue wichtige Mail
→ Priorität P1
→ Telegram
→ nach 10 Minuten ohne Bestätigung Anruf
```

## 35.3 Pflichtfunktionen

- Liste
- aktiv/inaktiv
- Dry Run
- Test mit Mock-Daten
- Run History
- letzter Erfolg
- letzter Fehler
- nächste Ausführung
- Pause All
- Bearbeitung über Wizard
- Versionierung

## 35.4 Keine Blackbox

Jede Automation zeigt:

- warum ausgelöst
- welche Bedingungen erfüllt
- welche Aktionen ausgeführt
- welches Ergebnis

---

# 36. Research

## 36.1 Projektansicht

- Thema
- Auftrag
- Status
- Agenten
- Fortschritt
- Quellen
- Findings
- Widersprüche
- Artefakte
- Ergebnis
- Kosten/Laufzeit

## 36.2 Quellenansicht

- Titel
- Domain
- Abrufzeit
- Relevanz
- Verlässlichkeit
- unterstützte Aussage
- Zitat/Extrakt
- Status

## 36.3 Transparenz

Der Benutzer muss erkennen können:

```text
Welche Quelle stützt welche Aussage?
```

## 36.4 Export

```text
Markdown
PDF später
DOCX später
PPTX später
JSON
```

---

# 37. Files & Documents

## 37.1 Kategorien

```text
Generated
Uploaded
Reports
Presentations
Invoices
Research
Exports
Temporary
```

## 37.2 Dateikarte

- Name
- Typ
- Größe
- Version
- Ersteller/Agent
- Task
- erstellt
- geändert
- Speicherort
- Tags
- Vorschau

## 37.3 Funktionen

- Suche
- Filter
- Preview
- Open
- Download
- Versionen
- Lineage
- Rename
- Delete mit Freigabe
- Link zu Task/Audit

## 37.4 Sicherheit

Preview untrusted files sandboxen.

---

# 38. Voice

## 38.1 Status

- Mikrofon
- Wake Word
- Speaker Verification
- erkannter Sprecher
- Trusted Session
- STT
- TTS
- lokales Modell
- Latenz
- Audio Device

## 38.2 Live-Metriken

```text
Wake Word latency
Speaker verification latency
STT latency
Router latency
First token
TTS first audio
```

## 38.3 Voice Enrollment

- Owner-Profil
- Sample-Anzahl
- Qualität
- Calibration
- Threshold
- letzter Test

## 38.4 Privatsphäre

- Rohaufnahme speichern: standardmäßig aus
- Voice History optional
- klare Löschfunktion
- Mikrofonaktivität immer sichtbar

## 38.5 Testmodus

```text
Test Wake Word
Test Speaker
Test STT
Test TTS
Full Pipeline Test
```

---

# 39. Notifications & Alerts

## 39.1 Prioritäten

```text
P0 Critical
P1 Urgent
P2 Important
P3 Normal
P4 Information
```

## 39.2 Funktionen

- Acknowledge
- Snooze
- Resolve
- Open Source
- Escalation anzeigen
- Kanalstatus
- Notification History

## 39.3 Regeln

P0/P1 deutlich, aber nicht durch gefährliches Dauerblinken.

## 39.4 Eskalationsansicht

```text
Dashboard
→ Telegram
→ WhatsApp
→ Telefon
```

mit Zeitstempeln.

---

# 40. System

## 40.1 Hardware

- CPU
- RAM
- GPU
- VRAM
- Temperaturen, wenn verfügbar
- D:\ Speicher
- Netzwerk

## 40.2 Dienste

- Hermes
- Kimi API
- Local Qwen
- Voice
- WSL
- Control API
- Event Stream
- Adapter
- Windows Worker

## 40.3 Adapter Matrix

| Adapter | Status | Latenz | Capabilities | Version | Letzter Erfolg |
|---|---|---:|---|---|---|

## 40.4 Aktionen

```text
Healthcheck
Reconnect
Restart Adapter
Open Logs
```

Restart nur mit Berechtigung und Audit.

---

# 41. Audit & History

## 41.1 Erfasst

- Benutzeraktion
- Agentenaktion
- Tool Call
- Approval
- Modell
- Reasoning-Stufe
- Adapter
- Task
- Ergebnis
- Fehler
- Dauer
- Correlation ID

## 41.2 Filter

```text
Zeit
Actor
Agent
Task
Tool
Adapter
Action
Severity
Result
```

## 41.3 Detail

- Event
- Kontext
- Vorher/Nachher
- Quelle
- Approval
- Child Events
- Artefakte

## 41.4 Manipulationsschutz

Für sensible Aktionen optional:

```text
append-only + hash chain
```

---

# 42. Settings

## 42.1 Bereiche

```text
Profile
Dashboard
Theme
Orb
Navigation
Adapters
Models & Routing
Voice
Notifications
Security
Approvals
Data Retention
Backups
Developer
```

## 42.2 Adapter Settings

Adapter liefert ein JSON Schema.

Das Dashboard generiert daraus die Konfigurationsmaske.

Secrets:

- maskiert
- nur serverseitig
- nie zurück an Browser
- Test Connection Button

## 42.3 Orb Settings

- Preset
- Größe
- Intensität
- Geschwindigkeit
- Partikel
- Audio-Reaktivität
- Reduced Motion
- Quality
- Farben je Status
- 2D/3D/Auto

## 42.4 Navigation

- Reihenfolge
- sichtbare Menüs
- Default Page
- kompakt/erweitert

## 42.5 Dashboard Layout

- Widgets verschieben
- Größe ändern
- ein-/ausblenden
- Presets
- Reset
- Export/Import

---

# 43. Global Command Bar

## 43.1 Immer erreichbar

```text
Ctrl+K
/
Button in Topbar
```

## 43.2 Funktionen

- Jarvis fragen
- Aufgabe anlegen
- Navigation
- Memory suchen
- Agent suchen
- Datei öffnen
- Automation starten
- Settings öffnen
- Stop/Pause

## 43.3 Voice

- Push-to-talk
- Wake-Word-Status
- Listening-Indikator
- Stop

## 43.4 Command Preview

Bei schreibender oder kritischer Aktion:

```text
Du bist dabei:
E-Mail an X zu senden
```

vor Ausführung.

## 43.5 History

- letzte Befehle
- wiederholen
- sensible Befehle nicht ungeschützt speichern

---

# 44. Mock-First Architektur

# 44.1 Grundregel

Mock ist kein nachträglicher Fake.

Der Mock Adapter ist eine vollständige, contract-konforme Referenzimplementierung.

## 44.2 Modus

```env
JARVIS_DATA_MODE=mock
```

## 44.3 Mock Service Worker

Browser- und Node-Mocks teilen sich dieselben Handler und Datenmodelle.

## 44.4 Deterministische Daten

- feste Seeds
- kontrollierbare Uhr
- reproduzierbare IDs
- reproduzierbare Latenz
- reproduzierbare Fehler

## 44.5 Mock Event Engine

Kann Events abspielen:

```text
listening
transcribing
thinking
working
speaking
approval
error
recovery
```

## 44.6 Scenario Console

Route nur im Development-/QA-Modus:

```text
/dev/scenarios
```

Funktionen:

- Szenario auswählen
- Uhr vorspulen
- Adapter offline schalten
- Latenz einstellen
- Fehlerquote einstellen
- Capability ein-/ausschalten
- Event abspielen
- Orb-Zustand erzwingen
- Snapshot zurücksetzen

---

# 45. Verbindliche Mock-Szenarien

## 45.1 Clean Idle

- alles online
- keine Alerts
- keine Approvals
- Orb Idle

## 45.2 Listening

- Mikrofon aktiv
- Voice Level simuliert
- Orb Listening

## 45.3 Voice Pipeline

```text
Listening
→ Transcribing
→ Thinking
→ Speaking
→ Idle
```

## 45.4 Multi-Agent Working

- drei Agenten aktiv
- zwei Tasks
- echter/indeterminate Fortschritt
- Orb Working + Agent Marker

## 45.5 Syncing

- Mail und Kalender synchronisieren
- Orb Syncing
- Activity Feed Events

## 45.6 Approval Waiting

- E-Mail-Versand wartet
- Orb Waiting Approval
- Overview Attention Card

## 45.7 Critical Alert

- P0
- System bleibt bedienbar
- Orb Error/Warning nach Semantik
- Alert Escalation sichtbar

## 45.8 Partial Outage

- Mail offline
- Tasks online
- Overview weiter nutzbar
- Capability/Health korrekt

## 45.9 Adapter Recovery

```text
Online
→ Timeout
→ Degraded
→ Offline
→ Recovering
→ Online
```

## 45.10 Empty New Installation

- keine Daten
- sinnvolle Empty States
- kein kaputtes Layout

## 45.11 High Load

- 1000 Tasks
- 10.000 Activity Events
- 100 Agents
- Virtualisierung/Pagination

## 45.12 Long German Text

- lange Betreffzeilen
- lange Tasknamen
- Umlaute
- keine Layoutbrüche

## 45.13 Reduced Motion

- alle Orb-Zustände
- Animation reduziert
- Information vollständig

## 45.14 WebGL Failure

- 2D-Fallback
- keine unbedienbare Startseite

---

# 46. Storybook

Für jede relevante Komponente Stories anlegen.

## 46.1 Orb Stories

```text
Booting
Idle
Listening low audio
Listening high audio
Transcribing
Thinking
Syncing
Working indeterminate
Working 62 percent
Speaking
Waiting Approval
Success
Warning
Error
Offline
Paused
Reduced Motion
Low Quality
2D Fallback
```

## 46.2 Domain Stories

- leere Liste
- Loading
- Error
- Offline
- Stale
- normale Daten
- lange Daten
- große Datenmenge
- read-only capability
- fehlende capability

---

# 47. REST-Endpunkte

Mindestens:

## Meta / Health

```text
GET /api/v1/meta
GET /api/v1/health
GET /api/v1/capabilities
GET /api/v1/adapters
GET /api/v1/adapters/{id}/health
```

## Overview

```text
GET /api/v1/overview
GET /api/v1/status
GET /api/v1/orb/status
```

## Tasks

```text
GET  /api/v1/tasks
POST /api/v1/tasks
GET  /api/v1/tasks/{id}
PATCH /api/v1/tasks/{id}
POST /api/v1/tasks/{id}/cancel
POST /api/v1/tasks/{id}/retry
POST /api/v1/tasks/{id}/pause
POST /api/v1/tasks/{id}/resume
```

## Activity

```text
GET /api/v1/activity
GET /api/v1/activity/{id}
```

## Memory

```text
GET    /api/v1/memory
POST   /api/v1/memory
GET    /api/v1/memory/{id}
PATCH  /api/v1/memory/{id}
DELETE /api/v1/memory/{id}
POST   /api/v1/memory/search
```

## Agents

```text
GET  /api/v1/agents
GET  /api/v1/agents/{id}
POST /api/v1/agents/{id}/pause
POST /api/v1/agents/{id}/resume
POST /api/v1/agents/{id}/stop
```

## Approvals

```text
GET  /api/v1/approvals
GET  /api/v1/approvals/{id}
POST /api/v1/approvals/{id}/approve
POST /api/v1/approvals/{id}/reject
POST /api/v1/approvals/{id}/request-context
```

## Communication

```text
GET  /api/v1/communication/channels
GET  /api/v1/communication/threads
GET  /api/v1/communication/threads/{id}
POST /api/v1/communication/drafts
PATCH /api/v1/communication/drafts/{id}
POST /api/v1/communication/drafts/{id}/request-send
```

## Calendar

```text
GET  /api/v1/calendar/events
GET  /api/v1/calendar/events/{id}
GET  /api/v1/calendar/conflicts
GET  /api/v1/calendar/briefings
POST /api/v1/calendar/proposals
```

## Automations

```text
GET  /api/v1/automations
POST /api/v1/automations
GET  /api/v1/automations/{id}
PATCH /api/v1/automations/{id}
POST /api/v1/automations/{id}/test
POST /api/v1/automations/{id}/enable
POST /api/v1/automations/{id}/disable
GET  /api/v1/automations/{id}/runs
```

## Research

```text
GET  /api/v1/research/projects
GET  /api/v1/research/projects/{id}
GET  /api/v1/research/projects/{id}/sources
GET  /api/v1/research/projects/{id}/findings
GET  /api/v1/research/projects/{id}/artifacts
```

## Files

```text
GET    /api/v1/files
GET    /api/v1/files/{id}
GET    /api/v1/files/{id}/preview
GET    /api/v1/files/{id}/download
DELETE /api/v1/files/{id}
```

## Voice

```text
GET  /api/v1/voice/status
GET  /api/v1/voice/devices
GET  /api/v1/voice/metrics
GET  /api/v1/voice/profiles
POST /api/v1/voice/test
POST /api/v1/voice/stop
```

## Notifications

```text
GET  /api/v1/notifications
POST /api/v1/notifications/{id}/acknowledge
POST /api/v1/notifications/{id}/snooze
POST /api/v1/notifications/{id}/resolve
```

## System

```text
GET  /api/v1/system/metrics
GET  /api/v1/system/services
GET  /api/v1/system/storage
GET  /api/v1/system/models
POST /api/v1/system/services/{id}/healthcheck
```

## Audit

```text
GET /api/v1/audit/events
GET /api/v1/audit/events/{id}
GET /api/v1/audit/export
```

## Settings

```text
GET   /api/v1/settings
PATCH /api/v1/settings
GET   /api/v1/settings/schema
GET   /api/v1/settings/adapters
PATCH /api/v1/settings/adapters/{id}
POST  /api/v1/settings/adapters/{id}/test
GET   /api/v1/settings/themes
POST  /api/v1/settings/themes/import
GET   /api/v1/settings/export
```

## Command

```text
POST /api/v1/commands
POST /api/v1/commands/stop
POST /api/v1/commands/pause
POST /api/v1/commands/resume
```

---

# 48. Frontend-Datenregeln

1. Nur Generated SDK verwenden.
2. Kein beliebiges `fetch()` in Komponenten.
3. Keine Adapter-URLs im Browser.
4. Query Keys zentral definieren.
5. Mutationen invalidieren gezielt.
6. Echtzeitereignisse aktualisieren Cache deterministisch.
7. Event-Gap löst Snapshot-Refresh aus.
8. Optimistic UI nur bei sicheren, reversiblen Aktionen.
9. Approvals nie nur optimistic behandeln.
10. Stale-Daten sichtbar kennzeichnen.

---

# 49. Sicherheit

## 49.1 Default

```text
localhost only
```

## 49.2 Kein direkter Adapterzugriff

Browser:

```text
Dashboard → Control API
```

Nicht:

```text
Dashboard → Hermes/Voice/GMX direkt
```

## 49.3 Rollen

V1 mindestens:

```text
owner
operator
viewer
```

## 49.4 Sessions

- sichere Cookies
- CSRF-Schutz
- kurze sensible Reauth
- Session Timeout
- Logout All

## 49.5 CSP

Strikte Content Security Policy.

## 49.6 Secrets

- nur serverseitig
- Windows Credential Manager oder Secret Store
- nicht in SQLite im Klartext
- nicht im Browser
- nicht in Logs

## 49.7 Remote Access

Wenn später von außen:

- TLS
- VPN oder Zero-Trust-Zugang
- keine offene Portfreigabe direkt zum Dashboard
- Rate Limits
- Login Protection

---

# 50. Observability

## 50.1 Correlation

Jede Useraktion erhält:

```text
correlationId
```

Weitergereicht an:

- Control API
- Adapter
- Task
- Tool
- Audit
- Event

## 50.2 Logs

Strukturiert:

```json
{
  "time": "...",
  "level": "info",
  "service": "control-api",
  "correlationId": "...",
  "message": "..."
}
```

## 50.3 Metriken

- Request latency
- Error rate
- WebSocket connections
- Events/s
- Adapter health
- cache hit
- Orb FPS
- WebGL memory info
- frontend errors

## 50.4 Redaction

- Tokens
- Passwörter
- Mail-Credentials
- API Keys
- PINs
- sensible personenbezogene Daten nach Policy

---

# 51. Tests

## 51.1 Contract Tests

- OpenAPI lint
- AsyncAPI lint
- Schema validation
- examples valid
- generated code up to date
- breaking change detection

## 51.2 Unit Tests

- Mapper
- Adapter Registry
- State Machines
- Orb arbitration
- permissions
- formatting
- error mapping

## 51.3 Component Tests

- alle Zustände
- Keyboard
- loading/error/empty
- capability-driven UI

## 51.4 Visual Regression

- alle Orb-Zustände
- alle Kernseiten
- 1080p
- 1440p
- 4K
- tablet
- reduced motion
- long German text

## 51.5 E2E

Playwright:

- Navigation
- Mock scenario switch
- Task flow
- Approval flow
- Adapter outage
- Orb state changes
- command bar
- settings
- theme switch
- reconnect
- 2D fallback

## 51.6 Performance

- 30 Minuten Orb ohne Memory Leak
- 10.000 Activity Events
- 1.000 Tasks
- WebSocket reconnect
- background tab
- GPU quality scaling

## 51.7 Accessibility

- Tastatur
- Fokus
- Labels
- Kontrast
- Reduced Motion
- Screenreader
- keine color-only states

---

# 52. Orb-Testbarkeit

Animationen müssen im Testmodus deterministisch steuerbar sein.

## 52.1 Test Clock

```text
fixedTime
animationProgress
audioFixture
```

## 52.2 Screenshots

Für jeden Zustand:

```text
entry
mid
stable
exit
```

## 52.3 Audio Fixtures

```text
silence
normal speech
loud speech
tts speech
spike
```

## 52.4 Performance Debug Overlay

Nur Development:

- FPS
- Frame Time
- Draw Calls
- Geometries
- Textures
- VRAM approximiert
- Quality Level

---

# 53. Responsiveness

## Desktop

Volle Dashboard-Ansicht.

## Tablet

- Navigation einklappbar
- Orb zentral
- Attention als Drawer
- Karten untereinander

## Mobile

- Orb kompakt
- Command Bar prominent
- Tasks/Approvals/Alerts priorisiert
- komplexe Tabellen als Karten
- Systemdetails sekundär

Das Dashboard ist Desktop-first, aber nicht desktop-only.

---

# 54. Deployment auf dem Benutzergerät

## 54.1 Pfad

```text
D:\Jarvis\dashboard\
```

## 54.2 Empfohlene Laufzeit

Control API unter WSL2 oder Node-Laufzeit, Frontend statisch/SSR entsprechend Architektur.

## 54.3 Lokale URL

Beispiel:

```text
http://127.0.0.1:3100
```

Port ist konfigurierbar.

## 54.4 Daten

```text
D:\Jarvis\dashboard\data\
D:\Jarvis\dashboard\logs\
D:\Jarvis\dashboard\backups\
```

## 54.5 Autostart

Erst nach vollständigem Mock-/QA-Test.

---

# 55. Implementierungsphasen

# Phase 0 – Projektgrundlage

- Monorepo
- TypeScript strict
- Lint
- Format
- Test Runner
- CI
- Grunddokumentation

**Gate:** Clean Build.

---

# Phase 1 – Contracts

- Common Schemas
- OpenAPI
- AsyncAPI
- Beispiele
- Generator
- SDK
- Contract CI

**Gate:** Alle Verträge validieren.

---

# Phase 2 – Adapter Core

- Base Adapter
- Manifest
- Registry
- Ports
- Health
- Capabilities
- Error Mapping
- Conformance Testkit

**Gate:** Example Adapter besteht Conformance.

---

# Phase 3 – Mock Platform

- Mock Adapter für jedes Modul
- MSW
- Event Simulator
- Scenario Console
- Seed Data
- Mock Clock

**Gate:** Alle Contracts über Mock bedienbar.

---

# Phase 4 – Design System

- Tokens
- Theme
- Layout
- Core Components
- Navigation
- Loading/Error/Empty

**Gate:** Storybook vollständig.

---

# Phase 5 – Orb Prototype

- Renderer
- Shader
- Ring Layers
- Particles
- State Machine
- 2D Fallback
- Reduced Motion
- Storybook States
- Performance Overlay

**Gate:** Alle Orb-Zustände einzeln bestanden.

---

# Phase 6 – Overview

- Startseite
- Orb Integration
- Attention
- Quick Actions
- Active Tasks
- System Health
- Activity Strip

**Gate:** alle Overview-Szenarien.

---

# Phase 7 – Kernmodule

In Reihenfolge:

```text
Tasks
Activity
Approvals
Agents
Memory
Notifications
```

**Gate:** vollständige Mock-Flows.

---

# Phase 8 – Kommunikationsmodule

```text
Mail & Communication
Calendar
Automations
```

**Gate:** Read/write capability korrekt.

---

# Phase 9 – Arbeitsmodule

```text
Research
Files & Documents
Voice
System
Audit
```

**Gate:** sämtliche Menüs vollständig.

---

# Phase 10 – Settings & Customization

- Theme Editor
- Orb Settings
- Layout Editor
- Adapter Settings
- Model Routing UI
- Export/Import

**Gate:** Änderungen ohne Rebuild.

---

# Phase 11 – Realtime Robustness

- Reconnect
- Gap Detection
- Replay
- Backfill
- Offline Cache
- Stale UI
- Event Load

**Gate:** Ausfall-/Recovery-Tests.

---

# Phase 12 – Security

- Auth
- Rollen
- CSRF
- CSP
- Secrets
- Approval Enforcement
- Audit

**Gate:** Security Checklist.

---

# Phase 13 – QA

- Unit
- Contract
- Visual
- E2E
- Accessibility
- Performance
- Browser
- Long Run

**Gate:** Definition of Done.

---

# Phase 14 – Handoff

- Adapter SDK
- Beispieladapter
- Integrationsanleitung
- Mapping-Tabellen
- Config Templates
- Troubleshooting
- Übergabe an Kollegen

---

# 56. Handoff für den Kollegen

Der Kollege erhält:

```text
1. lauffähiges Dashboard in Mock Mode
2. Jarvis Control API
3. OpenAPI Contract
4. AsyncAPI Contract
5. Generated SDK
6. Adapter SDK
7. Conformance Tests
8. Example Adapter
9. Adapter Config Schema
10. Mock Scenario Console
11. Mapping-Dokumente
12. Deployment-Dokumentation
```

## 56.1 Neue Anbindung erstellen

Der Kollege muss nur:

1. Adapter-Template kopieren.
2. Manifest anpassen.
3. Config Schema definieren.
4. Healthcheck implementieren.
5. Capabilities melden.
6. Fremddaten auf Canonical Models mappen.
7. Events mappen.
8. Conformance Tests ausführen.
9. Adapter in Registry konfigurieren.
10. Mock Adapter für dieses Modul deaktivieren.

Keine Frontendänderung.

---

# 57. Definition of Done

Das Projekt ist erst fertig, wenn:

- [ ] Dashboard vollständig in Mock Mode läuft
- [ ] alle 17 Kernbereiche vorhanden sind
- [ ] Global Command Bar funktioniert
- [ ] Orb alle Zustände unterstützt
- [ ] Orb audio-reaktiv getestet ist
- [ ] Orb Reduced Motion unterstützt
- [ ] 2D-Fallback funktioniert
- [ ] Capability Discovery funktioniert
- [ ] Module partielle Fähigkeiten korrekt darstellen
- [ ] jeder Adapter austauschbar ist
- [ ] kein Provider im Frontend hardcodiert ist
- [ ] OpenAPI und AsyncAPI Source of Truth sind
- [ ] SDK automatisch generiert wird
- [ ] Mock-Daten Contracts erfüllen
- [ ] Scenario Console vorhanden ist
- [ ] Storybook alle Hauptzustände enthält
- [ ] E2E-Tests erfolgreich sind
- [ ] Visual Regression bestanden ist
- [ ] Accessibility-Test bestanden ist
- [ ] Adapter-Ausfälle abgefangen werden
- [ ] WebSocket-Reconnect funktioniert
- [ ] Event-Gap erkannt wird
- [ ] Audit vorhanden ist
- [ ] Secrets nicht im Frontend erscheinen
- [ ] Theme und Orb ohne Rebuild konfigurierbar sind
- [ ] Layout exportiert/importiert werden kann
- [ ] Dokumentation vollständig ist
- [ ] Beispieladapter Conformance besteht
- [ ] produktive Adapter ohne UI-Umbau ergänzt werden können

---

# 58. Explizite Verbote für den Implementierungsagenten

Nicht:

- direkt aus React auf Hermes zugreifen
- Provider-URLs in Components schreiben
- manuelle Duplicate DTOs anlegen
- Orb mit simplen GIF-/Video-Loops bauen
- Film-Assets extrahieren oder kopieren
- Error durch schnelles Dauerflackern darstellen
- Prozentwerte erfinden
- fehlende Daten als Null ohne Erklärung anzeigen
- Actions anzeigen, die der Adapter nicht kann
- Secrets im Browser speichern
- Adapterfehler verschlucken
- Mock-Daten verwenden, die nicht dem Contract entsprechen
- eine Seite ohne Empty/Error/Offline State abliefern
- die gesamte App bei einem Adapterausfall blockieren
- XState Alpha verwenden, solange die stabile v5 genügt
- Orb-Geometrien bei jedem Status neu mounten
- React-State pro Frame aktualisieren
- 3D erzwingen, wenn Reduced Motion oder WebGL-Fallback aktiv ist

---

# 59. Technische Referenzen

## OpenAPI

```text
https://spec.openapis.org/oas/latest.html
https://openapi-generator.tech/docs/usage/
```

## AsyncAPI

```text
https://www.asyncapi.com/docs/reference/specification/v3.1.0
https://asyncapi.com/tools
```

## JSON Schema

```text
https://json-schema.org/draft/2020-12
```

## CloudEvents

```text
https://cloudevents.io/
https://github.com/cloudevents/spec
```

## React Three Fiber / Three.js

```text
https://r3f.docs.pmnd.rs/
https://r3f.docs.pmnd.rs/advanced/scaling-performance
https://r3f.docs.pmnd.rs/advanced/pitfalls
https://threejs.org/docs/pages/WebGLRenderer.html
```

## Motion / Accessibility

```text
https://motion.dev/docs/react
https://motion.dev/docs/react-accessibility
https://www.w3.org/WAI/WCAG22/Techniques/css/C39
```

## XState

```text
https://stately.ai/docs/quick-start
https://stately.ai/docs/machines
https://stately.ai/docs/xstate-react
```

## Mocking / UI Tests

```text
https://mswjs.io/docs/
https://storybook.js.org/docs/writing-tests
https://storybook.js.org/docs/writing-tests/visual-testing
https://playwright.dev/
```

## Backend

```text
https://docs.nestjs.com/fundamentals/custom-providers
https://docs.nestjs.com/websockets/gateways
```

---

# 60. Finaler Zielzustand

Das Dashboard kann komplett entwickelt, visuell geprüft und funktional getestet werden, obwohl die echten Systeme noch nicht bekannt sind.

```text
Mock Mode
   ↓
vollständiges Dashboard
   ↓
alle Menüs
   ↓
alle Orb-Zustände
   ↓
alle Events
   ↓
alle Fehlerfälle
   ↓
alle Approval-Flows
   ↓
vollständige QA
```

Später:

```text
Mock Adapter entfernen
   ↓
Produktivadapter einsetzen
   ↓
Conformance Test
   ↓
Config aktivieren
   ↓
keine Frontendänderung
```

Der zentrale Orb zeigt zu jedem Zeitpunkt semantisch korrekt:

```text
IDLE
LISTENING
TRANSCRIBING
THINKING
SYNCING
WORKING
SPEAKING
WAITING APPROVAL
SUCCESS
WARNING
ERROR
OFFLINE
PAUSED
```

Damit entsteht kein loses „AI-Dashboard“, sondern ein belastbares **Jarvis Command Center**, das als langfristige, austauschbare Control Plane für Hermes, Kimi, lokale Modelle, Voice, Kommunikation, Automationen und spätere Fachagenten dient.
