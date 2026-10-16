CREATE TABLE "gap_clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"label" text NOT NULL,
	"normalized_key" text NOT NULL,
	"leader_embedding" vector(1536),
	"embedding_model" text,
	"embedding_version" integer DEFAULT 1 NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"reopened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "gap_cluster_id" text;--> statement-breakpoint
ALTER TABLE "gap_clusters" ADD CONSTRAINT "gap_clusters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gap_clusters_org_idx" ON "gap_clusters" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gap_clusters_project_key_idx" ON "gap_clusters" USING btree ("project_id","normalized_key");--> statement-breakpoint
CREATE INDEX "gap_clusters_project_status_idx" ON "gap_clusters" USING btree ("org_id","project_id","status","last_seen");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_gap_cluster_id_gap_clusters_id_fk" FOREIGN KEY ("gap_cluster_id") REFERENCES "public"."gap_clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_gap_cluster_idx" ON "messages" USING btree ("gap_cluster_id");