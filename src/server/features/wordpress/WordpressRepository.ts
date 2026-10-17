import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { siteFixChanges, wordpressConnections } from "@/db/schema";

export type WordpressConnection = typeof wordpressConnections.$inferSelect;
export type SiteFixChange = typeof siteFixChanges.$inferSelect;

async function getConnection(
  projectId: string,
): Promise<WordpressConnection | null> {
  const rows = await db
    .select()
    .from(wordpressConnections)
    .where(eq(wordpressConnections.projectId, projectId))
    .limit(1);
  return rows[0] ?? null;
}

async function upsertConnection(input: {
  projectId: string;
  organizationId: string;
  siteUrl: string;
  restUrl: string;
  username: string;
  encryptedPassword: string;
  connectedByUserId: string;
}): Promise<void> {
  const { projectId: _projectId, ...rest } = input;
  const now = new Date().toISOString();
  await db
    .insert(wordpressConnections)
    .values({
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...input,
    })
    .onConflictDoUpdate({
      target: wordpressConnections.projectId,
      set: { ...rest, createdAt: now, updatedAt: now },
    });
}

async function deleteConnection(projectId: string): Promise<void> {
  await db
    .delete(wordpressConnections)
    .where(eq(wordpressConnections.projectId, projectId));
}

async function insertChange(
  input: Omit<
    typeof siteFixChanges.$inferInsert,
    "id" | "appliedAt" | "rolledBackAt"
  >,
): Promise<SiteFixChange> {
  const [row] = await db
    .insert(siteFixChanges)
    .values({
      id: crypto.randomUUID(),
      appliedAt: new Date().toISOString(),
      ...input,
    })
    .returning();
  if (!row) throw new Error("Failed to insert site_fix_change");
  return row;
}

async function getChange(
  projectId: string,
  changeId: string,
): Promise<SiteFixChange | null> {
  const rows = await db
    .select()
    .from(siteFixChanges)
    .where(
      and(
        eq(siteFixChanges.projectId, projectId),
        eq(siteFixChanges.id, changeId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function listChanges(
  projectId: string,
  limit: number,
): Promise<SiteFixChange[]> {
  return db
    .select()
    .from(siteFixChanges)
    .where(eq(siteFixChanges.projectId, projectId))
    .orderBy(desc(siteFixChanges.appliedAt), desc(siteFixChanges.id))
    .limit(limit);
}

/** Mark a change undone; false when another request already did. */
async function markRolledBack(changeId: string): Promise<boolean> {
  const rows = await db
    .update(siteFixChanges)
    .set({ rolledBackAt: new Date().toISOString() })
    .where(
      and(eq(siteFixChanges.id, changeId), isNull(siteFixChanges.rolledBackAt)),
    )
    .returning({ id: siteFixChanges.id });
  return rows.length > 0;
}

export const WordpressRepository = {
  getConnection,
  upsertConnection,
  deleteConnection,
  insertChange,
  getChange,
  listChanges,
  markRolledBack,
};
