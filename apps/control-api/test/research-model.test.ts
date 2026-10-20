import { expect, it, vi } from "vitest";
import { validateResearchModelOutput } from "../src/services/research-model";
import { openDatabase } from "../src/db/database";
import { ResearchService } from "../src/services/research";

const sourceId = "src_01JCW5E9R2Q7T4M8N3B6V00001";
const sources = [
  {
    id: sourceId,
    title: "Fixture",
    url: "https://example.org/source",
    text: "Der Testbericht nennt für die Lieferung vier Werktage. Eine zweite Aussage folgt.",
  },
];

it("accepts only cited passages that occur exactly in the retrieved page", () => {
  const valid = {
    sourceId,
    quote: "Der Testbericht nennt für die Lieferung vier Werktage.",
    statement: "Die Quelle nennt vier Werktage für die Lieferung.",
  };
  const fabricated = {
    sourceId: "src_01JCW5E9R2Q7T4M8N3B6V00002",
    quote: "Eine erfundene Lieferfrist von einem Tag.",
    statement: "Unbelegte Behauptung",
  };
  expect(validateResearchModelOutput(JSON.stringify({ observations: [valid, fabricated] }), sources)).toEqual(
    [valid],
  );
  expect(
    validateResearchModelOutput(
      JSON.stringify({ observations: [{ ...valid, quote: "Lieferung morgen" }] }),
      sources,
    ),
  ).toEqual([]);
  expect(validateResearchModelOutput("not json", sources)).toEqual([]);
});

it("rejects duplicate source citations and oversized model lists", () => {
  const observation = {
    sourceId,
    quote: "Der Testbericht nennt für die Lieferung vier Werktage.",
    statement: "Die Quelle nennt vier Werktage für die Lieferung.",
  };
  expect(
    validateResearchModelOutput(JSON.stringify({ observations: [observation, observation] }), sources),
  ).toEqual([observation]);
  expect(
    validateResearchModelOutput(JSON.stringify({ observations: Array(4).fill(observation) }), sources),
  ).toEqual([]);
});

it("persists a model observation only with an exact captured quote and never re-submits on replay", async () => {
  const db = openDatabase(":memory:");
  const quote = "Energiepreise stiegen laut diesem Testbericht im Frühjahr um fünf Prozent.";
  const synthesize = vi.fn(async (_topic: string, modelSources: typeof sources) => ({
    observations: [
      {
        sourceId: modelSources[0]!.id,
        quote,
        statement: "Der Testbericht meldet einen Anstieg der Energiepreise im Frühjahr.",
      },
      {
        sourceId: modelSources[0]!.id,
        quote: "Erfundene Textstelle mit falscher Zahl.",
        statement: "Eine erfundene Aussage ist zu verwerfen.",
      },
    ],
    model: "fixture-model",
    provider: "fixture-provider",
  }));
  const search = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          results: [{ title: "Bericht", url: "https://example.org/bericht", content: "Snippet" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  const research = new ResearchService(
    db,
    "http://127.0.0.1:8080/",
    search as typeof fetch,
    () => new Date("2026-10-20T00:00:00Z"),
    async () => quote,
    synthesize,
  );
  try {
    const project = await research.create("owner", "Energiepreise", "request-one", 1);
    expect(project).toMatchObject({ status: "review", sourceCount: 1, findingCount: 1 });
    expect(project.resultSummary).toContain("Hermes-Modell fixture-model");
    expect(research.findings("owner", project.id)).toMatchObject([
      {
        statement: `Der Testbericht meldet einen Anstieg der Energiepreise im Frühjahr. — Beleg: „${quote}“`,
        confidence: 0,
        status: "draft",
      },
    ]);
    const replay = await research.create("owner", "Energiepreise", "request-one", 1);
    expect(replay.id).toBe(project.id);
    expect(search).toHaveBeenCalledTimes(1);
    expect(synthesize).toHaveBeenCalledTimes(1);
  } finally {
    db.close();
  }
});

it("keeps extractive evidence and reports unavailable synthesis without retrying", async () => {
  const db = openDatabase(":memory:");
  const page = "Energiepreise stiegen laut diesem Testbericht im Frühjahr um fünf Prozent.";
  const synthesize = vi.fn(async () => null);
  const search = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          results: [{ title: "Bericht", url: "https://example.org/bericht", content: "Snippet" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  const research = new ResearchService(
    db,
    "http://127.0.0.1:8080/",
    search as typeof fetch,
    () => new Date("2026-10-20T00:00:00Z"),
    async () => page,
    synthesize,
  );
  try {
    const project = await research.create("owner", "Energiepreise", "request-two", 1);
    expect(project).toMatchObject({ status: "review", sourceCount: 1, findingCount: 1 });
    expect(project.resultSummary).toContain("Modellsynthese nicht verfügbar");
    expect(research.findings("owner", project.id)[0]?.status).toBe("draft");
    expect((await research.create("owner", "Energiepreise", "request-two", 1)).id).toBe(project.id);
    expect(synthesize).toHaveBeenCalledTimes(1);
  } finally {
    db.close();
  }
});
