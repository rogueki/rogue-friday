/** Only an explicit request to research a named topic starts source discovery. */
export function parseResearchActionIntent(text: string): { topic: string } | null {
  const trimmed = text.trim();
  const match =
    /^(?:recherchiere|recherchier(?:e|t) bitte|suche quellen (?:zu|fuer)|research)\s+(?:(?:zum thema|zu dem thema|zum|ueber|über|das thema|thema|about)\s*:?\s*)?(.+)$/iu.exec(
      trimmed,
    );
  if (!match) return null;
  const topic =
    match[1]
      ?.replace(/\s+und speichere (?:die )?quellen[.!?]*$/iu, "")
      .replace(/[.!?]+$/, "")
      .trim() ?? "";
  if (topic.length < 3 || topic.length > 500) return null;
  if (/^(?:das|dies|dieses|es|it|that|this|dazu|darueber|darüber)$/iu.test(topic)) return null;
  return { topic };
}
