import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { queryClient } from "@/client/tanstack-db/queryClient";
import { googleConnectionOptions } from "@/client/features/integrations/googleProviders";
import { createFileRoute } from "@tanstack/react-router";
import { GoogleConnectionCard } from "@/client/features/integrations/GoogleConnectionCard";
import { CrawlerAccessSettings } from "@/client/features/settings/CrawlerAccessSettings";
import { WordpressConnectionCard } from "@/client/features/wordpress/WordpressConnectionCard";

export const Route = createFileRoute(
  "/_app/p/$projectId/settings/integrations",
)({
  // Set by /api/wordpress/callback after WordPress's approval screen.
  validateSearch: z.object({
    wordpress: z.literal("connected").optional(),
    wordpress_error: z.string().optional(),
  }),
  loader: ({ params }) => {
    // Start both database checks on link intent without holding up navigation.
    void queryClient.prefetchQuery(
      googleConnectionOptions("gsc", params.projectId),
    );
    void queryClient.prefetchQuery(
      googleConnectionOptions("ga4", params.projectId),
    );
  },
  component: ProjectIntegrationsRoute,
});

function ProjectIntegrationsRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // Keep the outcome after the one-shot params are cleared from the URL.
  const [linkResult] = useState(() =>
    search.wordpress || search.wordpress_error
      ? {
          connected: search.wordpress === "connected",
          error: search.wordpress_error ?? null,
        }
      : null,
  );

  useEffect(() => {
    if (!linkResult) return;
    if (linkResult.connected) toast.success("WordPress connected");
    void navigate({ search: {}, replace: true, hash: "wordpress" });
  }, [linkResult, navigate]);

  return (
    <div className="space-y-8">
      {/* The ids are the targets old #search-console / #google-analytics deep
          links are redirected to from the settings index. Each card's title
          names its integration, so the sections carry no heading. */}
      <section id="search-console" className="scroll-mt-6">
        <GoogleConnectionCard provider="gsc" projectId={projectId} />
      </section>

      <section id="google-analytics" className="scroll-mt-6">
        <GoogleConnectionCard provider="ga4" projectId={projectId} />
      </section>

      <section id="wordpress" className="scroll-mt-6">
        <WordpressConnectionCard
          projectId={projectId}
          linkResult={linkResult}
        />
      </section>

      <CrawlerAccessSettings projectId={projectId} />
    </div>
  );
}
