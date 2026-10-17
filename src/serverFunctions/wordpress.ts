import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { hasOrgPermission } from "@/lib/org-permissions";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { SiteFixService } from "@/server/features/wordpress/SiteFixService";
import { WordpressConnectionService } from "@/server/features/wordpress/WordpressConnectionService";
import { WordpressError } from "@/server/features/wordpress/wordpressClient";
import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import { getPublicOrigin } from "@/server/mcp/public-origin";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { SITE_FIX_FIELDS } from "@/shared/site-fixes";

const projectScopedSchema = z.object({ projectId: z.string().min(1) });

// WordPress problems the user can act on come back as data: thrown errors
// reach the client as a bare code, which would lose the explanation.
async function result<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof WordpressError) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

export const getWordpressConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => ({
    ...(await WordpressConnectionService.getConnection(context.projectId)),
    canManage: hasOrgPermission(context.role, { integration: ["manage"] }),
  }));

export const checkWordpressConnection = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) =>
    WordpressConnectionService.checkConnection(context.projectId),
  );

export const startWordpressConnect = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema.extend({ siteUrl: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    // The desktop app can't receive WordPress's redirect over plain http, so
    // it registers an openseo:// link and forwards the result to the server.
    const callbackBaseUrl = (await getOptionalEnvValue("OPENSEO_DESKTOP"))
      ? "openseo://wordpress/callback"
      : `${getPublicOrigin(getRequest())}/api/wordpress/callback`;
    return result(() =>
      WordpressConnectionService.startConnect({
        projectId: context.projectId,
        organizationId: context.organizationId,
        userId: context.userId,
        siteUrl: data.siteUrl,
        callbackBaseUrl,
      }),
    );
  });

export const disconnectWordpress = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return WordpressConnectionService.disconnect(context.projectId);
  });

export const getSiteFixState = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema.extend({ pageUrl: z.string().url() }))
  .handler(async ({ data, context }) =>
    result(() =>
      SiteFixService.getPageFixState({
        projectId: context.projectId,
        pageUrl: data.pageUrl,
      }),
    ),
  );

export const applySiteFix = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectScopedSchema.extend({
      pageUrl: z.string().url(),
      field: z.enum(SITE_FIX_FIELDS),
      value: z.string().max(1000),
      imageUrl: z.string().url().nullish(),
    }),
  )
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return result(() =>
      SiteFixService.applyFix({
        ...data,
        projectId: context.projectId,
        userId: context.userId,
        source: "app",
      }),
    );
  });

export const rollbackSiteFix = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema.extend({ changeId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    requireOrgPermission(context, { integration: ["manage"] });
    return result(() =>
      SiteFixService.rollbackFix({
        projectId: context.projectId,
        changeId: data.changeId,
      }),
    );
  });

export const listSiteFixChanges = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectScopedSchema)
  .handler(async ({ context }) =>
    SiteFixService.listChanges(context.projectId),
  );
