import { describe, expect, it } from "vitest";
import { de, en, resolveAssistantName, translate } from "./index";

describe("assistant name interpolation", () => {
  it("defaults to F.R.I.D.A.Y. in both locales", () => {
    expect(translate("de", "bottom.talk")).toBe("MIT F.R.I.D.A.Y. SPRECHEN");
    expect(translate("en", "bottom.talk")).toBe("TALK TO F.R.I.D.A.Y.");
    expect(translate("de", "orb.status.working")).toBe("F.R.I.D.A.Y. arbeitet …");
    expect(translate("de", "app.title")).toBe("F.R.I.D.A.Y. Command Center");
  });

  it("uses the configured name without a rebuild", () => {
    expect(translate("de", "orb.status.speaking", undefined, "Nova")).toBe("Nova spricht …");
    expect(translate("en", "palette.ask.query", { query: "x" }, "Nova")).toBe("Ask Nova: “x”");
  });

  it("falls back for empty settings values", () => {
    expect(resolveAssistantName(undefined)).toBe("F.R.I.D.A.Y.");
    expect(resolveAssistantName("  ")).toBe("F.R.I.D.A.Y.");
    expect(resolveAssistantName(" Nova ")).toBe("Nova");
  });

  it("keeps no hardcoded legacy brand in the dictionaries", () => {
    for (const dictionary of [de, en])
      for (const value of Object.values(dictionary)) expect(value).not.toMatch(/friday/i);
  });
});
