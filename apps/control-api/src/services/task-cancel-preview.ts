import type { Task } from "@friday/sdk";

/** Confirmation text for cancelling a task; subtasks are named because the Hermes adapter cancels open ones too. */
export function taskCancelPreviewText(task: Pick<Task, "title" | "parentTaskId" | "sourceRefs">): string {
  const subtasks = task.sourceRefs.filter((ref) => ref.type === "task" && ref.id !== task.parentTaskId).length;
  const base = `Aufgabe „${task.title}“ abbrechen?`;
  if (subtasks === 0) return base;
  return `${base} Offene Unteraufgaben werden mit abgebrochen; abgeschlossene bleiben bestehen.`;
}
