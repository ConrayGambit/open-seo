import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import {
  Table,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { siteFixChangesOptions } from "@/client/features/wordpress/wordpressQueries";
import { rollbackSiteFix } from "@/serverFunctions/wordpress";
import { SafeExternalLink } from "@/client/components/SafeExternalLink";
import { SITE_FIX_FIELD_LABELS } from "@/shared/site-fixes";

function pagePath(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function displayValue(value: string) {
  return value === "" ? "(empty)" : value;
}

/** Changes OpenSEO made on the connected site, newest first, with Undo. */
export function SiteFixChangeLog({
  projectId,
  canManage,
}: {
  projectId: string;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const changesQuery = useQuery(siteFixChangesOptions(projectId));

  const undoMutation = useMutation({
    meta: { errorToast: false },
    mutationFn: (changeId: string) =>
      rollbackSiteFix({ data: { projectId, changeId } }),
    onSuccess: async (result) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Change undone on the site");
      await queryClient.invalidateQueries({
        queryKey: siteFixChangesOptions(projectId).queryKey,
      });
    },
  });

  const changes = changesQuery.data ?? [];
  if (changes.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Changes made from OpenSEO</h3>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Page</TableHead>
              <TableHead>Field</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>When</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {changes.map((change) => (
              <TableRow key={change.id}>
                <TableCell className="max-w-56 truncate">
                  <SafeExternalLink
                    url={change.pageUrl}
                    label={pagePath(change.pageUrl)}
                    className="inline-flex items-center gap-1 hover:underline"
                  />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {SITE_FIX_FIELD_LABELS[change.field]}
                  {change.source === "mcp" ? " (agent)" : ""}
                </TableCell>
                <TableCell className="max-w-80 whitespace-normal text-xs">
                  <span className="text-muted-foreground line-through">
                    {displayValue(change.oldValue)}
                  </span>{" "}
                  → {displayValue(change.newValue)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(change.appliedAt).toLocaleString()}
                </TableCell>
                <TableCell>
                  {change.rolledBackAt ? (
                    <span className="text-xs text-muted-foreground">
                      Undone
                    </span>
                  ) : canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={undoMutation.isPending}
                      onClick={() => undoMutation.mutate(change.id)}
                    >
                      Undo
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </div>
  );
}
