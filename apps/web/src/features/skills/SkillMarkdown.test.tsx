import { screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { setApiClient } from "@/lib/api/client";
import { renderWithProviders } from "@/test/render";
import { errorResponse, routedFetch, single } from "../memory/kit/testSupport";
import { SkillMarkdown } from "./SkillMarkdown";

afterEach(() => setApiClient(null));

const PATH = "GET /api/v1/skills/demo/markdown";

it("shows the installed SKILL.md as escaped text, not rendered HTML", async () => {
  renderWithProviders(<SkillMarkdown id="demo" />, {
    fetchImpl: routedFetch({ [PATH]: () => single({ id: "demo", content: "# Demo\n\n<script>alert(1)</script>\n", bytes: 34 }) }).fetch,
  });
  const text = await screen.findByLabelText("SKILL.md demo");
  expect(text.tagName).toBe("PRE");
  expect(text).toHaveTextContent("<script>alert(1)</script>");
  expect(document.querySelector("script")).toBeNull();
});

it("names a missing SKILL.md instead of showing an empty pane", async () => {
  renderWithProviders(<SkillMarkdown id="demo" />, {
    fetchImpl: routedFetch({ [PATH]: () => errorResponse("NOT_FOUND", "Skill-Datei demo wurde nicht gefunden.", 404) }).fetch,
  });
  expect(await screen.findByRole("alert")).toHaveTextContent("nicht gefunden");
});