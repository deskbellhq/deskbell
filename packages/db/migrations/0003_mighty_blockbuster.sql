CREATE TABLE "widget_installs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"origin" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "onboarding_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "widget_installs" ADD CONSTRAINT "widget_installs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "widget_installs_org_idx" ON "widget_installs" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "widget_installs_project_origin_idx" ON "widget_installs" USING btree ("project_id","origin");