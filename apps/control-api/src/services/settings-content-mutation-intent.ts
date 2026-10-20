export type SettingsContentMutationIntent =
  | { kind: "settings.profile.locale"; value: "de" | "en" }
  | { kind: "settings.profile.dateFormat"; value: "dd.MM.yyyy" | "yyyy-MM-dd" | "MM/dd/yyyy" }
  | { kind: "settings.profile.timeFormat"; value: "24h" | "12h" }
  | { kind: "settings.profile.firstDayOfWeek"; value: "monday" | "sunday" }
  | { kind: "settings.profile.timeZone"; value: string }
  | { kind: "settings.profile.displayName"; value: string }
  | { kind: "settings.profile.assistantName"; value: string }
  | { kind: "settings.dashboard.compact"; value: boolean }
  | { kind: "settings.dashboard.refresh"; value: number }
  | { kind: "settings.dashboard.backgroundGrid"; value: boolean }
  | { kind: "settings.dashboard.soundEffects"; value: boolean }
  | { kind: "settings.dashboard.contentStudioEnabled"; value: boolean }
  | { kind: "contentStudio.idea.add"; title: string }
  | { kind: "contentStudio.idea.status"; title: string; status: "idee" | "in-arbeit" | "fertig" }
  | { kind: "contentStudio.idea.statusSelected"; status: "idee" | "in-arbeit" | "fertig" }
  | { kind: "contentStudio.idea.rename"; title: string; newTitle: string }
  | { kind: "contentStudio.idea.description"; title: string; description: string }
  | { kind: "contentStudio.idea.date"; title: string; date: string }
  | { kind: "contentStudio.idea.format"; title: string; format: string }
  | { kind: "contentStudio.idea.targets"; title: string; targets: string[] }
  | { kind: "contentStudio.idea.remove"; title: string }
  | { kind: "contentStudio.posting.fromIdea"; title: string; date: string }
  | { kind: "contentStudio.posting.create"; title: string; date: string; time: string; platform: string; format: string }
  | { kind: "contentStudio.posting.status"; title: string; date: string; time: string; status: "geplant" | "gepostet" | "verpasst" }
  | { kind: "contentStudio.posting.remove"; title: string; date: string; time: string }
  | { kind: "contentStudio.plan.exportGuided" }
  | { kind: "contentStudio.plan.importGuided" };

const SETTING_COMPACT = /^(?:please\s+)?(?:set|change|stelle|aendere|ändere)\s+(?:my\s+)?(?:dashboard\s+)?(?:compact|kompakt)(?:\s+mode)?\s+(?:(?:to|auf)\s+)?(on|off|enabled|disabled|ein|aus)(?:[.!?])?$/i;
const SETTING_PROFILE_LOCALE = /^(?:please\s+)?(?:set|change|stelle|setze|aendere|ändere)\s+(?:my\s+)?(?:profile\s+)?(?:language|sprache|locale)\s+(?:(?:to|auf)\s+)?(german|deutsch|de|english|englisch|en)[.!?]?$/i;
const SETTING_PROFILE_DATE = /^(?:please\s+)?(?:set|change|stelle|setze|aendere|ändere)\s+(?:my\s+)?(?:date\s+format|datumsformat)\s+(?:(?:to|auf)\s+)?(dd\.MM\.yyyy|yyyy-MM-dd|MM\/dd\/yyyy)[.!?]?$/i;
const SETTING_PROFILE_TIME = /^(?:please\s+)?(?:set|change|stelle|setze|aendere|ändere)\s+(?:my\s+)?(?:time\s+format|zeitformat)\s+(?:(?:to|auf)\s+)?(24h|12h|24-stunden|12-stunden)[.!?]?$/i;
const SETTING_PROFILE_WEEK = /^(?:please\s+)?(?:set|change|stelle|setze|aendere|ändere)\s+(?:my\s+)?(?:first\s+day\s+of\s+the\s+week|wochenbeginn|ersten\s+wochentag)\s+(?:(?:to|auf)\s+)?(monday|montag|sunday|sonntag)[.!?]?$/i;
const SETTING_PROFILE_TIME_ZONE = /^(?:please\s+)?(?:set|change|stelle|setze|aendere|ändere)\s+(?:my\s+)?(?:time\s*zone|timezone|zeitzone)\s+(?:(?:to|auf)\s+)?([A-Za-z_+-]{1,32}(?:\/[A-Za-z0-9_+-]{1,32}){0,3})[.!?]?$/i;
const SETTING_PROFILE_NAME = /^(?:please\s+)?(?:set|change|stelle|setze|aendere|ändere)\s+(?:my\s+)?(display\s+name|anzeigename|assistant\s+name|assistentenname)\s+(?:(?:to|auf)\s+)?"([^"\r\n]{1,80})"[.!?]?$/i;
const SETTING_REFRESH = /^(?:please\s+)?(?:set|change|stelle|setze|aendere|ändere)\s+(?:the\s+)?(?:dashboard\s+)?(?:refresh|aktualisierung)(?:\s+interval)?\s+(?:(?:to|auf)\s+)?([0-9]{1,4})\s*(?:seconds?|sekunden|s)?[.!?]?$/i;
const SETTING_DASHBOARD_BOOLEAN = /^(?:please\s+)?(?:set|change|stelle|setze|aendere|ändere)\s+(?:the\s+)?(?:dashboard\s+)?(background\s+grid|grid|sound\s+effects|content\s+studio)(?:\s+module)?\s+(?:(?:to|auf)\s+)?(on|off|enabled|disabled|ein|aus|aktiviert|deaktiviert)[.!?]?$/i;
const SETTING_CONTENT_STUDIO_TOGGLE = /^(?:please\s+)?(enable|activate|disable|deactivate|aktiviere|deaktiviere)\s+(?:the\s+)?content\s+studio(?:\s+module)?[.!?]?$/i;
const ADD_IDEA = /^(?:please\s+)?(?:add|create|erstelle|lege\s+an|fuege\s+hinzu|füge\s+hinzu)\s+(?:an\s+)?(?:content\s+)?(?:idea|idee)\s+(.+?)\s+(?:to|in|zum|im)\s+(?:the\s+)?(?:content\s+studio\s+)?(?:plan|redaktionsplan)[.!?]?$/i;
const IDEA_STATUS = /^(?:set|change|setze|aendere|ändere)\s+(?:the\s+)?(?:status\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)|(?:idea|idee))\s+(.+?)\s+(?:to|auf)\s+(idea|idee|in\s+progress|in\s+arbeit|done|fertig)[.!?]?$/i;
const IDEA_STATUS_SELECTED = /^(?:mark|set|change|markiere|setze|aendere|ändere)\s+(?:(?:this|that|selected|the\s+selected|it|diese|dieses|ausgewaehlte|ausgewählte|die\s+ausgewaehlte|die\s+ausgewählte|es|sie)(?:\s+(?:idea|idee))?|(?:idea|idee))\s+(?:(?:status)\s+)?(?:(?:as|to|auf)\s+)?(idea|idee|in\s+progress|in\s+arbeit|done|fertig)[.!?]?$/i;
const RENAME_IDEA = /^(?:rename|benenne)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:to|in)\s+"([^"\r\n]{1,200})"(?:\s+um)?[.!?]?$/i;
const IDEA_DESCRIPTION = /^(?:set|change|update|setze|aendere|ändere)\s+(?:the\s+)?(?:description|beschreibung)\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:to|auf)\s+"([\s\S]{0,10000})"[.!?]?$/i;
const IDEA_DATE = /^(?:set|change|setze|aendere|ändere)\s+(?:target\s+date|zieldatum)\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:to|auf)\s+(?:"([0-9]{4}-[0-9]{2}-[0-9]{2}|clear|leer)"|([0-9]{4}-[0-9]{2}-[0-9]{2}|clear|leer))[.!?]?$/i;
const IDEA_FORMAT = /^(?:set|change|setze|aendere|ändere)\s+(?:format)\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:to|auf)\s+"([^"]+)"[.!?]?$/i;
const IDEA_TARGETS = /^(?:set|change|setze|aendere|ändere)\s+(?:platforms?|zielplattformen)\s+(?:of|von)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:to|auf)\s+"([^"]+)"[.!?]?$/i;
const SCHEDULE_IDEA = /^(?:schedule|plan|plane(?:\s+ein)?|trage\s+ein)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"\s+(?:for|fuer|für|am)\s+([0-9]{4}-[0-9]{2}-[0-9]{2})[.!?]?$/i;
const CREATE_POSTING = /^(?:schedule|create|plan|plane(?:\s+ein)?|trage\s+ein)\s+(?:a\s+|ein\s+)?posting\s+"([^"\r\n]{1,200})"\s+(?:for|fuer|für|am)\s+([0-9]{4}-[0-9]{2}-[0-9]{2})\s+(?:at|um)\s+([0-2][0-9]:[0-5][0-9])\s+(?:on|auf)\s+(LinkedIn|Instagram|Facebook|TikTok|YouTube)\s+(?:as|im\s+format)\s+"([^"]+)"[.!?]?$/i;
const POSTING_STATUS = /^(?:set|change|setze|aendere|ändere)\s+status\s+(?:of|von)\s+(?:the\s+)?posting\s+"([^"\r\n]{1,200})"\s+(?:on|am)\s+([0-9]{4}-[0-9]{2}-[0-9]{2})\s+(?:at|um)\s+([0-2][0-9]:[0-5][0-9])\s+(?:to|auf)\s+(planned|geplant|posted|gepostet|missed|verpasst)[.!?]?$/i;
const REMOVE_IDEA = /^(?:remove|delete|entferne|loesche|lösche)\s+(?:the\s+)?(?:idea|idee)\s+"([^"\r\n]{1,200})"[.!?]?$/i;
const REMOVE_POSTING = /^(?:remove|delete|entferne|loesche|lösche)\s+(?:the\s+)?posting\s+"([^"\r\n]{1,200})"\s+(?:on|am)\s+([0-9]{4}-[0-9]{2}-[0-9]{2})\s+(?:at|um)\s+([0-2][0-9]:[0-5][0-9])[.!?]?$/i;
const PLAN_GUIDED = /^(?:please\s+)?(?:export|download|exportiere|exportier|import|importiere|importier)\s+(?:(?:the|den)\s+)?(?:content\s+studio\s+|content\s+)?(?:plan|redaktionsplan)(?:[.!?])?$/i;

/** Small typed write grammar; free text is data only inside the exact terminal idea-title slot. */
export function parseSettingsContentMutationIntent(input: string): SettingsContentMutationIntent | null {
  const rawText = input.trim();
  const text = rawText.replace(/\s+/g, " ");
  const guidedPlan = PLAN_GUIDED.exec(text);
  if (guidedPlan) return /^(export|download|exportiere|exportier)$/i.test(guidedPlan[0]!.split(/\s+/)[0]!)
    ? { kind: "contentStudio.plan.exportGuided" } : { kind: "contentStudio.plan.importGuided" };
  const locale = SETTING_PROFILE_LOCALE.exec(text);
  if (locale) return { kind: "settings.profile.locale", value: /^(german|deutsch|de)$/i.test(locale[1]!) ? "de" : "en" };
  const dateFormat = SETTING_PROFILE_DATE.exec(text);
  if (dateFormat) return { kind: "settings.profile.dateFormat", value: dateFormat[1]! as "dd.MM.yyyy" | "yyyy-MM-dd" | "MM/dd/yyyy" };
  const timeFormat = SETTING_PROFILE_TIME.exec(text);
  if (timeFormat) return { kind: "settings.profile.timeFormat", value: /^(24h|24-stunden)$/i.test(timeFormat[1]!) ? "24h" : "12h" };
  const weekStart = SETTING_PROFILE_WEEK.exec(text);
  if (weekStart) return { kind: "settings.profile.firstDayOfWeek", value: /^(monday|montag)$/i.test(weekStart[1]!) ? "monday" : "sunday" };
  const timeZone = SETTING_PROFILE_TIME_ZONE.exec(text);
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timeZone[1]! });
      return { kind: "settings.profile.timeZone", value: timeZone[1]! };
    } catch { return null; }
  }
  const profileName = SETTING_PROFILE_NAME.exec(rawText);
  if (profileName) {
    const value = profileName[2]!.trim();
    if (!value || value.length > (profileName[1]!.toLocaleLowerCase("en-US").includes("assistant") || profileName[1]!.toLocaleLowerCase("de-DE").includes("assistent") ? 40 : 80)) return null;
    return { kind: /^(assistant\s+name|assistentenname)$/i.test(profileName[1]!) ? "settings.profile.assistantName" : "settings.profile.displayName", value };
  }
  const compact = SETTING_COMPACT.exec(text);
  if (compact) return { kind: "settings.dashboard.compact", value: /^(on|enabled|ein)$/i.test(compact[1]!) };
  const refresh = SETTING_REFRESH.exec(text);
  if (refresh) {
    const value = Number(refresh[1]);
    if (Number.isInteger(value) && value >= 5 && value <= 3600) return { kind: "settings.dashboard.refresh", value };
    return null;
  }
  const dashboardBoolean = SETTING_DASHBOARD_BOOLEAN.exec(text);
  if (dashboardBoolean) {
    const key = dashboardBoolean[1]!.toLocaleLowerCase("en-US").replace(/\s+/g, " ");
    const value = /^(on|enabled|ein|aktiviert)$/i.test(dashboardBoolean[2]!);
    return { kind: key === "grid" || key === "background grid" ? "settings.dashboard.backgroundGrid"
      : key === "sound effects" ? "settings.dashboard.soundEffects" : "settings.dashboard.contentStudioEnabled", value };
  }
  const studioToggle = SETTING_CONTENT_STUDIO_TOGGLE.exec(text);
  if (studioToggle)
    return { kind: "settings.dashboard.contentStudioEnabled", value: /^(enable|activate|aktiviere)$/i.test(studioToggle[1]!) };
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
  const selectedStatus = IDEA_STATUS_SELECTED.exec(text);
  if (selectedStatus) {
    const normalized = selectedStatus[1]!.toLocaleLowerCase("en-US").replace(/\s+/g, " ");
    return { kind: "contentStudio.idea.statusSelected", status:
      normalized === "idea" || normalized === "idee" ? "idee" : normalized === "done" || normalized === "fertig" ? "fertig" : "in-arbeit" };
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
  const removeIdea = REMOVE_IDEA.exec(rawText);
  if (removeIdea && removeIdea[1]!.trim()) return { kind: "contentStudio.idea.remove", title: removeIdea[1]!.trim() };
  const removePosting = REMOVE_POSTING.exec(rawText);
  if (removePosting && removePosting[1]!.trim()) {
    const date = new Date(`${removePosting[2]}T00:00:00.000Z`);
    const time = removePosting[3]!;
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === removePosting[2] && /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      return { kind: "contentStudio.posting.remove", title: removePosting[1]!.trim(), date: removePosting[2]!, time };
    return null;
  }
  return null;
}
