import { describe, expect, it } from "vitest";
import { SkillsService } from "../src/services/skills";

// Observed from Friday-Ubuntu's Hermes v0.22.2 /api/skills, excluding 105 Friday skills.
const installedHermes = `airtable architecture-diagram arxiv ascii-video baoyu-infographic blocked-page-recovery box claude-code claude-design codebase-inspection codex competitor-news-monitor computer-use design-md document-to-action-items docx dogfood email-inbox-triage gif-search github google-workspace grounded-citations hermes-agent hermes-agent-skill-authoring himalaya humanizer inspecting-hermes-desktop-dom llm-wiki manim-video maps meeting-action-items node-inspect-debugger notion obsidian opencode p5js pdf popular-web-designs powerpoint product-price-monitor python-debugpy requesting-code-review simplify-code songsee songwriting-and-ai-music spike systematic-debugging teams-meeting-pipeline test-driven-development weekly-review-planning xlsx xurl youtube-content`.split(" ");

describe("Hermes builtin setup metadata", () => {
  it("explains prerequisites for all 53 observed builtins and labels later unknown skills", async () => {
    expect(installedHermes).toHaveLength(53);
    const fetcher: typeof fetch = async (input) => String(input).endsWith("/api/skills")
      ? Response.json({ skills: [...installedHermes, "future-hermes-skill"].map((name) => ({ name, enabled: true })) })
      : new Response('<script>window.__HERMES_SESSION_TOKEN__="test-token-123456"</script>');
    const entries = (await new SkillsService({ dashboardUrl: "http://127.0.0.1:43791", fetcher }).list()).skills;
    for (const name of installedHermes) {
      const skill = entries.find((entry) => entry.id === `hermes:${name}`);
      expect(skill, name).toBeDefined();
      expect([...(skill?.setupRefs ?? []), ...(skill?.integrationDetails.map((detail) => detail.setupDe) ?? [])].join(" ").length, name).toBeGreaterThan(30);
      expect(skill?.requiredCapabilities.length, name).toBeGreaterThan(0);
    }
    const unknown = entries.find((entry) => entry.id === "hermes:future-hermes-skill");
    expect(unknown).toMatchObject({ accounts: [], integrationDetails: [], setupRefs: [expect.stringContaining("noch nicht katalogisiert")] });
  });
});
