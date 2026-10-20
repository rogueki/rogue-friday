export type SettingsContentMutationIntent =
  | { kind: "settings.dashboard.compact"; value: boolean }
  | { kind: "contentStudio.idea.add"; title: string }
  | { kind: "contentStudio.idea.status"; title: string; status: "idee" | "in-arbeit" | "fertig" }
  | { kind: "contentStudio.idea.rename"; title: string; newTitle: string }
  | { kind: "contentStudio.idea.description"; title: string; description: string }
  | { kind: "contentStudio.idea.date"; title: string; date: string }
  | { kind: "contentStudio.idea.format"; title: string; format: string }
  | { kind: "contentStudio.idea.targets"; title: string; targets: string[] }
  | { kind: "contentStudio.posting.fromIdea"; title: string; date: string }
  | { kind: "contentStudio.posting.create"; title: string; date: string; time: string; platform: string; format: string }
  | { kind: "contentStudio.posting.status"; title: string; date: string; time: string; status: "geplant" | "gepostet" | "verpasst" };

const SETTING_COMPACT = /^(?:please\s+)?(?:set|change|stelle|aendere|ändere)\s+(?:my\s+)?(?:dashboard\s+)?(?:compact|kompakt)(?:\s+mode)?\s+(?:(?:to|auf)\s+)?(on|off|enabled|disabled|ein|aus)(?:[.!?])?$/i;
const ADD_IDEA = /^(?:please\s+)?(?:add|create|erstelle|lege\s+an|fuege\s+hinzu|füge\s+hinzu)\s+(?:an\s+)?(?:content\s+)?(?:idea|idee)\s+(.+?)\s+(?:to|in|zum|im)\s+(?:the\s+)?(?:content\s+studio\s+)?(?:plan|redaktionsplan)[.!?]?$/i;
const IDEA_STATUS = /^(?:set|change|setze|aendere|ändere)\s+(?:the\s+)?(?:status\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)|(?:idea|idee))\s+(.+?)\s+(?:to|auf)\s+(idea|idee|in\s+progress|in\s+arbeit|done|fertig)[.!?]?$/i;
const RENAME_IDEA = /^(?:rename|benenne)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:to|in)\s+"([^"\r\n]{1,200})"(?:\s+um)?[.!?]?$/i;
const IDEA_DESCRIPTION = /^(?:set|change|update|setze|aendere|ändere)\s+(?:the\s+)?(?:description|beschreibung)\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:to|auf)\s+"([\s\S]{0,10000})"[.!?]?$/i;
const IDEA_DATE = /^(?:set|change|setze|aendere|ändere)\s+(?:target\s+date|zieldatum)\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:to|auf)\s+(?:"([0-9]{4}-[0-9]{2}-[0-9]{2}|clear|leer)"|([0-9]{4}-[0-9]{2}-[0-9]{2}|clear|leer))[.!?]?$/i;
const IDEA_FORMAT = /^(?:set|change|setze|aendere|ändere)\s+(?:format)\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:to|auf)\s+"([^"]+)"[.!?]?$/i;
const IDEA_TARGETS = /^(?:set|change|setze|aendere|ändere)\s+(?:platforms?|zielplattformen)\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:to|auf)\s+"([^"]+)"[.!?]?$/i;
const SCHEDULE_IDEA = /^(?:schedule|plan|plane(?:\s+ein)?|trage\s+ein)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:for|fuer|für|am)\s+([0-9]{4}-[0-9]{2}-[0-9]{2})[.!?]?$/i;
const CREATE_POSTING = /^(?:schedule|create|plan|plane(?:\s+ein)?|trage\s+ein)\s+(?:a\s+|ein\s+)?posting\s+"([^"\r\n]{1,200})"\s+(?:for|fuer|für|am)\s+([0-9]{4}-[0-9]{2}-[0-9]{2})\s+(?:at|um)\s+([0-2][0-9]:[0-5][0-9])\s+(?:on|auf)\s+(LinkedIn|Instagram|Facebook|TikTok|YouTube)\s+(?:as|im\s+format)\s+"([^"]+)"[.!?]?$/i;
const POSTING_STATUS = /^(?:set|change|setze|aendere|ändere)\s+status\s+(?:of|von)\s+(?:the\s+)?posting\s+"([^"\r\n]{1,200})"\s+(?:on|am)\s+([0-9]{4}-[0-9]{2}-[0-9]{2})\s+(?:at|um)\s+([0-2][0-9]:[0-5][0-9])\s+(?:to|auf)\s+(planned|geplant|posted|gepostet|missed|verpasst)[.!?]?$/i;

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
  const ideaDate = IDEA_DATE.exec(rawText);
  if (ideaDate && ideaDate[1]!.trim()) {
    const value = ideaDate[2] ?? ideaDate[3]!;
    const date = /^(clear|leer)$/i.test(value) ? "" : value;
    if (!date) return { kind: "contentStudio.idea.date", title: ideaDate[1]!.trim(), date };
    const parsed = new Date(`${date}T00:00:00.000Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date)
      return { kind: "contentStudio.idea.date", title: ideaDate[1]!.trim(), date };
    return null;
  }
  const ideaFormat = IDEA_FORMAT.exec(rawText);
  if (ideaFormat && ideaFormat[1]!.trim()) {
    const format = ideaFormat[2]!.trim();
    if (["Reel", "Feed-Post", "Story", "Karussell", "LinkedIn-Video", "LinkedIn-Karussell", "TikTok-Video", "YouTube-Video", "YouTube-Short"].includes(format))
      return { kind: "contentStudio.idea.format", title: ideaFormat[1]!.trim(), format };
    return null;
  }
  const ideaTargets = IDEA_TARGETS.exec(rawText);
  if (ideaTargets && ideaTargets[1]!.trim()) {
    const targets = ideaTargets[2]!.split(/\s*(?:,|\+|\band\b|\bund\b)\s*/i).map((entry) => entry.trim());
    if (targets.length > 0 && targets.length <= 5 && new Set(targets).size === targets.length
      && targets.every((entry) => ["LinkedIn", "Instagram", "Facebook", "TikTok", "YouTube"].includes(entry)))
      return { kind: "contentStudio.idea.targets", title: ideaTargets[1]!.trim(), targets };
    return null;
  }
  const schedule = SCHEDULE_IDEA.exec(rawText);
  if (schedule && schedule[1]!.trim()) {
    const date = new Date(`${schedule[2]}T00:00:00.000Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === schedule[2])
      return { kind: "contentStudio.posting.fromIdea", title: schedule[1]!.trim(), date: schedule[2]! };
  }
  const posting = CREATE_POSTING.exec(rawText);
  if (posting && posting[1]!.trim()) {
    const date = new Date(`${posting[2]}T00:00:00.000Z`);
    const time = posting[3]!;
    const platform = ["LinkedIn", "Instagram", "Facebook", "TikTok", "YouTube"].find((value) => value.toLocaleLowerCase("en-US") === posting[4]!.toLocaleLowerCase("en-US"));
    const formats = ["Reel", "Feed-Post", "Story", "Karussell", "LinkedIn-Video", "LinkedIn-Karussell", "TikTok-Video", "YouTube-Video", "YouTube-Short"];
    const format = formats.find((value) => value.toLocaleLowerCase("en-US") === posting[5]!.trim().toLocaleLowerCase("en-US"));
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === posting[2] && /^([01]\d|2[0-3]):[0-5]\d$/.test(time) && platform && format)
      return { kind: "contentStudio.posting.create", title: posting[1]!.trim(), date: posting[2]!, time,
        platform, format };
    return null;
  }
  const postingStatus = POSTING_STATUS.exec(rawText);
  if (postingStatus && postingStatus[1]!.trim()) {
    const date = new Date(`${postingStatus[2]}T00:00:00.000Z`);
    const time = postingStatus[3]!;
    const status = /^(planned|geplant)$/i.test(postingStatus[4]!) ? "geplant" : /^(posted|gepostet)$/i.test(postingStatus[4]!) ? "gepostet" : "verpasst";
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === postingStatus[2] && /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      return { kind: "contentStudio.posting.status", title: postingStatus[1]!.trim(), date: postingStatus[2]!, time, status };
    return null;
  }
  return null;
}
