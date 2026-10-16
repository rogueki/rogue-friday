import { describe, expect, it } from "vitest";
import { parseStudioPlan } from "./plan";

const valid = {
  version: 1,
  content: [{ id: "idea-1", titel: "Launch", plattform: "LinkedIn", format: "Feed-Post", beschreibung: "", zieldatum: "2026-11-01", status: "idee" }],
  postings: [{ id: "post-1", titel: "Launch", datum: "2026-11-01", uhrzeit: "09:00", plattform: "LinkedIn", format: "Feed-Post", status: "geplant" }],
};

describe("Content Studio plan import", () => {
  it("accepts the existing version-1 export shape", () => {
    expect(parseStudioPlan(valid).content[0]?.titel).toBe("Launch");
  });
  it("rejects malformed and duplicate records before replacing the current plan", () => {
    expect(() => parseStudioPlan({ ...valid, content: [valid.content[0], valid.content[0]] })).toThrow(/eindeutig/);
    expect(() => parseStudioPlan({ ...valid, postings: [{ ...valid.postings[0], status: "Bereit" }] })).toThrow(/ungültig/);
    expect(() => parseStudioPlan({ ...valid, content: [{ ...valid.content[0], titel: "" }] })).toThrow(/ungültig/);
    expect(() => parseStudioPlan({ ...valid, postings: [{ ...valid.postings[0], datum: "2026-02-30" }] })).toThrow(/ungültig/);
  });
});
