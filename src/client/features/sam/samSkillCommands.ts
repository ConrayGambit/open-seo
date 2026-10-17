/**
 * Skills the user can start from SAM with a slash command. Each `name` is a
 * skill SAM serves (see samSkills.ts); SAM's system prompt maps a message
 * starting with `/<name>` to activating that skill.
 */
export const SAM_SKILL_COMMANDS = [
  {
    name: "seo-audit",
    label: "SEO audit",
    description: "Find the website's biggest SEO issues",
    featured: true,
  },
  {
    name: "seo-project-setup",
    label: "Project setup",
    description: "Get interviewed about the business and set up its context",
    featured: true,
  },
  {
    name: "keyword-research",
    label: "Keyword research",
    description: "Find keywords worth targeting",
    featured: true,
  },
  {
    name: "local-seo",
    label: "Local SEO",
    description: "Review the Google Business Profile and local competitors",
    featured: true,
  },
  {
    name: "competitor-analysis",
    label: "Competitor analysis",
    description: "Study one competitor's rankings, content and backlinks",
    featured: false,
  },
  {
    name: "competitive-landscape",
    label: "Competitive landscape",
    description: "Map the market leaders and the gaps between them",
    featured: false,
  },
  {
    name: "keyword-clustering",
    label: "Keyword clustering",
    description: "Group keywords by intent and map them to pages",
    featured: false,
  },
  {
    name: "link-prospecting",
    label: "Link prospecting",
    description: "Find sites likely to link to you and draft outreach",
    featured: false,
  },
  {
    name: "ai-visibility-audit",
    label: "AI visibility audit",
    description: "See how the brand shows up in AI answers",
    featured: false,
  },
  {
    name: "ai-prompt-research",
    label: "AI prompt research",
    description: "Find what people ask AI about this market",
    featured: false,
  },
  {
    name: "seo-coach",
    label: "SEO coach",
    description: "Get guided through what to do next",
    featured: false,
  },
] as const;
