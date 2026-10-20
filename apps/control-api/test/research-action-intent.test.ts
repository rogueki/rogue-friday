import { describe, expect, it } from "vitest";
import { parseResearchActionIntent } from "../src/services/research-action-intent";

describe("research action intent", () => {
  it.each([
    ["Recherchiere zum Thema: Energiepreise Europa", "Energiepreise Europa"],
    ["Recherchiere Energiepreise Europa und speichere die Quellen", "Energiepreise Europa"],
    ["Suche Quellen zu Energiepreise Europa", "Energiepreise Europa"],
    ["Research about energy prices Europe", "energy prices Europe"],
  ])("parses %s", (text, topic) => {
    expect(parseResearchActionIntent(text)).toEqual({ topic });
  });

  it.each([
    "Was ist über Energiepreise Europa bekannt?",
    "Zeig mir die Quellen zum letzten Projekt",
    "Recherchiere das und speichere die Quellen",
    "Recherchiere es",
    "Recherchiere",
  ])("does not infer a write from %s", (text) => {
    expect(parseResearchActionIntent(text)).toBeNull();
  });
});
