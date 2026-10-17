import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Input } from "@/client/components/ui/input";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Textarea } from "@/client/components/ui/textarea";
import { siteFixChangesOptions } from "@/client/features/wordpress/wordpressQueries";
import {
  applySiteFix,
  getSiteFixState,
  rollbackSiteFix,
} from "@/serverFunctions/wordpress";
import { SITE_FIX_FIELD_LABELS, type SiteFixField } from "@/shared/site-fixes";

type FixState = Extract<
  Awaited<ReturnType<typeof getSiteFixState>>,
  { ok: true }
>["data"];

const RECOMMENDED_LENGTH = {
  seo_title: { min: 30, max: 60 },
  seo_description: { min: 70, max: 160 },
} as const;

/**
 * Preview and apply one audit fix on the connected WordPress site. The
 * current value is read live from the site; nothing is written until Apply.
 */
export function SiteFixDialog({
  projectId,
  pageUrl,
  field,
  onClose,
}: {
  projectId: string;
  pageUrl: string;
  field: SiteFixField;
  onClose: () => void;
}) {
  const stateQuery = useQuery({
    queryKey: ["siteFixState", projectId, pageUrl],
    queryFn: () => getSiteFixState({ data: { projectId, pageUrl } }),
    staleTime: 0,
  });
  const result = stateQuery.data;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Fix {SITE_FIX_FIELD_LABELS[field].toLowerCase()}
          </DialogTitle>
          <DialogDescription className="break-all">{pageUrl}</DialogDescription>
        </DialogHeader>
        {stateQuery.isPending ? (
          <div
            role="status"
            aria-label="Reading the page"
            className="space-y-3"
          >
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : stateQuery.isError ? (
          <p className="text-sm text-destructive">
            Couldn't read this page from WordPress. Try again.
          </p>
        ) : result && !result.ok ? (
          <p className="text-sm text-destructive">{result.message}</p>
        ) : result ? (
          <FixForm
            projectId={projectId}
            pageUrl={pageUrl}
            field={field}
            state={result.data}
            onApplied={() => void stateQuery.refetch()}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function useApplyFix(projectId: string, onApplied: () => void) {
  const queryClient = useQueryClient();
  const refreshLog = () =>
    queryClient.invalidateQueries({
      queryKey: siteFixChangesOptions(projectId).queryKey,
    });

  return useMutation({
    meta: { errorToast: false },
    mutationFn: (input: {
      pageUrl: string;
      field: SiteFixField;
      value: string;
      imageUrl?: string;
    }) => applySiteFix({ data: { projectId, ...input } }),
    onSuccess: async (result) => {
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      onApplied();
      await refreshLog();
      const change = result.data;
      if (!change) {
        toast.info("The site already had this value. Nothing changed.");
        return;
      }
      toast.success("Changed on the site", {
        description:
          "If the page still shows the old value, a caching plugin may need clearing.",
        action: {
          label: "Undo",
          onClick: () =>
            void rollbackSiteFix({
              data: { projectId, changeId: change.id },
            }).then((undo) => {
              if (undo.ok) toast.success("Change undone on the site");
              else toast.error(undo.message);
              onApplied();
              void refreshLog();
            }),
        },
      });
    },
  });
}

function FixForm({
  projectId,
  pageUrl,
  field,
  state,
  onApplied,
}: {
  projectId: string;
  pageUrl: string;
  field: SiteFixField;
  state: FixState;
  onApplied: () => void;
}) {
  if (field === "image_alt") {
    return (
      <ImageAltForm
        projectId={projectId}
        pageUrl={pageUrl}
        state={state}
        onApplied={onApplied}
      />
    );
  }
  if (field === "status") {
    return (
      <DraftForm
        projectId={projectId}
        pageUrl={pageUrl}
        state={state}
        onApplied={onApplied}
      />
    );
  }
  return (
    <SeoFieldForm
      projectId={projectId}
      pageUrl={pageUrl}
      field={field}
      state={state}
      onApplied={onApplied}
    />
  );
}

function SeoFieldForm({
  projectId,
  pageUrl,
  field,
  state,
  onApplied,
}: {
  projectId: string;
  pageUrl: string;
  field: "seo_title" | "seo_description";
  state: FixState;
  onApplied: () => void;
}) {
  const live =
    field === "seo_title" ? state.live.title : state.live.metaDescription;
  const stored =
    field === "seo_title" ? state.seo?.title : state.seo?.description;
  const [value, setValue] = useState(stored || live || "");
  const apply = useApplyFix(projectId, onApplied);
  const range = RECOMMENDED_LENGTH[field];
  const length = value.trim().length;

  if (!state.seoPlugin) {
    return (
      <p className="text-sm text-muted-foreground">
        OpenSEO edits SEO titles and descriptions through Yoast SEO or Rank
        Math, and neither is active on this site.
      </p>
    );
  }

  return (
    <div className="space-y-4 text-sm">
      <dl className="space-y-2">
        <div>
          <dt className="text-muted-foreground">The page shows now</dt>
          <dd>{live || "(nothing)"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            Saved in {state.seoPlugin === "yoast" ? "Yoast SEO" : "Rank Math"}
          </dt>
          <dd>
            {stored || "(empty, so the plugin's default template is used)"}
          </dd>
        </div>
      </dl>
      <div className="space-y-1">
        <label htmlFor="site-fix-value" className="font-medium">
          New {SITE_FIX_FIELD_LABELS[field].toLowerCase()}
        </label>
        <Textarea
          id="site-fix-value"
          value={value}
          rows={field === "seo_title" ? 2 : 4}
          onChange={(event) => setValue(event.target.value)}
        />
        <p
          className={
            length < range.min || length > range.max
              ? "text-xs text-warning-foreground dark:text-warning"
              : "text-xs text-muted-foreground"
          }
        >
          {length} characters. Aim for {range.min} to {range.max}.
        </p>
      </div>
      <div className="flex justify-end">
        <Button
          disabled={apply.isPending || length === 0 || value.trim() === stored}
          onClick={() => apply.mutate({ pageUrl, field, value })}
        >
          {apply.isPending ? "Applying…" : "Apply to site"}
        </Button>
      </div>
    </div>
  );
}

function ImageAltForm({
  projectId,
  pageUrl,
  state,
  onApplied,
}: {
  projectId: string;
  pageUrl: string;
  state: FixState;
  onApplied: () => void;
}) {
  if (state.imagesMissingAlt.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Every image on the live page has alt text now.
      </p>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground">
        Alt text is saved on the image in the Media Library. Page builders such
        as Elementor show it right away. Images placed with the block editor
        keep the alt text they were inserted with, so re-insert those or edit
        them on the page.
      </p>
      <ul className="max-h-96 space-y-3 overflow-y-auto">
        {state.imagesMissingAlt.map((image) => (
          <ImageAltRow
            key={image.url}
            projectId={projectId}
            pageUrl={pageUrl}
            image={image}
            onApplied={onApplied}
          />
        ))}
      </ul>
    </div>
  );
}

function ImageAltRow({
  projectId,
  pageUrl,
  image,
  onApplied,
}: {
  projectId: string;
  pageUrl: string;
  image: FixState["imagesMissingAlt"][number];
  onApplied: () => void;
}) {
  const [value, setValue] = useState(image.alt ?? "");
  const apply = useApplyFix(projectId, onApplied);
  return (
    <li className="flex gap-3 rounded-md border border-border p-2">
      <img
        src={image.url}
        alt=""
        className="size-16 shrink-0 rounded object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-xs text-muted-foreground" title={image.url}>
          {image.url.split("/").pop()}
        </p>
        {image.inMediaLibrary ? (
          <div className="flex gap-2">
            <Input
              aria-label="Alt text"
              value={value}
              placeholder="Describe the image"
              onChange={(event) => setValue(event.target.value)}
            />
            <Button
              size="sm"
              disabled={apply.isPending || value.trim() === ""}
              onClick={() =>
                apply.mutate({
                  pageUrl,
                  field: "image_alt",
                  value,
                  imageUrl: image.url,
                })
              }
            >
              Apply
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Not in the Media Library (a theme or external image). Edit it where
            it's placed.
          </p>
        )}
      </div>
    </li>
  );
}

function DraftForm({
  projectId,
  pageUrl,
  state,
  onApplied,
}: {
  projectId: string;
  pageUrl: string;
  state: FixState;
  onApplied: () => void;
}) {
  const apply = useApplyFix(projectId, onApplied);
  if (state.post.status !== "publish") {
    return (
      <p className="text-sm text-muted-foreground">
        “{state.post.title}” is already {state.post.status}, so it's not public.
      </p>
    );
  }
  return (
    <div className="space-y-4 text-sm">
      <p>
        Setting “{state.post.title}” to draft takes it off the site. Visitors
        and search engines will get a “not found” page, and links to it will
        break until you publish it again or add a redirect. You can undo this
        from the change log.
      </p>
      <div className="flex justify-end">
        <Button
          variant="destructive"
          disabled={apply.isPending}
          onClick={() =>
            apply.mutate({ pageUrl, field: "status", value: "draft" })
          }
        >
          {apply.isPending ? "Applying…" : "Set to draft"}
        </Button>
      </div>
    </div>
  );
}
