import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { revalidateLogic } from "@tanstack/react-form";
import { Download } from "lucide-react";
import { z } from "zod";
import { CardShell } from "@/client/components/CardShell";
import { PermissionHint } from "@/client/components/PermissionHint";
import { QueryError } from "@/client/components/QueryState";
import { useAppForm } from "@/client/components/form/useAppForm";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/client/components/ui/alert";
import { Badge } from "@/client/components/ui/badge";
import { Button } from "@/client/components/ui/button";
import { Skeleton } from "@/client/components/ui/skeleton";
import { SiteFixChangeLog } from "@/client/features/wordpress/SiteFixChangeLog";
import {
  wordpressCheckOptions,
  wordpressConnectionOptions,
} from "@/client/features/wordpress/wordpressQueries";
import {
  disconnectWordpress,
  startWordpressConnect,
} from "@/serverFunctions/wordpress";

const SEO_PLUGIN_NAMES = { yoast: "Yoast SEO", "rank-math": "Rank Math" };

/**
 * Connects a project to its WordPress site so audit fixes can be applied
 * from OpenSEO, and lists the changes made with Undo.
 */
export function WordpressConnectionCard({
  projectId,
  linkResult,
}: {
  projectId: string;
  /** Outcome of a connect that just returned from WordPress, if any. */
  linkResult: { connected: boolean; error: string | null } | null;
}) {
  const queryClient = useQueryClient();
  const connectionQuery = useQuery(wordpressConnectionOptions(projectId));
  const info = connectionQuery.data;
  const connection = info?.connection ?? null;

  const checkQuery = useQuery({
    ...wordpressCheckOptions(projectId),
    enabled: Boolean(connection),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnectWordpress({ data: { projectId } }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: wordpressConnectionOptions(projectId).queryKey,
      }),
  });

  return (
    <CardShell
      title="WordPress"
      icon={<WordpressLogo />}
      action={
        connectionQuery.isSuccess ? (
          <Badge variant={connection ? "success" : "outline"}>
            <span className="size-1.5 rounded-full bg-current" />
            {connection ? "Connected" : "Not connected"}
          </Badge>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {linkResult?.error ? (
          <Alert variant="destructive">
            <AlertTitle>WordPress wasn't connected</AlertTitle>
            <AlertDescription>{linkResult.error}</AlertDescription>
          </Alert>
        ) : null}
        {disconnectMutation.data && !disconnectMutation.data.revoked ? (
          <Alert>
            <AlertTitle>Disconnected from OpenSEO</AlertTitle>
            <AlertDescription>
              OpenSEO couldn't remove its password from the site. In WordPress,
              open Users → Profile → Application Passwords and revoke the
              OpenSEO entry.
            </AlertDescription>
          </Alert>
        ) : null}

        {connectionQuery.isPending ? (
          <div
            role="status"
            aria-label="Loading connection"
            className="space-y-3"
          >
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-9 w-24" />
          </div>
        ) : connectionQuery.isError ? (
          <QueryError
            error={connectionQuery.error}
            fallback="Couldn't check this project's WordPress connection."
            onRetry={() => void connectionQuery.refetch()}
            isRetrying={connectionQuery.isFetching}
          />
        ) : !info?.configured ? (
          <p className="text-sm text-muted-foreground">
            WordPress connections aren't set up on this server. Set
            WORDPRESS_CREDENTIALS_SECRET to a random value of at least 32
            characters, then restart OpenSEO.
          </p>
        ) : connection ? (
          <>
            <div className="space-y-1 text-sm">
              <p>
                <span className="font-medium">{connection.siteUrl}</span>
                <span className="text-muted-foreground">
                  {" "}
                  as {connection.username}
                </span>
              </p>
              <ConnectorStatus
                loading={checkQuery.isPending}
                check={checkQuery.data}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href="/api/wordpress/connector.zip" download />}
              >
                <Download className="size-4" />
                OpenSEO Connector plugin
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void checkQuery.refetch()}
                disabled={checkQuery.isFetching}
              >
                Check again
              </Button>
              {info.canManage ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                >
                  Disconnect
                </Button>
              ) : null}
            </div>
            <SiteFixChangeLog
              projectId={projectId}
              canManage={info.canManage}
            />
          </>
        ) : info.canManage ? (
          <ConnectForm projectId={projectId} />
        ) : (
          <PermissionHint action="connect this project's WordPress site" />
        )}
      </div>
    </CardShell>
  );
}

function ConnectorStatus({
  loading,
  check,
}: {
  loading: boolean;
  check:
    | {
        ok: boolean;
        problem: string | null;
        connectorVersion: string | null;
        seoPlugin: "yoast" | "rank-math" | null;
      }
    | undefined;
}) {
  if (loading || !check) {
    return <p className="text-muted-foreground">Checking the site…</p>;
  }
  if (!check.ok) {
    return <p className="text-destructive">{check.problem}</p>;
  }
  return (
    <p className="text-muted-foreground">
      OpenSEO Connector {check.connectorVersion} is active.{" "}
      {check.seoPlugin
        ? `SEO titles and descriptions are edited in ${SEO_PLUGIN_NAMES[check.seoPlugin]}.`
        : "Install Yoast SEO or Rank Math to edit SEO titles and descriptions."}
    </p>
  );
}

const connectSchema = z.object({
  siteUrl: z.string().trim().min(1, "Enter the site's address."),
});

function ConnectForm({ projectId }: { projectId: string }) {
  const connectMutation = useMutation({
    mutationFn: (siteUrl: string) =>
      startWordpressConnect({ data: { projectId, siteUrl } }),
  });

  const form = useAppForm({
    defaultValues: { siteUrl: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: connectSchema },
    onSubmit: async ({ value, formApi }) => {
      const result = await connectMutation.mutateAsync(value.siteUrl);
      if (!result.ok) {
        formApi.setErrorMap({
          onSubmit: { fields: { siteUrl: result.message } },
        });
        return;
      }
      // WordPress shows its own approval screen, then sends the password
      // back here. The desktop app opens it in the default browser.
      window.location.assign(result.data.authorizeUrl);
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Apply audit fixes to your WordPress site from OpenSEO: SEO titles, meta
        descriptions, image alt text, and taking pages offline. You approve
        access on your own WordPress site, and OpenSEO never sees your login
        password. You can revoke it any time under Users → Profile → Application
        Passwords.
      </p>
      <p className="text-sm text-muted-foreground">
        After connecting, install the{" "}
        <a className="underline" href="/api/wordpress/connector.zip" download>
          OpenSEO Connector plugin
        </a>{" "}
        on the site (Plugins → Add New → Upload Plugin).
      </p>
      <form.AppForm>
        <form.Form className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <form.AppField name="siteUrl">
              {(field) => (
                <field.TextField
                  label="Site address"
                  placeholder="example.com"
                  autoComplete="url"
                />
              )}
            </form.AppField>
          </div>
          <form.SubmitButton>Connect WordPress</form.SubmitButton>
        </form.Form>
      </form.AppForm>
    </div>
  );
}

function WordpressLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="11"
        fill="none"
        stroke="#21759b"
        strokeWidth="2"
      />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="13"
        fontWeight="700"
        fontFamily="Georgia, serif"
        fill="#21759b"
      >
        W
      </text>
    </svg>
  );
}
