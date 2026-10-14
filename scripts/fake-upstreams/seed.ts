import { HermesState } from "../../adapters/hermes/test/fake/state";

/**
 * Fictional but realistic Hermes content: a Kanban board with every column in use, three profiles with one running
 * worker, and two API-server sessions (one with a tool call). Names are made up (no real persons).
 */
export function seedHermes(state: HermesState): void {
  state.profiles.push(
    { name: "kira", display_name: "Kira", is_default: false, model: "k3", provider: "kimi-coding", description: "Recherche und Berichte", skill_count: 24 },
    { name: "milo", display_name: "Milo", is_default: false, model: "k3", provider: "kimi-coding", description: "Dokumente und Ablage", skill_count: 17 },
  );
  const board = state.board("default");
  const running = state.addTask("default", { title: "Quartalsbericht für Brandt Logistik entwerfen", body: "Zahlen aus dem Controlling zusammenführen.", assignee: "kira", priority: 4 });
  state.addTask("default", { title: "Angebot Nr. 2041 prüfen", assignee: "milo", status: "review", priority: 3 });
  state.addTask("default", { title: "Kalender der nächsten Woche abgleichen", assignee: "default", status: "ready", priority: 2 });
  const done = state.addTask("default", { title: "Rechnungen September ablegen", assignee: "milo", status: "done", priority: 1 });
  done.completed_at = state.tick();
  done.result = "14 Belege abgelegt.";
  state.addTask("default", { title: "Rückfrage zur Lieferzeit klären", assignee: "kira", status: "blocked", block_kind: "needs_input", priority: 3 });
  state.addTask("default", { title: "Newsletter-Entwurf sichten", status: "triage", priority: 1 });
  state.addTask("default", { title: "Backup-Skript dokumentieren", status: "todo", priority: 0 });
  const worker = state.startWorker("default", running);
  state.heartbeat(worker);
  // The seed history is silent: only events after startup reach the event stream.
  board.events.length = 0;

  state.addSession({
    id: "sess-demo-001",
    title: "Fähigkeiten auflisten",
    messages: [
      { role: "user", content: "Zeig mir, was du kannst." },
      { role: "assistant", content: "", tool_calls: [{ id: "call_1", name: "skills_list" }], finish_reason: "tool_calls" },
      { role: "tool", content: '{"success": true}', tool_call_id: "call_1", tool_name: "skills_list" },
      { role: "assistant", content: "Ich kann Aufgaben planen, recherchieren und Dokumente ablegen.", finish_reason: "stop" },
    ],
  });
  state.addSession({
    id: "sess-demo-002",
    title: "Terminübersicht",
    messages: [
      { role: "user", content: "Was steht morgen an?" },
      { role: "assistant", content: "Zwei Termine: Abstimmung um 10 Uhr und Review um 15 Uhr.", finish_reason: "stop" },
    ],
  });
}
