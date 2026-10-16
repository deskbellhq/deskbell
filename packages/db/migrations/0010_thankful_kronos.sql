ALTER TABLE "gap_clusters" ADD COLUMN "analysis" jsonb;--> statement-breakpoint
ALTER TABLE "gap_clusters" ADD COLUMN "analysis_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gap_clusters" ADD COLUMN "analysis_requested_by" text;--> statement-breakpoint
ALTER TABLE "gap_clusters" ADD COLUMN "analysis_error" text;