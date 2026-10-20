import type { Priority, TaskCreateRequest } from "@friday/sdk";

const PREFIXES = [
  /^(?:bitte\s+)?(?:erstelle|erstell|erzeuge|leg|lege)\s+(?:(?:mir|uns)\s+)?(?:eine?\s+)?(?:neue?\s+)?(?:aufgabe|task)(?:\s+an)?$/iu,
  /^(?:neue?\s+)?(?:aufgabe|task)$/iu,
  /^(?:bitte\s+)?(?:notiere|trag|trage)\s+(?:(?:das|dies)\s+)?(?:als\s+)?(?:eine?\s+)?(?:neue?\s+)?(?:aufgabe|task)(?:\s+ein)?$/iu,
  /^(?:bitte\s+)?(?:fuege|füge|pack|setze)\s+(?:(?:das|dies)\s+)?(?:zur|auf\s+die)\s+aufgabenliste(?:\s+hinzu)?$/iu,
  /^(?:create|add)\s+(?:a\s+)?(?:new\s+)?task$/iu,
];

const INLINE = [
  /^(?:bitte\s+)?(?:erstelle|erstell|erzeuge|leg|lege)\s+(?:(?:mir|uns)\s+)?(?:eine?\s+)?(?:neue?\s+)?(?:aufgabe|task)(?:\s+an)?\s+(?:fuer|für|namens|mit\s+(?:dem\s+)?titel)\s+(.+)$/iu,
  /^(?:bitte\s+)?(?:notiere|trag|trage)\s+(.+?)\s+als\s+(?:neue?\s+)?aufgabe(?:\s+ein)?$/iu,
  /^(?:bitte\s+)?(?:fuege|füge|pack|setze)\s+(.+?)\s+(?:zur|auf\s+die)\s+aufgabenliste(?:\s+hinzu)?$/iu,
  /^(?:create|add)\s+(?:a\s+)?(?:new\s+)?task\s+(?:for|called|named)\s+(.+)$/iu,
];

function validTitle(value: string): string | null {
  const title = value.trim();
  return title && title.length <= 300 && !/^(?:das|dies|es|it|that|this)$/iu.test(title) ? title : null;
}

/** Only an explicit task-creation imperative with a separated title is treated as an action. */
export function parseTaskCreateIntent(text: string): TaskCreateRequest | null {
  const separator = text.indexOf(":");
  if (separator < 0) {
    for (const pattern of INLINE) {
      const title = validTitle(pattern.exec(text.trim())?.[1] ?? "");
      if (title) return { title, priority: "P2" };
    }
    return null;
  }
  const rawPrefix = text.slice(0, separator).trim();
  const priorityMatch = /\s*\((P[0-4])\)$/iu.exec(rawPrefix);
  const prefix = priorityMatch ? rawPrefix.slice(0, priorityMatch.index).trim() : rawPrefix;
  if (!PREFIXES.some((pattern) => pattern.test(prefix))) return null;
  const title = validTitle(text.slice(separator + 1));
  if (!title) return null;
  return { title, priority: (priorityMatch?.[1]?.toUpperCase() as Priority | undefined) ?? "P2" };
}
