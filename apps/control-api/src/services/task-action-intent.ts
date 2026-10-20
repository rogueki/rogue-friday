import type { TaskStatus } from "@friday/sdk";

export type TaskActionIntent =
  | { kind: "task.update"; status: TaskStatus; ref: string | null }
  | { kind: "task.cancel"; ref: string | null };

const TASK_ID = /^task_[0-9A-Za-z]{26}$/;

const STATUS_BY_PHRASE: Readonly<Record<string, TaskStatus>> = {
  erledigt: "done",
  fertig: "done",
  abgeschlossen: "done",
  done: "done",
  "in arbeit": "running",
  "in bearbeitung": "running",
  laufend: "running",
  running: "running",
  offen: "todo",
  "zu tun": "todo",
  todo: "todo",
  bereit: "ready",
  ready: "ready",
  wartend: "waiting",
  warten: "waiting",
  blockiert: "waiting",
  waiting: "waiting",
  review: "review",
  "zur pruefung": "review",
  "in pruefung": "review",
  triage: "triage",
};

const normalize = (value: string): string =>
  value.trim().toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .replace(/\s+/g, " ");

/** A reference is a task id or a real title, never a bare pronoun or article. */
function validRef(value: string | undefined): string | null {
  const ref = (value ?? "").trim().replace(/^[„"']+|[“"']+$/g, "").trim();
  if (!ref || ref.length > 300) return null;
  if (TASK_ID.test(ref)) return ref;
  return /^(?:das|dies|diese|es|it|that|this|sie|ihn)$/iu.test(ref) ? null : ref;
}

function statusOf(value: string | undefined): TaskStatus | null {
  const phrase = normalize(value ?? "");
  return phrase ? (STATUS_BY_PHRASE[phrase] ?? null) : null;
}

const STATUS_WITH_REF = [
  /^(?:bitte\s+)?markiere\s+(?:(?:die|das|den)\s+)?(?:aufgabe|task)\s+(.+?)\s+als\s+(.+)$/iu,
  /^(?:bitte\s+)?(?:setze|setzt|stelle)\s+(?:(?:die|das|den)\s+)?(?:aufgabe|task)\s+(.+?)\s+auf\s+(.+)$/iu,
  /^(?:bitte\s+)?mark\s+(?:the\s+)?task\s+(.+?)\s+as\s+(.+)$/iu,
  /^(?:bitte\s+)?set\s+(?:the\s+)?task\s+(.+?)\s+to\s+(.+)$/iu,
];

const STATUS_SELECTED = [
  /^(?:bitte\s+)?markiere\s+(?:(?:die|das|den)\s+)?(?:aufgabe|task)\s+als\s+(.+)$/iu,
  /^(?:bitte\s+)?(?:setze|stelle)\s+(?:(?:die|das|den)\s+)?(?:aufgabe|task)\s+auf\s+(.+)$/iu,
  /^(?:bitte\s+)?mark\s+(?:the\s+)?task\s+as\s+(.+)$/iu,
];

const CANCEL_WITH_REF = [
  /^(?:bitte\s+)?(?:loesche|lösche|entferne|storniere|cancel)\s+(?:(?:die|das|den)\s+)?(?:aufgabe|task)\s+(.+)$/iu,
  /^(?:bitte\s+)?brich\s+(?:(?:die|das|den)\s+)?(?:aufgabe|task)\s+(.+?)\s+ab$/iu,
];

const CANCEL_SELECTED = [
  /^(?:bitte\s+)?(?:loesche|lösche|entferne|storniere|cancel)\s+(?:(?:die|das|den)\s+)?(?:aufgabe|task)$/iu,
  /^(?:bitte\s+)?brich\s+(?:(?:die|das|den)\s+)?(?:aufgabe|task)\s+ab$/iu,
];

/**
 * Only an explicit status-change or cancel imperative for one task is treated as an action. The reference is a task
 * id or title; phrases without a reference resolve the single selected task of the command context at the handler.
 */
export function parseTaskActionIntent(text: string): TaskActionIntent | null {
  const trimmed = text.trim();
  if (trimmed.includes(":")) return null;
  for (const pattern of STATUS_WITH_REF) {
    const match = pattern.exec(trimmed);
    const ref = validRef(match?.[1]);
    const status = statusOf(match?.[2]);
    if (match && ref && status) return { kind: "task.update", status, ref };
  }
  for (const pattern of STATUS_SELECTED) {
    const match = pattern.exec(trimmed);
    const status = statusOf(match?.[1]);
    if (match && status) return { kind: "task.update", status, ref: null };
  }
  for (const pattern of CANCEL_WITH_REF) {
    const match = pattern.exec(trimmed);
    const ref = validRef(match?.[1]);
    if (match && ref) return { kind: "task.cancel", ref };
  }
  for (const pattern of CANCEL_SELECTED) {
    if (pattern.test(trimmed)) return { kind: "task.cancel", ref: null };
  }
  return null;
}
