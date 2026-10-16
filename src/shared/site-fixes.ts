import type { AuditIssueType } from "@/shared/audit-issues";

/** Fields OpenSEO can change on a connected WordPress site. */
export const SITE_FIX_FIELDS = [
  "seo_title",
  "seo_description",
  "image_alt",
  "status",
] as const;

export type SiteFixField = (typeof SITE_FIX_FIELDS)[number];

export const SITE_FIX_FIELD_LABELS: Record<SiteFixField, string> = {
  seo_title: "SEO title",
  seo_description: "Meta description",
  image_alt: "Image alt text",
  status: "Page status",
};

export const SITE_FIX_MAX_LENGTH: Record<
  Exclude<SiteFixField, "status">,
  number
> = {
  seo_title: 300,
  seo_description: 500,
  image_alt: 300,
};

/** Audit issues a connected WordPress site can fix, and the field each one edits. */
const SITE_FIX_FIELD_FOR_ISSUE: Partial<Record<AuditIssueType, SiteFixField>> =
  {
    "missing-title": "seo_title",
    "duplicate-title": "seo_title",
    "title-too-long": "seo_title",
    "title-too-short": "seo_title",
    "missing-meta-description": "seo_description",
    "duplicate-meta-description": "seo_description",
    "meta-description-too-long": "seo_description",
    "meta-description-too-short": "seo_description",
    "images-missing-alt": "image_alt",
    "thin-content": "status",
    "duplicate-content": "status",
  };

const fieldByIssue = new Map(Object.entries(SITE_FIX_FIELD_FOR_ISSUE));

export function siteFixFieldForIssue(issueType: string): SiteFixField | null {
  return fieldByIssue.get(issueType) ?? null;
}
