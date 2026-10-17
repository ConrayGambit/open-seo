import { createFileRoute } from "@tanstack/react-router";
import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import { WordpressConnectionService } from "@/server/features/wordpress/WordpressConnectionService";

function redirect(location: string) {
  return new Response(null, { status: 303, headers: { Location: location } });
}

/**
 * WordPress's Authorize Application screen returns here with the new
 * application password: by GET from the browser, or by POST from the
 * desktop app, which receives it as an openseo:// link and keeps the
 * password out of URLs it loads.
 */
async function handleCallback(request: Request, params: URLSearchParams) {
  const context = await resolveUserContextFromHeaders(request.headers);
  const { projectId, error } = await WordpressConnectionService.completeConnect(
    {
      userId: context.userId,
      state: params.get("state") ?? "",
      rejected:
        params.get("rejected") === "1" || params.get("success") === "false",
      siteUrl: params.get("site_url"),
      userLogin: params.get("user_login"),
      password: params.get("password"),
    },
  );
  if (!projectId) return redirect("/auth-error?error=wordpress_link_expired");
  const back = new URL(
    `/p/${encodeURIComponent(projectId)}/settings/integrations`,
    request.url,
  );
  if (error) back.searchParams.set("wordpress_error", error);
  else back.searchParams.set("wordpress", "connected");
  back.hash = "wordpress";
  return redirect(`${back.pathname}${back.search}${back.hash}`);
}

export const Route = createFileRoute("/api/wordpress/callback")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        handleCallback(request, new URL(request.url).searchParams),
      POST: async ({ request }: { request: Request }) =>
        handleCallback(request, new URLSearchParams(await request.text())),
    },
  },
});
