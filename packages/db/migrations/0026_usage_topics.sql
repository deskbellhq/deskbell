ALTER TABLE "messages" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "topics" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "conversations_context_idx" ON "conversations" USING gin ("context" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "messages_topic_pending_idx" ON "messages" USING btree ("conversation_id","created_at") WHERE role = 'user' and topic is null;