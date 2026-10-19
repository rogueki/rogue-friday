/**
 * German natural-language agent intents for the command path. Only explicit lifecycle/assignment imperatives that
 * name an agent (the word "Agent" in the reference) or a coding run ("Lauf"/"Run") are treated as actions; the
 * reference itself is resolved against the live registry at the handler — never guessed here.
 */
export type AgentActionIntent =
  | { kind: "agent.pause"; ref: string }
  | { kind: "agent.resume"; ref: string }
  | { kind: "agent.stop"; ref: string }
  | { kind: "agent.assign"; agentRef: string; taskRef: string }
  | { kind: "codingrun.stop" };

const squash = (value: string): string =>
  value.toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .replace(/\s+/g, " ").trim();

/** Strips quotes and the Agent suffix: "den Recherche-Agenten" -> "recherche". Empty or pronoun refs carry no target. */
function refOf(value: string | undefined): string | null {
  const ref = (value ?? "").trim().replace(/^[„"']+|[“"']+$/g, "").trim();
  if (!ref || ref.length > 128) return null;
  const base = squash(ref).replace(/[-\s]?agent(?:en)?$/, "").trim();
  if (!base || /^(?:der|die|das|den|dem|er|sie|es)$/.test(base)) return null;
  return ref;
}

/** Lifecycle references must visibly name an agent, otherwise the phrase is not an agent action at all. */
function agentRef(value: string | undefined): string | null {
  const ref = refOf(value);
  return ref && /\bagent/i.test(ref) ? ref : null;
}

const taskRefOf = (value: string | undefined): string | null => refOf(value);

const PAUSE = [
  // "Pausiere den <X>-Agenten"
  /^(?:bitte\s+)?pausier(?:e|t)?\s+(?:den|die|das|dem)\s+(.+)$/iu,
  // "Halte den <X>-Agenten an" / "Leg den <X>-Agenten still"
  /^(?:bitte\s+)?halt(?:e)?\s+(?:den|die|das)\s+(.+?)\s+an$/iu,
  /^(?:bitte\s+)?leg(?:e)?\s+(?:den|die|das)\s+(.+?)\s+still$/iu,
];

const RESUME = [
  // "Lass den <X>-Agenten (weiter)arbeiten / weitermachen"
  /^(?:bitte\s+)?lass\s+(?:den|die|das)\s+(.+?)\s+(?:(?:weiter\s?)?arbeiten|weitermachen)$/iu,
  // "Setz den <X>-Agenten fort"
  /^(?:bitte\s+)?setz(?:e|t)?\s+(?:den|die|das)\s+(.+?)\s+fort$/iu,
  // "Starte/Aktiviere den <X>-Agenten"
  /^(?:bitte\s+)?(?:starte|aktiviere)\s+(?:den|die|das)\s+(.+)$/iu,
];

const STOP = [
  // "Fahr den <X>-Agenten runter"
  /^(?:bitte\s+)?fahr(?:e)?\s+(?:den|die|das)\s+(.+?)\s+(?:runter|herunter)$/iu,
  // "Stoppe/Beende den <X>-Agenten"
  /^(?:bitte\s+)?(?:stoppe?|beende)\s+(?:den|die|das)\s+(.+)$/iu,
];

const RUN_STOP = [
  // "Brich den [laufenden] [Coding-]Lauf/Run ab"
  /^(?:bitte\s+)?brich\s+(?:den|die|das)\s+(?:laufenden\s+)?(?:coding[-\s]?)?(?:lauf|run)\s+ab$/iu,
  // "Stoppe/Beende den [laufenden] Coding-Lauf/Run"
  /^(?:bitte\s+)?(?:stoppe?|beende)\s+(?:den|die|das)\s+(?:laufenden\s+)?coding[-\s](?:lauf|run)$/iu,
];

const ASSIGN = [
  // "Lass den <X>-Agenten an der Aufgabe <Titel> arbeiten"
  /^(?:bitte\s+)?lass\s+(?:den|die|das)\s+(.+?)\s+an\s+(?:der\s+)?aufgabe\s+(.+?)\s+arbeiten$/iu,
  // "Weise die Aufgabe <Titel> dem <X>-Agenten zu"
  /^(?:bitte\s+)?weise?\s+(?:die\s+)?aufgabe\s+(.+?)\s+(?:dem|der)\s+(.+?)\s+zu$/iu,
  // "Gib die Aufgabe <Titel> an den <X>-Agenten"
  /^(?:bitte\s+)?gib\s+(?:die\s+)?aufgabe\s+(.+?)\s+an\s+(?:den|die|das)\s+(.+)$/iu,
];

/**
 * Parses an explicit agent lifecycle, assignment or coding-run-stop imperative. Returns null for anything that does
 * not name an agent or a run; those phrases fall through to the other intent parsers or the base handler.
 */
export function parseAgentActionIntent(text: string): AgentActionIntent | null {
  const trimmed = text.trim();
  for (const pattern of RUN_STOP) if (pattern.test(trimmed)) return { kind: "codingrun.stop" };
  for (const pattern of ASSIGN) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    // Shapes: [agent, task] for the "lass arbeiten" form, [task, agent] for the "weise/gib" forms.
    const first = match[1] ?? "";
    const [agentRefValue, taskRefValue] = /\bagent/i.test(first) ? [match[1], match[2]] : [match[2], match[1]];
    const agent = agentRef(agentRefValue);
    const task = taskRefOf(taskRefValue);
    if (agent && task) return { kind: "agent.assign", agentRef: agent, taskRef: task };
  }
  for (const pattern of PAUSE) {
    const ref = agentRef(pattern.exec(trimmed)?.[1]);
    if (ref) return { kind: "agent.pause", ref };
  }
  for (const pattern of RESUME) {
    const ref = agentRef(pattern.exec(trimmed)?.[1]);
    if (ref) return { kind: "agent.resume", ref };
  }
  for (const pattern of STOP) {
    const ref = agentRef(pattern.exec(trimmed)?.[1]);
    if (ref) return { kind: "agent.stop", ref };
  }
  return null;
}
