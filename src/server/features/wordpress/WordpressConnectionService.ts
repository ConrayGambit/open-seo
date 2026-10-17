import { and, eq, gt, like, lt } from "drizzle-orm";
import { symmetricEncrypt } from "better-auth/crypto";
import { z } from "zod";
import { db } from "@/db";
import { verification } from "@/db/schema";
import { WordpressRepository } from "@/server/features/wordpress/WordpressRepository";
import {
  discoverWordpressSite,
  WordpressError,
  wordpressRequest,
} from "@/server/features/wordpress/wordpressClient";
import {
  credentialsFor,
  getEncryptionKey,
  isWordpressConfigured,
  requireConnection,
  sameSite,
} from "@/server/features/wordpress/wordpressCredentials";

// Fixed so WordPress lists every OpenSEO password under one application.
const OPENSEO_APP_ID = "5b3f6f0e-4f0a-4d5c-9a43-6f2c9d0b7e21";
const STATE_TTL_MS = 15 * 60 * 1_000;
const STATE_PREFIX = "wordpress-link:";

const pendingConnectSchema = z.object({
  userId: z.string(),
  projectId: z.string(),
  organizationId: z.string(),
  homeUrl: z.string(),
  restUrl: z.string(),
});

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Start the Authorize Application flow and return the URL of the site's own
 * approval screen. WordPress sends the new password to `callbackUrl`.
 */
async function startConnect(input: {
  projectId: string;
  organizationId: string;
  userId: string;
  siteUrl: string;
  callbackBaseUrl: string;
}): Promise<{ authorizeUrl: string }> {
  await getEncryptionKey();
  const site = await discoverWordpressSite(input.siteUrl);

  const state = randomState();
  const now = new Date();
  await db
    .delete(verification)
    .where(
      and(
        like(verification.identifier, `${STATE_PREFIX}%`),
        lt(verification.expiresAt, now),
      ),
    );
  await db.insert(verification).values({
    id: crypto.randomUUID(),
    identifier: `${STATE_PREFIX}${state}`,
    value: JSON.stringify({
      userId: input.userId,
      projectId: input.projectId,
      organizationId: input.organizationId,
      homeUrl: site.homeUrl,
      restUrl: site.restUrl,
    }),
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  });

  const callback = new URL(input.callbackBaseUrl);
  callback.searchParams.set("state", state);
  const reject = new URL(callback);
  reject.searchParams.set("rejected", "1");

  const authorize = new URL(site.authorizeUrl);
  // WordPress refuses a second password with the same name for one user.
  authorize.searchParams.set(
    "app_name",
    `OpenSEO (${now.toISOString().slice(0, 16).replace("T", " ")} UTC)`,
  );
  authorize.searchParams.set("app_id", OPENSEO_APP_ID);
  authorize.searchParams.set("success_url", callback.toString());
  authorize.searchParams.set("reject_url", reject.toString());
  return { authorizeUrl: authorize.toString() };
}

async function consumeState(state: string) {
  const [row] = await db
    .delete(verification)
    .where(
      and(
        eq(verification.identifier, `${STATE_PREFIX}${state}`),
        gt(verification.expiresAt, new Date()),
      ),
    )
    .returning({ value: verification.value });
  if (!row) return null;
  const parsed = pendingConnectSchema.safeParse(JSON.parse(row.value));
  return parsed.success ? parsed.data : null;
}

const currentUserSchema = z.object({
  capabilities: z.record(z.string(), z.boolean()).optional(),
});

/**
 * Finish the flow WordPress redirected back to. Returns the project the
 * approval was for (null when the state is unknown) and, on failure, why.
 */
async function completeConnect(input: {
  userId: string;
  state: string;
  rejected: boolean;
  siteUrl: string | null;
  userLogin: string | null;
  password: string | null;
}): Promise<{ projectId: string | null; error: string | null }> {
  const pending = await consumeState(input.state);
  if (!pending || pending.userId !== input.userId) {
    return { projectId: null, error: "expired" };
  }
  try {
    await saveApprovedConnection(pending, input);
    return { projectId: pending.projectId, error: null };
  } catch (error) {
    if (!(error instanceof WordpressError)) throw error;
    return { projectId: pending.projectId, error: error.message };
  }
}

async function saveApprovedConnection(
  pending: z.infer<typeof pendingConnectSchema>,
  input: {
    userId: string;
    rejected: boolean;
    siteUrl: string | null;
    userLogin: string | null;
    password: string | null;
  },
) {
  if (input.rejected) {
    throw new WordpressError(
      "Access was declined in WordPress, so the site wasn't connected.",
    );
  }
  if (!input.userLogin || !input.password) {
    throw new WordpressError(
      "WordPress didn't send a password back. Try connecting again.",
    );
  }
  if (input.siteUrl && !sameSite(input.siteUrl, pending.homeUrl)) {
    throw new WordpressError(
      "WordPress answered from a different site than the one you started with.",
    );
  }

  const credentials = {
    restUrl: pending.restUrl,
    username: input.userLogin,
    password: input.password,
  };
  const me = currentUserSchema.safeParse(
    await wordpressRequest(credentials, "wp/v2/users/me", {
      query: { context: "edit" },
    }),
  );
  if (!me.success || !me.data.capabilities?.edit_posts) {
    throw new WordpressError(
      "This WordPress user can't edit posts. Connect with an administrator or editor account.",
    );
  }

  await WordpressRepository.upsertConnection({
    projectId: pending.projectId,
    organizationId: pending.organizationId,
    siteUrl: pending.homeUrl,
    restUrl: pending.restUrl,
    username: input.userLogin,
    encryptedPassword: await symmetricEncrypt({
      key: await getEncryptionKey(),
      data: input.password,
    }),
    connectedByUserId: input.userId,
  });
}

// ---------- status ----------

const statusSchema = z.object({
  version: z.string(),
  seo_plugin: z.enum(["yoast", "rank-math"]).nullable(),
});

async function getConnection(projectId: string) {
  const [connection, configured] = await Promise.all([
    WordpressRepository.getConnection(projectId),
    isWordpressConfigured(),
  ]);
  return {
    configured,
    connection: connection
      ? {
          siteUrl: connection.siteUrl,
          username: connection.username,
          connectedAt: connection.createdAt,
        }
      : null,
  };
}

/** Live check of the connection and the companion plugin. */
async function checkConnection(projectId: string): Promise<{
  ok: boolean;
  problem: string | null;
  connectorVersion: string | null;
  seoPlugin: "yoast" | "rank-math" | null;
}> {
  try {
    const { credentials } = await requireConnection(projectId);
    const status = statusSchema.parse(
      await wordpressRequest(credentials, "openseo/v1/status"),
    );
    return {
      ok: true,
      problem: null,
      connectorVersion: status.version,
      seoPlugin: status.seo_plugin,
    };
  } catch (error) {
    if (!(error instanceof WordpressError)) throw error;
    return {
      ok: false,
      problem: error.message,
      connectorVersion: null,
      seoPlugin: null,
    };
  }
}

const introspectSchema = z.object({ uuid: z.string() });

/** Remove the connection, revoking OpenSEO's password on the site if it can. */
async function disconnect(projectId: string): Promise<{ revoked: boolean }> {
  const connection = await WordpressRepository.getConnection(projectId);
  if (!connection) return { revoked: false };
  let revoked = false;
  try {
    const credentials = await credentialsFor(connection);
    const { uuid } = introspectSchema.parse(
      await wordpressRequest(
        credentials,
        "wp/v2/users/me/application-passwords/introspect",
      ),
    );
    await wordpressRequest(
      credentials,
      `wp/v2/users/me/application-passwords/${encodeURIComponent(uuid)}`,
      { method: "DELETE" },
    );
    revoked = true;
  } catch {
    // The site may be down or the password already revoked; the row still goes.
  }
  await WordpressRepository.deleteConnection(projectId);
  return { revoked };
}

export const WordpressConnectionService = {
  startConnect,
  completeConnect,
  getConnection,
  checkConnection,
  disconnect,
};
