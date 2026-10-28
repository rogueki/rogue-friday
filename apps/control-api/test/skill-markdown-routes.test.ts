import { expect, it, vi } from "vitest";
import { startTestApi } from "./helpers";

const path = "/api/v1/skills/demo/markdown";

it("serves SKILL.md text to the owner only and never renders HTML", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    const read = vi.spyOn(api.runtime.hermesConfig, "skillMarkdown").mockResolvedValue({
      id: "demo", content: "# Demo\n\n<script>alert(1)</script>\n", bytes: 34,
    });
    const owner = api.client();
    const viewer = api.client();
    await owner.loginDev("owner");
    await viewer.loginDev("viewer");
    expect((await api.client().get(path)).statusCode).toBe(401);
    expect((await viewer.get(path)).statusCode).toBe(403);
    const result = await owner.get(path);
    expect(result.statusCode).toBe(200);
    expect(result.json().data.content).toContain("<script>alert(1)</script>");
    expect(read).toHaveBeenCalledWith("demo");
  } finally {
    await api.close();
  }
});

it("serves a Friday SKILL.md from the package checkout instead of the Hermes folders", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    vi.spyOn(api.runtime.skills, "fridayMarkdown").mockReturnValue({
      id: "demo", content: "# Friday\n", bytes: 9,
    });
    const hermes = vi.spyOn(api.runtime.hermesConfig, "skillMarkdown");
    const owner = api.client();
    await owner.loginDev("owner");
    const result = await owner.get(path);
    expect(result.statusCode).toBe(200);
    expect(result.json().data.content).toBe("# Friday\n");
    expect(hermes).not.toHaveBeenCalled();
  } finally {
    await api.close();
  }
});

it("explains a missing SKILL.md as 404 instead of an empty document", async () => {
  const api = await startTestApi({ responseValidation: "throw" });
  try {
    vi.spyOn(api.runtime.hermesConfig, "skillMarkdown").mockRejectedValue(
      Object.assign(new Error("Skill-Datei demo wurde nicht gefunden."), { code: "NOT_FOUND", status: 404 }),
    );
    const owner = api.client();
    await owner.loginDev("owner");
    const result = await owner.get(path);
    expect(result.statusCode).toBe(404);
    expect(result.json().error.code).toBe("NOT_FOUND");
  } finally {
    await api.close();
  }
});