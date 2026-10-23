import { describe, expect, it } from "vitest";
import { ideaTargets, parseStudioPlan, postingTargets } from "./plan";

const valid = {
  version: 1,
  content: [{ id: "idea-1", titel: "Launch", plattform: "LinkedIn", format: "Feed-Post", beschreibung: "", zieldatum: "2026-11-01", status: "idee" }],
  postings: [{ id: "post-1", titel: "Launch", datum: "2026-11-01", uhrzeit: "09:00", plattform: "LinkedIn", format: "Feed-Post", status: "geplant" }],
};

describe("Content Studio plan import", () => {
  it("accepts the existing version-1 export shape", () => {
    expect(parseStudioPlan(valid).content[0]?.titel).toBe("Launch");
  });
  it("keeps legacy plans and preserves a single post with multiple targets", () => {
    const legacy = parseStudioPlan({ ...valid, content: [{ ...valid.content[0], plattform: "Beide" }] });
    expect(ideaTargets(legacy.content[0]!)).toEqual(["LinkedIn", "Instagram"]);
    const multi = parseStudioPlan({ ...valid, content: [{ ...valid.content[0], plattform: "Instagram", ziele: ["Instagram", "Facebook"] }], postings: [{ ...valid.postings[0], plattform: "Instagram", ziele: ["Instagram", "Facebook", "TikTok", "YouTube"] }] });
    expect(ideaTargets(multi.content[0]!)).toEqual(["Instagram", "Facebook"]);
    expect(postingTargets(multi.postings[0]!)).toEqual(["Instagram", "Facebook", "TikTok", "YouTube"]);
  });
  it("rejects malformed and duplicate records before replacing the current plan", () => {
    expect(() => parseStudioPlan({ ...valid, content: [valid.content[0], valid.content[0]] })).toThrow(/eindeutig/);
    expect(() => parseStudioPlan({ ...valid, postings: [{ ...valid.postings[0], status: "Bereit" }] })).toThrow(/ungültig/);
    expect(() => parseStudioPlan({ ...valid, content: [{ ...valid.content[0], titel: "" }] })).toThrow(/ungültig/);
    expect(() => parseStudioPlan({ ...valid, postings: [{ ...valid.postings[0], datum: "2026-02-30" }] })).toThrow(/ungültig/);
    expect(() => parseStudioPlan({ ...valid, postings: [{ ...valid.postings[0], ziele: ["Instagram", "Instagram"] }] })).toThrow(/ungültig/);
  });

  // There is no publisher adapter: an unbacked "gepostet" would be exactly the claim DASH-14.04 forbids.
  it("accepts a manual publication only with its origin and rejects confirmed claims without a publisher", () => {
    const marked = { ...valid.postings[0], status: "gepostet",
      veroeffentlichung: { art: "manuell", am: "2026-11-02T08:00:00.000Z", quelle: "manuell" } };
    expect(parseStudioPlan({ ...valid, postings: [marked] }).postings[0]?.veroeffentlichung?.art).toBe("manuell");
    expect(() => parseStudioPlan({ ...valid, postings: [{ ...valid.postings[0], status: "gepostet" }] })).toThrow(/gepostet/);
    expect(() => parseStudioPlan({ ...valid, postings: [{ ...marked, veroeffentlichung: { art: "bestaetigt", am: marked.veroeffentlichung.am, quelle: "manuell" } }] }))
      .toThrow(/ungültig/);
    expect(() => parseStudioPlan({ ...valid, postings: [{ ...marked, veroeffentlichung: { art: "manuell", am: "gestern", quelle: "manuell" } }] }))
      .toThrow(/ungültig/);
    expect(() => parseStudioPlan({ ...valid, postings: [{ ...valid.postings[0], veroeffentlichung: marked.veroeffentlichung }] }))
      .toThrow(/ungültig/);
  });
});
