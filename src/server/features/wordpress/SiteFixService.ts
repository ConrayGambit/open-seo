import { z } from "zod";
import { analyzeHtml } from "@/server/lib/audit/page-analyzer";
import { AppError } from "@/server/lib/errors";
import {
  WordpressRepository,
  type SiteFixChange,
  type WordpressConnection,
} from "@/server/features/wordpress/WordpressRepository";
import {
  fetchPageHtml,
  WordpressError,
  wordpressRequest,
  type WordpressCredentials,
} from "@/server/features/wordpress/wordpressClient";
import {
  requireConnection,
  sameSite,
} from "@/server/features/wordpress/wordpressCredentials";
import { SITE_FIX_MAX_LENGTH, type SiteFixField } from "@/shared/site-fixes";

const MAX_IMAGES = 50;

const postSchema = z.object({
  id: z.number(),
  type: z.string(),
  rest_base: z.string().nullable(),
  status: z.string(),
  title: z.string(),
  link: z.string(),
  seo_plugin: z.enum(["yoast", "rank-math"]).nullable(),
  seo: z.object({ title: z.string(), description: z.string() }).nullable(),
});
type WordpressPost = z.infer<typeof postSchema>;

const mediaLookupSchema = z.array(
  z.object({
    url: z.string(),
    id: z.number().nullable(),
    alt: z.string().nullable(),
  }),
);

function requireSitePage(connection: WordpressConnection, pageUrl: string) {
  if (!sameSite(pageUrl, connection.siteUrl)) {
    throw new WordpressError(
      `This page isn't on the connected site (${connection.siteUrl}).`,
    );
  }
}

async function lookupPost(
  credentials: WordpressCredentials,
  pageUrl: string,
): Promise<WordpressPost> {
  return postSchema.parse(
    await wordpressRequest(credentials, "openseo/v1/lookup", {
      query: { url: pageUrl },
    }),
  );
}

async function getPost(
  credentials: WordpressCredentials,
  postId: string,
): Promise<WordpressPost> {
  return postSchema.parse(
    await wordpressRequest(
      credentials,
      `openseo/v1/post/${encodeURIComponent(postId)}`,
    ),
  );
}

async function lookupImages(credentials: WordpressCredentials, urls: string[]) {
  if (urls.length === 0) return [];
  return mediaLookupSchema.parse(
    await wordpressRequest(credentials, "openseo/v1/media-lookup", {
      method: "POST",
      body: { urls },
    }),
  );
}

/**
 * What OpenSEO can change on one page right now: its SEO fields, publish
 * status and the images the live page shows without alt text.
 */
async function getPageFixState(input: { projectId: string; pageUrl: string }) {
  const { connection, credentials } = await requireConnection(input.projectId);
  requireSitePage(connection, input.pageUrl);
  const post = await lookupPost(credentials, input.pageUrl);

  const html = await fetchPageHtml(input.pageUrl);
  const analysis = analyzeHtml(html, input.pageUrl, 200, 0);
  const missingAlt = new Set<string>();
  for (const image of analysis.images) {
    if (image.alt !== null || !image.src) continue;
    try {
      const url = new URL(image.src, input.pageUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        missingAlt.add(url.href);
      }
    } catch {
      // Unparseable src; nothing to fix.
    }
  }
  const images = await lookupImages(
    credentials,
    [...missingAlt].slice(0, MAX_IMAGES),
  );

  return {
    siteUrl: connection.siteUrl,
    post: {
      id: post.id,
      type: post.type,
      status: post.status,
      title: post.title,
      link: post.link,
    },
    seoPlugin: post.seo_plugin,
    seo: post.seo,
    live: {
      title: analysis.title,
      metaDescription: analysis.metaDescription,
    },
    imagesMissingAlt: images.map((image) => ({
      url: image.url,
      inMediaLibrary: image.id !== null,
      alt: image.alt,
    })),
  };
}

async function readField(
  credentials: WordpressCredentials,
  target: { field: SiteFixField; objectId: string },
): Promise<string> {
  if (target.field === "image_alt") {
    const media = z
      .object({ alt_text: z.string() })
      .parse(
        await wordpressRequest(
          credentials,
          `wp/v2/media/${encodeURIComponent(target.objectId)}`,
          { query: { context: "edit" } },
        ),
      );
    return media.alt_text;
  }
  const post = await getPost(credentials, target.objectId);
  if (target.field === "status") return post.status;
  return seoValue(post, target.field);
}

function seoValue(post: WordpressPost, field: "seo_title" | "seo_description") {
  if (!post.seo) {
    throw new WordpressError(
      "Yoast SEO or Rank Math must be active on the site to change SEO titles and descriptions.",
    );
  }
  return field === "seo_title" ? post.seo.title : post.seo.description;
}

async function writeField(
  credentials: WordpressCredentials,
  target: { field: SiteFixField; objectId: string; restBase: string | null },
  value: string,
): Promise<string> {
  const id = encodeURIComponent(target.objectId);
  if (target.field === "image_alt") {
    const media = z.object({ alt_text: z.string() }).parse(
      await wordpressRequest(credentials, `wp/v2/media/${id}`, {
        method: "POST",
        body: { alt_text: value },
      }),
    );
    return media.alt_text;
  }
  if (target.field === "status") {
    if (!target.restBase) {
      throw new WordpressError(
        "This content type can't be changed through the WordPress REST API.",
      );
    }
    const post = z
      .object({ status: z.string() })
      .parse(
        await wordpressRequest(
          credentials,
          `wp/v2/${encodeURIComponent(target.restBase)}/${id}`,
          { method: "POST", body: { status: value } },
        ),
      );
    return post.status;
  }
  const key = target.field === "seo_title" ? "title" : "description";
  const result = z
    .object({
      after: z.object({ title: z.string(), description: z.string() }),
    })
    .parse(
      await wordpressRequest(credentials, `openseo/v1/seo/${id}`, {
        method: "POST",
        body: { [key]: value },
      }),
    );
  return result.after[key];
}

function validateValue(field: SiteFixField, value: string) {
  if (field === "status") {
    if (value !== "draft") {
      throw new WordpressError(
        "Pages can only be set to draft. Use Undo to publish one again.",
      );
    }
    return value;
  }
  const trimmed = value.trim();
  if (field !== "image_alt" && trimmed === "") {
    throw new WordpressError("Enter a value to apply.");
  }
  if (trimmed.length > SITE_FIX_MAX_LENGTH[field]) {
    throw new WordpressError(
      `Keep this under ${SITE_FIX_MAX_LENGTH[field]} characters.`,
    );
  }
  return trimmed;
}

type ApplySiteFixInput = {
  projectId: string;
  userId: string;
  source: "app" | "mcp";
  pageUrl: string;
  field: SiteFixField;
  value: string;
  imageUrl?: string | null;
};

/**
 * Write one field on the connected site and log it. Returns the log entry,
 * or null when the site already held that value.
 */
async function applyFix(
  input: ApplySiteFixInput,
): Promise<SiteFixChange | null> {
  const value = validateValue(input.field, input.value);
  const { connection, credentials } = await requireConnection(input.projectId);
  requireSitePage(connection, input.pageUrl);

  let target: {
    objectId: string;
    restBase: string | null;
    imageUrl: string | null;
  };
  if (input.field === "image_alt") {
    if (!input.imageUrl) {
      throw new WordpressError("Choose which image to describe.");
    }
    const [image] = await lookupImages(credentials, [input.imageUrl]);
    if (!image?.id) {
      throw new WordpressError(
        "This image isn't in the site's Media Library, so its alt text has to be changed where the image is placed.",
      );
    }
    target = {
      objectId: String(image.id),
      restBase: null,
      imageUrl: image.url,
    };
  } else {
    const post = await lookupPost(credentials, input.pageUrl);
    target = {
      objectId: String(post.id),
      restBase: post.rest_base,
      imageUrl: null,
    };
  }

  const oldValue = await readField(credentials, {
    field: input.field,
    ...target,
  });
  if (oldValue === value) return null;
  const newValue = await writeField(
    credentials,
    { field: input.field, ...target },
    value,
  );

  return WordpressRepository.insertChange({
    projectId: input.projectId,
    pageUrl: input.pageUrl,
    field: input.field,
    objectId: target.objectId,
    restBase: target.restBase,
    imageUrl: target.imageUrl,
    oldValue,
    newValue,
    source: input.source,
    appliedByUserId: input.userId,
  });
}

/**
 * Put a change's old value back, but only while the site still holds the
 * value OpenSEO wrote; someone may have edited it since.
 */
async function rollbackFix(input: {
  projectId: string;
  changeId: string;
}): Promise<SiteFixChange> {
  const change = await WordpressRepository.getChange(
    input.projectId,
    input.changeId,
  );
  if (!change) throw new AppError("NOT_FOUND");
  if (change.rolledBackAt) {
    throw new WordpressError("This change was already undone.");
  }
  const { credentials } = await requireConnection(input.projectId);
  const target = {
    field: change.field,
    objectId: change.objectId,
    restBase: change.restBase,
  };
  const current = await readField(credentials, target);
  if (current !== change.newValue) {
    throw new WordpressError(
      `This field was changed on the site after OpenSEO's change, so Undo stopped. It now reads "${current}". OpenSEO wrote "${change.newValue}" and it was "${change.oldValue}" before.`,
    );
  }
  await writeField(credentials, target, change.oldValue);
  if (!(await WordpressRepository.markRolledBack(change.id))) {
    throw new WordpressError("This change was already undone.");
  }
  return { ...change, rolledBackAt: new Date().toISOString() };
}

async function listChanges(projectId: string, limit = 50) {
  return WordpressRepository.listChanges(projectId, limit);
}

export const SiteFixService = {
  getPageFixState,
  applyFix,
  rollbackFix,
  listChanges,
};
