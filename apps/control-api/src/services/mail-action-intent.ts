/**
 * German natural-language mail intents for the command path. Only explicit compose/reply imperatives with an actual
 * message text are treated as actions — a bare "Sende eine E-Mail an …" without text stays with the base command
 * handler. Recipient names are never guessed: resolution against the mailbox happens at the handler.
 */
export type MailActionIntent =
  | { kind: "mail.compose"; recipient: string; subject: string | null; body: string }
  | { kind: "mail.reply"; sender: string | null; body: string };

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

/** Keyword matching is case- and umlaut-insensitive; extracted texts keep their original spelling. */
const squash = (value: string): string =>
  value.toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .replace(/\s+/g, " ");

/** A recipient is an address or a real name, never a bare pronoun (those belong to the reply patterns). */
function validRecipient(value: string | undefined): string | null {
  const recipient = (value ?? "").trim().replace(/^[„"']+|[“"']+$/g, "").trim();
  if (!recipient || recipient.length > 254) return null;
  if (ADDRESS.test(recipient)) return recipient;
  return /^(?:mir|mir selbst|ihm|ihr|ihn|es|dem absender|absender)$/iu.test(recipient) ? null : recipient;
}

function bodyOf(value: string | undefined): string | null {
  const body = (value ?? "").trim();
  return body && body.length <= 100_000 ? body : null;
}

const COMPOSE_WITH_SUBJECT = [
  // "Schreib(e)/Sende/Schick(e) [eine Mail/E-Mail] [an] <Empfänger> mit dem Betreff <Betreff>: <Text>"
  /^(?:bitte\s+)?(?:schreib(?:e)?|verfass(?:e)?|sende|schick(?:e)?)(?:\s+(?:eine\s+)?(?:mail|e-mail|nachricht))?(?:\s+an)?\s+(.+?)\s+mit\s+(?:dem\s+)?betreff\s+[„"']?(.+?)[“"']?\s*:\s+(.+)$/isu,
];

const COMPOSE = [
  // "Schreib(e) [eine Mail/E-Mail] [an] <Empfänger> dass <Text>" / "… an <Empfänger>: <Text>"
  /^(?:bitte\s+)?(?:schreib(?:e)?|verfass(?:e)?)(?:\s+(?:eine\s+)?(?:mail|e-mail|nachricht))?(?:\s+an)?\s+(.+?)\s+dass\s+(.+)$/isu,
  /^(?:bitte\s+)?(?:schreib(?:e)?|verfass(?:e)?)\s+(?:eine\s+)?(?:mail|e-mail|nachricht)\s+an\s+(.+?)\s*:\s+(.+)$/isu,
  // "Sende/Schick(e) [eine] [Mail/E-Mail] an <Empfänger> dass <Text>" / "…: <Text>"
  /^(?:bitte\s+)?(?:sende|schick(?:e)?)\s+(?:eine\s+)?(?:mail|e-mail)\s+an\s+(.+?)\s+dass\s+(.+)$/isu,
  /^(?:bitte\s+)?(?:sende|schick(?:e)?)\s+(?:eine\s+)?(?:mail|e-mail)\s+an\s+(.+?)\s*:\s+(.+)$/isu,
];

const REPLY_WITH_SENDER = [
  // "Antworte [auf die [letzte] Mail] von <Absender> dass <Text>" / "… von <Absender>: <Text>"
  /^(?:bitte\s+)?antwort(?:e|en)(?:\s+auf\s+(?:die\s+)?(?:letzte\s+)?(?:mail|e-mail|nachricht))?\s+(?:von\s+)?(.+?)\s+dass\s+(.+)$/isu,
  /^(?:bitte\s+)?antwort(?:e|en)?\s+auf\s+(?:die\s+)?(?:letzte\s+)?(?:mail|e-mail|nachricht)\s+von\s+(.+?)\s*:\s+(.+)$/isu,
];

const REPLY_SELECTED = [
  // "Antworte [ihr/ihm/dem Absender] dass <Text>" / "Antworte [ihr/ihm/dem Absender]: <Text>"
  /^(?:bitte\s+)?antwort(?:e|en)(?:\s+(?:ihm|ihr|dem\s+absender))?(?:\s+dass\s+(.+)|\s*:\s*(.+))$/isu,
];

/**
 * Parses an explicit mail compose or reply imperative. The recipient/sender is an address or a name; resolution
 * (including ambiguity) happens at the handler against the mailbox, never by guessing here.
 */
export function parseMailActionIntent(text: string): MailActionIntent | null {
  const trimmed = text.trim();
  for (const pattern of COMPOSE_WITH_SUBJECT) {
    const match = pattern.exec(trimmed);
    const recipient = validRecipient(match?.[1]);
    const subject = (match?.[2] ?? "").trim();
    const body = bodyOf(match?.[3]);
    if (match && recipient && subject && subject.length <= 200 && body) {
      return { kind: "mail.compose", recipient, subject, body };
    }
  }
  for (const pattern of COMPOSE) {
    const match = pattern.exec(trimmed);
    const recipient = validRecipient(match?.[1]);
    const body = bodyOf(match?.[2] ?? match?.[3]);
    if (match && recipient && body) return { kind: "mail.compose", recipient, subject: null, body };
  }
  for (const pattern of REPLY_WITH_SENDER) {
    const match = pattern.exec(trimmed);
    const sender = validRecipient(match?.[1]);
    const body = bodyOf(match?.[2]);
    if (match && sender && body) return { kind: "mail.reply", sender, body };
  }
  for (const pattern of REPLY_SELECTED) {
    const match = pattern.exec(trimmed);
    const body = bodyOf(match?.[1] ?? match?.[2]);
    if (match && body) return { kind: "mail.reply", sender: null, body };
  }
  return null;
}

/** Deterministic subject when the phrasing carries none: the first line of the body, shortened. */
export function derivedSubject(body: string): string {
  const first = squash(body.split(/\r?\n/)[0] ?? "").trim();
  return (first.length > 60 ? `${first.slice(0, 57)}...` : first) || "Nachricht von Friday";
}

export { squash as squashMailText };
