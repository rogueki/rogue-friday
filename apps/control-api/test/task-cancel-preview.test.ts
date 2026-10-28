import { describe, expect, it } from "vitest";
import type { Task } from "@friday/sdk";
import { taskCancelPreviewText } from "../src/services/task-cancel-preview";

type PreviewTask = Pick<Task, "title" | "parentTaskId" | "sourceRefs">;

describe("taskCancelPreviewText", () => {
  it("nennt nur die Aufgabe, wenn keine Unteraufgabe mitgeht", () => {
    const task: PreviewTask = { title: "Rechnung pruefen", parentTaskId: "task_parent",
      sourceRefs: [{ type: "task", id: "task_parent" }] };
    expect(taskCancelPreviewText(task)).toBe("Aufgabe „Rechnung pruefen“ abbrechen?");
  });

  it("nennt eine mitabgebrochene Unteraufgabe", () => {
    const task: PreviewTask = { title: "Rechnung pruefen", parentTaskId: "task_parent",
      sourceRefs: [{ type: "task", id: "task_parent" }, { type: "task", id: "task_child" }] };
    expect(taskCancelPreviewText(task)).toBe(
      "Aufgabe „Rechnung pruefen“ abbrechen? Offene Unteraufgaben werden mit abgebrochen; abgeschlossene bleiben bestehen.",
    );
  });

  it("nennt mehrere mitabgebrochene Unteraufgaben und ignoriert andere Verweise", () => {
    const task: PreviewTask = { title: "Rechnung pruefen", parentTaskId: "task_parent",
      sourceRefs: [{ type: "task", id: "task_parent" }, { type: "task", id: "task_first" },
        { type: "task", id: "task_second" }, { type: "memory", id: "mem_note" }] };
    expect(taskCancelPreviewText(task)).toBe(
      "Aufgabe „Rechnung pruefen“ abbrechen? Offene Unteraufgaben werden mit abgebrochen; abgeschlossene bleiben bestehen.",
    );
  });
});
