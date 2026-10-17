CREATE TABLE "site_fix_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"page_url" text NOT NULL,
	"field" text NOT NULL,
	"object_id" text NOT NULL,
	"rest_base" text,
	"image_url" text,
	"old_value" text NOT NULL,
	"new_value" text NOT NULL,
	"source" text NOT NULL,
	"applied_by_user_id" text NOT NULL,
	"applied_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"rolled_back_at" text
);
--> statement-breakpoint
CREATE TABLE "wordpress_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"site_url" text NOT NULL,
	"rest_url" text NOT NULL,
	"username" text NOT NULL,
	"encrypted_password" text NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_fix_changes" ADD CONSTRAINT "site_fix_changes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wordpress_connections" ADD CONSTRAINT "wordpress_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wordpress_connections" ADD CONSTRAINT "wordpress_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "site_fix_changes_project_applied_idx" ON "site_fix_changes" USING btree ("project_id","applied_at");--> statement-breakpoint
CREATE UNIQUE INDEX "wordpress_connections_project_idx" ON "wordpress_connections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "wordpress_connections_organization_idx" ON "wordpress_connections" USING btree ("organization_id");