/**
 * German natural-language messenger intents for the command path. Only explicit send/reply imperatives with an
 * actual message text and a recognizable channel are treated as actions. Recipient and channel resolution
 * (registered outbound targets, inbound observations) happens at the handler — never guessed here.
 */
export type MessengerActionIntent =
  | { kind: "messenger.send"; platform: string; recipient: string | null; text: string }
  | { kind: "messenger.reply"; platform: string | null; text: string };

/** Display names (already squashed) to canonical platform ids; longest names first so "google chat" beats "chat". */
const PLATFORM_NAMES: ReadonlyArray<[string, string]> = [
  ["whatsapp cloud", "whatsapp_cloud"], ["google chat", "google_chat"], ["telegram", "telegram"],
  ["whatsapp", "whatsapp"], ["discord", "discord"], ["signal", "signal"], ["slack", "slack"], ["sms", "sms"],
  ["matrix", "matrix"], ["mattermost", "mattermost"], ["irc", "irc"], ["line", "line"], ["feishu", "feishu"],
  ["wecom", "wecom"], ["ntfy", "ntfy"], ["teams", "teams"], ["simplex", "simplex"], ["weixin", "weixin"],
  ["bluebubbles", "bluebubbles"], ["dingtalk", "dingtalk"], ["photon", "photon"], ["buzz", "buzz"],
  ["yuanbao", "yuanbao"], ["qqbot", "qqbot"],
];

const CHANNEL = PLATFORM_NAMES.map(([name]) => name.replaceAll(" ", "\\s")).join("|");
const CHANNEL_RE = new RegExp(`^(${CHANNEL})$`, "iu");

/** Keyword matching is case- and umlaut-insensitive; extracted texts keep their original spelling. */
const squash = (value: string): string =>
  value.toLowerCase()
    .replaceAll("ä", "ae").replaceAll("ö", "oe").replaceAll("ü", "ue").replaceAll("ß", "ss")
    .replace(/\s+/g, " ").trim();

export function canonicalPlatform(name: string | undefined): string | null {
  if (!name) return null;
  const squashed = squash(name);
  const hit = PLATFORM_NAMES.find(([display]) => display === squashed);
  return hit ? hit[1] : null;
}

function recipientOf(value: string | undefined): string | null {
  const recipient = (value ?? "").trim().replace(/^[„"']+|[“"']+$/g, "")
    .replace(/^(?:den|die|das)\s+(?:kanal|gruppe|chat)\s+/iu, "").trim();
  if (!recipient || recipient.length > 128) return null;
  // "Schreib eine Nachricht über Telegram …" carries no recipient — the keyword is not a person.
  if (/^(?:eine\s+)?(?:nachricht|message)$/iu.test(recipient)) return null;
  if (/^(?:mir|ihm|ihr|ihn|es)$/iu.test(recipient)) return null;
  return recipient;
}

function bodyOf(value: string | undefined): string | null {
  const body = (value ?? "").trim();
  return body && body.length <= 8192 ? body : null;
}

const COMPOSE = [
  // "Schreib(e)/Schick(e)/Sende [eine Nachricht] an <Ziel> über <Kanal> dass/: <Text>"
  new RegExp(`^(?:bitte\\s+)?(?:schreib(?:e)?|verfass(?:e)?|schick(?:e)?|sende)(?:\\s+(?:eine\\s+)?(?:nachricht))?\\s+an\\s+(.+?)\\s+(?:ueber|über)\\s+(${CHANNEL})\\s*(?:dass\\s+(.+)|:\\s*(.+))$`, "isu"),
  // "Schreib(e) <Ziel> über <Kanal> dass/: <Text>" (ohne "an"; "eine Nachricht" als Ziel = kein Empfänger)
  new RegExp(`^(?:bitte\\s+)?(?:schreib(?:e)?|verfass(?:e)?|schick(?:e)?|sende)\\s+(.+?)\\s+(?:ueber|über)\\s+(${CHANNEL})\\s+(?:dass\\s+(.+)|:\\s*(.+))$`, "isu"),
  // "Schick(e) eine <Kanal>-Nachricht [an <Ziel>] dass/: <Text>"
  new RegExp(`^(?:bitte\\s+)?(?:schreib(?:e)?|verfass(?:e)?|schick(?:e)?|sende)\\s+(?:eine\\s+)?(${CHANNEL})[-\\s]nachricht(?:\\s+an\\s+(.+?))?\\s*(?:dass\\s+(.+)|:\\s*(.+))$`, "isu"),
];

const REPLY = [
  // "Antworte auf die/ihre [letzte] [<Kanal>-]Nachricht dass/: <Text>"
  new RegExp(`^(?:bitte\\s+)?antwort(?:e|en)\\s+auf\\s+(?:die|ihre|seine)\\s+(?:letzte\\s+)?(?:(\\p{L}[\\p{L} ]*?)[-\\s])?nachricht\\s*(?:dass\\s+(.+)|:\\s*(.+))$`, "isu"),
  // "Antworte [ihr/ihm/dem Absender] über <Kanal> dass/: <Text>"
  new RegExp(`^(?:bitte\\s+)?antwort(?:e|en)(?:\\s+(?:ihm|ihr|dem\\s+absender))?\\s+(?:ueber|über)\\s+(${CHANNEL})\\s*(?:dass\\s+(.+)|:\\s*(.+))$`, "isu"),
];

/**
 * Parses an explicit messenger send or reply imperative. Returns null for anything without channel context or
 * message text; those phrases fall through to the mail parser, builtin intents or the base handler.
 */
export function parseMessengerActionIntent(text: string): MessengerActionIntent | null {
  const trimmed = text.trim();
  for (const pattern of COMPOSE) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const groups = match.slice(1);
    // Pattern shapes: [recipient, channel, body, body] or [channel, recipient, body, body] — the channel group
    // is the one matching the channel alternation.
    const channelIndex = groups.findIndex((group) => group !== undefined && CHANNEL_RE.test(group));
    if (channelIndex < 0) continue;
    const platform = canonicalPlatform(groups[channelIndex]);
    // Shapes: [recipient, channel, body, body] or [channel, recipient, body, body].
    const recipient = recipientOf(channelIndex === 0 ? groups[1] : groups[0]);
    const body = bodyOf(groups[2] ?? groups[3]);
    if (platform && body) return { kind: "messenger.send", platform, recipient, text: body };
  }
  for (const pattern of REPLY) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    const platform = canonicalPlatform(match[1]);
    const body = bodyOf(match[2] ?? match[3]);
    // A reply without a channel resolves the newest inbound message overall at the handler.
    if (body && (platform !== null || match[1] === undefined)) return { kind: "messenger.reply", platform, text: body };
  }
  return null;
}
