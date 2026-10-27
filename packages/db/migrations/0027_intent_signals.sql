DROP INDEX "messages_topic_pending_idx";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "intent" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "signals" text[];--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "classify_questions" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_classify_pending_idx" ON "messages" USING btree ("conversation_id","created_at") WHERE role = 'user' and (intent is null or topic is null);