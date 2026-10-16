CREATE TABLE "gap_phrasings" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"cluster_id" text NOT NULL,
	"text" text NOT NULL,
	"normalized_key" text NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "gaps" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "gap_phrasings" ADD CONSTRAINT "gap_phrasings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gap_phrasings" ADD CONSTRAINT "gap_phrasings_cluster_id_gap_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."gap_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gap_phrasings_org_idx" ON "gap_phrasings" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gap_phrasings_project_key_idx" ON "gap_phrasings" USING btree ("project_id","normalized_key");--> statement-breakpoint
CREATE INDEX "gap_phrasings_cluster_idx" ON "gap_phrasings" USING btree ("cluster_id");--> statement-breakpoint
-- Each cluster's leader wording becomes its first phrasing row and takes the
-- vector the cluster used to hold, so the comparison has something to compare
-- with from the first question after the upgrade (spec:
-- gap-cluster-members-and-ignored-terms). Wordings other than the leaders are
-- not reconstructed here; a re-cluster is what applies the new comparison to
-- history.
INSERT INTO "gap_phrasings" (
  "id", "org_id", "project_id", "cluster_id", "text", "normalized_key",
  "embedding", "embedding_model", "first_seen", "last_seen"
)
SELECT
  'gph_' || replace(gen_random_uuid()::text, '-', ''),
  "org_id", "project_id", "id", "label", "normalized_key",
  "leader_embedding", "embedding_model", "first_seen", "last_seen"
FROM "gap_clusters";--> statement-breakpoint
ALTER TABLE "gap_clusters" DROP COLUMN "leader_embedding";