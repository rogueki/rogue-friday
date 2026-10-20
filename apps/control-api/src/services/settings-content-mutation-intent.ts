export type SettingsContentMutationIntent =
  | { kind: "settings.dashboard.compact"; value: boolean }
  | { kind: "contentStudio.idea.add"; title: string }
  | { kind: "contentStudio.idea.status"; title: string; status: "idee" | "in-arbeit" | "fertig" }
  | { kind: "contentStudio.idea.rename"; title: string; newTitle: string }
  | { kind: "contentStudio.idea.description"; title: string; description: string }
  | { kind: "contentStudio.posting.fromIdea"; title: string; date: string };

const SETTING_COMPACT = /^(?:please\s+)?(?:set|change|stelle|aendere|ändere)\s+(?:my\s+)?(?:dashboard\s+)?(?:compact|kompakt)(?:\s+mode)?\s+(?:(?:to|auf)\s+)?(on|off|enabled|disabled|ein|aus)(?:[.!?])?$/i;
const ADD_IDEA = /^(?:please\s+)?(?:add|create|erstelle|lege\s+an|fuege\s+hinzu|füge\s+hinzu)\s+(?:an\s+)?(?:content\s+)?(?:idea|idee)\s+(.+?)\s+(?:to|in|zum|im)\s+(?:the\s+)?(?:content\s+studio\s+)?(?:plan|redaktionsplan)[.!?]?$/i;
const IDEA_STATUS = /^(?:set|change|setze|aendere|ändere)\s+(?:the\s+)?(?:status\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)|(?:idea|idee))\s+(.+?)\s+(?:to|auf)\s+(idea|idee|in\s+progress|in\s+arbeit|done|fertig)[.!?]?$/i;
const RENAME_IDEA = /^(?:rename|benenne)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:to|in)\s+"([^"\r\n]{1,200})"(?:\s+um)?[.!?]?$/i;
const IDEA_DESCRIPTION = /^(?:set|change|update|setze|aendere|ändere)\s+(?:the\s+)?(?:description|beschreibung)\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:to|auf)\s+"([\s\S]{0,10000})"[.!?]?$/i;
const SCHEDULE_IDEA = /^(?:schedule|plan|plane(?:\s+ein)?|trage\s+ein)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:for|fuer|für|am)\s+([0-9]{4}-[0-9]{2}-[0-9]{2})[.!?]?$/i;

/** Small typed write grammar; free text is data only inside the exact terminal idea-title slot. */
export function parseSettingsContentMutationIntent(input: string): SettingsContentMutationIntent | null {
  const rawText = input.trim();
  const text = rawText.replace(/\s+/g, " ");
  const compact = SETTING_COMPACT.exec(text);
  if (compact) return { kind: "settings.dashboard.compact", value: /^(on|enabled|ein)$/i.test(compact[1]!) };
  const idea = ADD_IDEA.exec(text);
  if (idea) {
    const title = idea[1]!.trim();
    if (!title || title.length > 200) return null;
    return { kind: "contentStudio.idea.add", title };
  }
  const status = IDEA_STATUS.exec(text);
  if (status) {
    const title = status[1]!.trim();
    if (!title || title.length > 200) return null;
    const normalized = status[2]!.toLocaleLowerCase("en-US").replace(/\s+/g, " ");
    return { kind: "contentStudio.idea.status", title, status:
      normalized === "idea" || normalized === "idee" ? "idee" :
        normalized === "done" || normalized === "fertig" ? "fertig" : "in-arbeit" };
  }
  const rename = RENAME_IDEA.exec(rawText);
  if (rename && rename[1]!.trim() && rename[2]!.trim())
    return { kind: "contentStudio.idea.rename", title: rename[1]!.trim(), newTitle: rename[2]!.trim() };
  const description = IDEA_DESCRIPTION.exec(rawText);
  if (description && description[1]!.trim())
    return { kind: "contentStudio.idea.description", title: description[1]!.trim(), description: description[2]! };
  const schedule = SCHEDULE_IDEA.exec(rawText);
  if (schedule && schedule[1]!.trim()) {
    const date = new Date(`${schedule[2]}T00:00:00.000Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === schedule[2])
      return { kind: "contentStudio.posting.fromIdea", title: schedule[1]!.trim(), date: schedule[2]! };
  }
  return null;
}
