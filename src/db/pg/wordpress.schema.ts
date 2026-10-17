import { sql } from "drizzle-orm";
import { index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// See src/db/pg/app.schema.ts for why timestamps are ISO-8601 UTC text.
const isoNow = sql`to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

// See src/db/wordpress.schema.ts.
export const wordpressConnections = pgTable(
  "wordpress_connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    siteUrl: text("site_url").notNull(),
    restUrl: text("rest_url").notNull(),
    username: text("username").notNull(),
    encryptedPassword: text("encrypted_password").notNull(),
    connectedByUserId: text("connected_by_user_id").notNull(),
    createdAt: text("created_at").notNull().default(isoNow),
    updatedAt: text("updated_at").notNull().default(isoNow),
  },
  (table) => [
    uniqueIndex("wordpress_connections_project_idx").on(table.projectId),
    index("wordpress_connections_organization_idx").on(table.organizationId),
  ],
);

export const siteFixChanges = pgTable(
  "site_fix_changes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    pageUrl: text("page_url").notNull(),
    field: text("field", {
      enum: ["seo_title", "seo_description", "image_alt", "status"],
    }).notNull(),
    objectId: text("object_id").notNull(),
    restBase: text("rest_base"),
    imageUrl: text("image_url"),
    oldValue: text("old_value").notNull(),
    newValue: text("new_value").notNull(),
    source: text("source", { enum: ["app", "mcp"] }).notNull(),
    appliedByUserId: text("applied_by_user_id").notNull(),
    appliedAt: text("applied_at").notNull().default(isoNow),
    rolledBackAt: text("rolled_back_at"),
  },
  (table) => [
    index("site_fix_changes_project_applied_idx").on(
      table.projectId,
      table.appliedAt,
    ),
  ],
);
