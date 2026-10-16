ALTER TABLE "action_calls" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "action_servers" ADD COLUMN "labels" jsonb DEFAULT '{}'::jsonb NOT NULL;