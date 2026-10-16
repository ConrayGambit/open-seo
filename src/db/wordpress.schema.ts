import { sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { organization } from "./better-auth-schema";
import { projects } from "./app.schema";

// A project's WordPress site, connected through WordPress's Authorize
// Application flow. The application password is encrypted with
// WORDPRESS_CREDENTIALS_SECRET and never leaves the server.
export const wordpressConnections = sqliteTable(
  "wordpress_connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The site's home URL as WordPress reports it.
    siteUrl: text("site_url").notNull(),
    // REST API root, e.g. "https://example.com/wp-json/".
    restUrl: text("rest_url").notNull(),
    username: text("username").notNull(),
    encryptedPassword: text("encrypted_password").notNull(),
    connectedByUserId: text("connected_by_user_id").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (table) => [
    uniqueIndex("wordpress_connections_project_idx").on(table.projectId),
    index("wordpress_connections_organization_idx").on(table.organizationId),
  ],
);

// One field change OpenSEO made on a connected site. oldValue is what the
// site held before the write, so Undo can restore it.
export const siteFixChanges = sqliteTable(
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
    // WordPress post or attachment ID the field belongs to.
    objectId: text("object_id").notNull(),
    // REST collection for status changes ("pages", "posts", ...).
    restBase: text("rest_base"),
    imageUrl: text("image_url"),
    oldValue: text("old_value").notNull(),
    newValue: text("new_value").notNull(),
    source: text("source", { enum: ["app", "mcp"] }).notNull(),
    appliedByUserId: text("applied_by_user_id").notNull(),
    appliedAt: text("applied_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    rolledBackAt: text("rolled_back_at"),
  },
  (table) => [
    index("site_fix_changes_project_applied_idx").on(
      table.projectId,
      table.appliedAt,
    ),
  ],
);
