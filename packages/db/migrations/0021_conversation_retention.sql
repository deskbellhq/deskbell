ALTER TABLE "projects" ADD COLUMN "conversation_retention_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "conversations_purged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "conversations_purged_count" integer DEFAULT 0 NOT NULL;