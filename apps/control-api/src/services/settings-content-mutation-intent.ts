export type SettingsContentMutationIntent =
  | { kind: "settings.dashboard.compact"; value: boolean }
  | { kind: "contentStudio.idea.add"; title: string }
  | { kind: "contentStudio.idea.status"; title: string; status: "idee" | "in-arbeit" | "fertig" };

const SETTING_COMPACT = /^(?:please\s+)?(?:set|change|stelle|aendere|ändere)\s+(?:my\s+)?(?:dashboard\s+)?(?:compact|kompakt)(?:\s+mode)?\s+(?:(?:to|auf)\s+)?(on|off|enabled|disabled|ein|aus)(?:[.!?])?$/i;
const ADD_IDEA = /^(?:please\s+)?(?:add|create|erstelle|lege\s+an|fuege\s+hinzu|füge\s+hinzu)\s+(?:an\s+)?(?:content\s+)?(?:idea|idee)\s+(.+?)\s+(?:to|in|zum|im)\s+(?:the\s+)?(?:content\s+studio\s+)?(?:plan|redaktionsplan)[.!?]?$/i;
const IDEA_STATUS = /^(?:set|change|setze|aendere|ändere)\s+(?:the\s+)?(?:status\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)|(?:idea|idee))\s+(.+?)\s+(?:to|auf)\s+(idea|idee|in\s+progress|in\s+arbeit|done|fertig)[.!?]?$/i;

/** Small typed write grammar; free text is data only inside the exact terminal idea-title slot. */
export function parseSettingsContentMutationIntent(input: string): SettingsContentMutationIntent | null {
  const text = input.trim().replace(/\s+/g, " ");
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
  return null;
}

