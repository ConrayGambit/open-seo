import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { SiteFixService } from "@/server/features/wordpress/SiteFixService";
import type { SiteFixChange } from "@/server/features/wordpress/WordpressRepository";
import { AppError } from "@/server/lib/errors";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { projectIdSchema } from "@/server/mcp/schemas";
import { SITE_FIX_FIELDS } from "@/shared/site-fixes";

const INTEGRATIONS_PATH = (projectId: string) =>
  `/p/${projectId}/settings/integrations`;

const changeOutputSchema = z
  .object({
    id: z.string(),
    pageUrl: z.string(),
    field: z.enum(SITE_FIX_FIELDS),
    imageUrl: z.string().nullable(),
    oldValue: z.string(),
    newValue: z.string(),
    source: z.enum(["app", "mcp"]),
    appliedAt: z.string(),
    rolledBackAt: z.string().nullable(),
  })
  .passthrough();

function toChangeOutput(change: SiteFixChange) {
  return {
    id: change.id,
    pageUrl: change.pageUrl,
    field: change.field,
    imageUrl: change.imageUrl,
    oldValue: change.oldValue,
    newValue: change.newValue,
    source: change.source,
    appliedAt: change.appliedAt,
    rolledBackAt: change.rolledBackAt,
  };
}

function requireManage(role: string) {
  if (!hasOrgPermission(role, { integration: ["manage"] })) {
    throw new AppError(
      "FORBIDDEN",
      "Only organization owners and admins can change the connected WordPress site.",
    );
  }
}

const pageInputSchema = {
  projectId: projectIdSchema,
  pageUrl: z
    .string()
    .url()
    .describe("Full URL of a page on the project's connected WordPress site."),
} as const;

export const getSiteFixStateTool = {
  name: "get_site_fix_state",
  config: {
    title: "Read a WordPress page's fixable fields",
    description:
      "Reads one page of the project's connected WordPress site live: its Yoast SEO or Rank Math title and meta description, what the page currently renders, its publish status, and the images it shows without an alt attribute. Use it before apply_site_fix so you can show the user the current value next to your proposal. Uses no credits. Requires the site to be connected under project settings > Integrations, with the OpenSEO Connector plugin active.",
    inputSchema: pageInputSchema,
    outputSchema: z
      .object({
        siteUrl: z.string(),
        post: z
          .object({
            id: z.number(),
            type: z.string(),
            status: z.string(),
            title: z.string(),
          })
          .passthrough(),
        seoPlugin: z.enum(["yoast", "rank-math"]).nullable(),
        seo: z
          .object({ title: z.string(), description: z.string() })
          .passthrough()
          .nullable(),
        live: z
          .object({ title: z.string(), metaDescription: z.string() })
          .passthrough(),
        imagesMissingAlt: z.array(
          z
            .object({ url: z.string(), inMediaLibrary: z.boolean() })
            .passthrough(),
        ),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof pageInputSchema>>, context) => {
      const state = await SiteFixService.getPageFixState(args);
      const seo = state.seo
        ? `Saved SEO title: ${state.seo.title || "(empty, plugin template)"}\nSaved meta description: ${state.seo.description || "(empty, plugin template)"}`
        : "No Yoast SEO or Rank Math on this site, so SEO titles and descriptions can't be changed.";
      return mcpResponse({
        text: [
          `${state.post.title} (${state.post.type} ${state.post.id}, ${state.post.status})`,
          `Rendered title: ${state.live.title || "(none)"}`,
          `Rendered meta description: ${state.live.metaDescription || "(none)"}`,
          seo,
          `Images without alt: ${state.imagesMissingAlt.length}`,
        ].join("\n"),
        meta: buildProjectMeta(context, args.projectId),
        structuredContent: state,
      });
    },
  ),
};

const applyInputSchema = {
  ...pageInputSchema,
  field: z
    .enum(SITE_FIX_FIELDS)
    .describe(
      "seo_title or seo_description (Yoast SEO / Rank Math fields), image_alt (Media Library alt text of imageUrl), or status (only 'draft', which takes the page offline).",
    ),
  value: z
    .string()
    .max(1000)
    .describe("The new value. For status, the only accepted value is 'draft'."),
  imageUrl: z
    .string()
    .url()
    .optional()
    .describe(
      "For image_alt: the image URL as returned by get_site_fix_state.",
    ),
} as const;

export const applySiteFixTool = {
  name: "apply_site_fix",
  config: {
    title: "Apply a fix to the WordPress site",
    description:
      "Writes one field on the project's connected WordPress site and logs it with the previous value so it can be undone with rollback_site_fix. This changes the live site: show the user the current value (from get_site_fix_state) and your proposed value, and get their explicit approval before calling. Uses no credits. Returns change: null when the site already had this value.",
    inputSchema: applyInputSchema,
    outputSchema: z
      .object({
        projectId: z.string(),
        change: changeOutputSchema.nullable(),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof applyInputSchema>>, context) => {
      requireManage(context.auth.role);
      const change = await SiteFixService.applyFix({
        projectId: args.projectId,
        userId: context.auth.userId,
        source: "mcp",
        pageUrl: args.pageUrl,
        field: args.field,
        value: args.value,
        imageUrl: args.imageUrl,
      });
      return mcpResponse({
        text: change
          ? `Changed ${args.field} on ${args.pageUrl} from "${change.oldValue}" to "${change.newValue}". Change id: ${change.id} (pass it to rollback_site_fix to undo).`
          : `The site already had this ${args.field}; nothing changed.`,
        meta: buildProjectMeta(
          context,
          args.projectId,
          INTEGRATIONS_PATH(args.projectId),
        ),
        structuredContent: {
          projectId: args.projectId,
          change: change ? toChangeOutput(change) : null,
        },
      });
    },
  ),
};

const rollbackInputSchema = {
  projectId: projectIdSchema,
  changeId: z
    .string()
    .min(1)
    .describe("Change id from apply_site_fix or list_site_fix_changes."),
} as const;

export const rollbackSiteFixTool = {
  name: "rollback_site_fix",
  config: {
    title: "Undo a WordPress fix",
    description:
      "Restores the value a field had before apply_site_fix changed it. Stops without writing if the field was edited on the site after OpenSEO's change, and reports the current value. Uses no credits.",
    inputSchema: rollbackInputSchema,
    outputSchema: z
      .object({
        projectId: z.string(),
        change: changeOutputSchema,
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof rollbackInputSchema>>, context) => {
      requireManage(context.auth.role);
      const change = await SiteFixService.rollbackFix(args);
      return mcpResponse({
        text: `Restored ${change.field} on ${change.pageUrl} to "${change.oldValue}".`,
        meta: buildProjectMeta(
          context,
          args.projectId,
          INTEGRATIONS_PATH(args.projectId),
        ),
        structuredContent: {
          projectId: args.projectId,
          change: toChangeOutput(change),
        },
      });
    },
  ),
};

const listInputSchema = { projectId: projectIdSchema } as const;

export const listSiteFixChangesTool = {
  name: "list_site_fix_changes",
  config: {
    title: "List WordPress fixes",
    description:
      "Lists the 50 most recent changes OpenSEO made on the project's connected WordPress site, newest first, with old and new values and whether each was undone. Uses no credits.",
    inputSchema: listInputSchema,
    outputSchema: z
      .object({
        projectId: z.string(),
        changes: z.array(changeOutputSchema),
        ...optionalMetaOutputSchema,
      })
      .passthrough(),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  handler: withMcpProjectAuth(
    async (args: z.infer<z.ZodObject<typeof listInputSchema>>, context) => {
      const changes = (await SiteFixService.listChanges(args.projectId)).map(
        toChangeOutput,
      );
      return mcpResponse({
        text:
          changes.length === 0
            ? "No changes have been made on this site from OpenSEO."
            : changes
                .map(
                  (change) =>
                    `${change.id} · ${change.appliedAt} · ${change.field} · ${change.pageUrl} · "${change.oldValue}" → "${change.newValue}"${change.rolledBackAt ? " (undone)" : ""}`,
                )
                .join("\n"),
        meta: buildProjectMeta(
          context,
          args.projectId,
          INTEGRATIONS_PATH(args.projectId),
        ),
        structuredContent: { projectId: args.projectId, changes },
      });
    },
  ),
};
