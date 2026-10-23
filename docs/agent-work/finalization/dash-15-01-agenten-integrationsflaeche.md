# DASH-15.01 — Integrationsfläche der Domain-Agenten

**Datum:** 2026-10-23 · **Status:** PASS (Datei- und Testnachweis)

## 1. Dateien, die die Aufgabe nennt

| Erwartet | Vorhanden |
| --- | --- |
| `adapters/hermes/src/agents-adapter.ts` | 13 955 B — Profile, Kanban-Assignees und Worker zu Agenten vereinigt, Status abgeleitet |
| `adapters/hermes/src/agent-mapping.ts` | 6 076 B — Mapping auf das Vertragsmodell inkl. Performance/Heartbeat |
| `adapters/hermes/src/clients.ts` | 10 176 B — HTTP-Clients für Dashboard- und API-Server |
| Agentprofile/-konfiguration | sieben echte Hermes-Profile (`config.yaml` + `SOUL.md`), siehe DASH-15.02 |
| `apps/web/src/features/agents/*` | `AgentsPage.tsx`, `AgentDrawer.tsx`, `AgentInfoCard.tsx`, `AssignTaskDialog.tsx`, `model.ts`, `useAgentCommands.ts`, `agents.css`, `agents.test.tsx` |
| Job-/Taskservices | `adapters/hermes/src/tasks-adapter.ts` (20 232 B), `task-mapping.ts` (8 958 B), `apps/control-api/src/services/backup-jobs.ts` |

## 2. Ausgeführte Prüfungen

```
vitest --project node adapters/hermes/test/agents.test.ts      12 Tests bestanden
vitest --project web  apps/web/src/features/agents             15 Tests bestanden
```

Die Node-Tests belegen das Verhalten, das die Aufgabe voraussetzt: Vereinigung von Profilen und Kanban-Assignees mit
abgeleitetem Status, „alle offline, während das Gateway steht", Betrieb **ohne** API-Key (Capabilities bleiben leer,
Problem wird einmal geloggt), Filter/Paging/Versionen, `getAgent` mit `NOT_FOUND`, `agents.stop` nur mit
run-scoped Patch, genau ein beendeter Lauf, Status- und Heartbeat-Events ohne Cursor-Verlust bei fehlgeschlagener
Abfrage.

## 3. Grenze

Die Datei- und Testebene ist belegt; das *Verhalten gegen einen laufenden Hermes-API-Server* (sieben Profile sichtbar,
eigene Testaufgabe je Profil) bleibt DASH-15.03/15.04 vorbehalten und ist dort als offen dokumentiert.
