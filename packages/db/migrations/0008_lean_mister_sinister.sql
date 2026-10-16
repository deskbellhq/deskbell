ALTER TABLE "messages" ADD COLUMN "retrieval_hits" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "retrieval_top_score" real;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "retrieval_mean_score" real;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "refusal_reason" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sources_named" boolean;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "latency_ms" integer;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "model" text;--> statement-breakpoint
CREATE INDEX "conversations_project_created_idx" ON "conversations" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_org_created_idx" ON "messages" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_gap_idx" ON "messages" USING btree ("conversation_id","created_at") WHERE role = 'assistant' and (refused or feedback = 'down');