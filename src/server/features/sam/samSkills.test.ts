import { describe, expect, it } from "vitest";
import { SAM_SKILL_COMMANDS } from "@/client/features/sam/samSkillCommands";
import { buildSamSkillSource } from "@/server/features/sam/samSkills";

describe("buildSamSkillSource", () => {
  // Guards the real failure modes: a skill whose frontmatter breaks (build
  // throws), an internal repo-dev skill leaking into SAM, or the public set
  // silently shrinking because a glob or marking change dropped it.
  it("serves exactly the public product skills", async () => {
    const source = buildSamSkillSource();
    const names = (await source.list()).map((skill) => skill.name);

    expect(names).toEqual([
      "ai-prompt-research",
      "ai-visibility-audit",
      "competitive-landscape",
      "competitor-analysis",
      "keyword-clustering",
      "keyword-research",
      "link-prospecting",
      "local-seo",
      "seo-audit",
      "seo-coach",
      "seo-project-setup",
      "seo-report",
    ]);

    const loaded = await source.load("seo-project-setup");
    expect(loaded?.body).toContain("Surface note: you are SAM");
  });

  it("has a skill behind every slash command", async () => {
    const names = (await buildSamSkillSource().list()).map((s) => s.name);

    for (const command of SAM_SKILL_COMMANDS) {
      expect(names).toContain(command.name);
    }
  });
});
