CREATE TABLE "notification_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"event" text NOT NULL,
	"subject_key" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"delivered_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "notifications" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_org_idx" ON "notification_deliveries" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_subject_idx" ON "notification_deliveries" USING btree ("project_id","event","subject_key","channel");--> statement-breakpoint
CREATE INDEX "notification_deliveries_project_channel_idx" ON "notification_deliveries" USING btree ("project_id","channel","created_at");