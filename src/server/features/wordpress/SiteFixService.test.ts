import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as WordpressClient from "./wordpressClient";
import { SiteFixService } from "./SiteFixService";

const mocks = vi.hoisted(() => ({
  wordpressRequest: vi.fn(),
  getChange: vi.fn(),
  markRolledBack: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock(
  "@/server/features/wordpress/wordpressClient",
  async (importActual) => ({
    ...(await importActual<typeof WordpressClient>()),
    wordpressRequest: mocks.wordpressRequest,
  }),
);
vi.mock("@/server/features/wordpress/wordpressCredentials", () => ({
  requireConnection: vi.fn().mockResolvedValue({
    connection: { siteUrl: "https://example.com" },
    credentials: {
      restUrl: "https://example.com/wp-json/",
      username: "editor",
      password: "secret",
    },
  }),
  sameSite: vi.fn(() => true),
}));
vi.mock("@/server/features/wordpress/WordpressRepository", () => ({
  WordpressRepository: {
    getChange: mocks.getChange,
    markRolledBack: mocks.markRolledBack,
  },
}));

const change = {
  id: "change-1",
  projectId: "project-1",
  pageUrl: "https://example.com/about/",
  field: "image_alt" as const,
  objectId: "42",
  restBase: null,
  imageUrl: "https://example.com/photo.jpg",
  oldValue: "",
  newValue: "Team photo",
  source: "app" as const,
  appliedByUserId: "user-1",
  appliedAt: "2026-10-16T18:00:00.000Z",
  rolledBackAt: null,
};

function siteAltText(alt: string) {
  mocks.wordpressRequest.mockImplementation(
    async (_credentials, _route, options?: { method?: string }) =>
      options?.method === "POST" ? { alt_text: "" } : { alt_text: alt },
  );
}

describe("SiteFixService.rollbackFix", () => {
  beforeEach(() => {
    mocks.getChange.mockResolvedValue(change);
    mocks.markRolledBack.mockResolvedValue(true);
  });

  it("restores the old value while the site still holds OpenSEO's value", async () => {
    siteAltText("Team photo");

    await SiteFixService.rollbackFix({
      projectId: "project-1",
      changeId: "change-1",
    });

    expect(mocks.wordpressRequest).toHaveBeenCalledWith(
      expect.anything(),
      "wp/v2/media/42",
      { method: "POST", body: { alt_text: "" } },
    );
    expect(mocks.markRolledBack).toHaveBeenCalledWith("change-1");
  });

  it("stops without writing when the field was edited on the site since", async () => {
    siteAltText("Edited in WordPress");

    await expect(
      SiteFixService.rollbackFix({
        projectId: "project-1",
        changeId: "change-1",
      }),
    ).rejects.toThrow(/changed on the site after OpenSEO's change/);

    expect(mocks.wordpressRequest).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.markRolledBack).not.toHaveBeenCalled();
  });
});
