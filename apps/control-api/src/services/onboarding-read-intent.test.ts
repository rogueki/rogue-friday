import { describe, expect, it } from "vitest";
import { parseReadQueryIntent } from "./read-query-intent";

describe("onboarding read intent", () => {
  it.each(["wie weit ist die einrichtung", "zeige den onboarding status", "was fehlt noch bei der ersteinrichtung"])(
    "%s -> onboarding.status", (text) => {
      expect(parseReadQueryIntent(text)).toEqual({ kind: "onboarding.status" });
    });

  it.each([
    ["zeige die einrichtung der recherche", "Ersteinrichtung"],
    ["zeige die einrichtung und setze sie zurueck", "Änderungsaktion"],
    ["zeige einrichtung und aufgaben", "Ersteinrichtung"],
  ])("%s -> clarify", (text, part) => {
    const intent = parseReadQueryIntent(text);
    expect(intent?.kind).toBe("clarify");
    expect(intent && "message" in intent ? intent.message : "").toContain(part);
  });
});
