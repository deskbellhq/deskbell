-- spec: widget-abuse-protection (2026-08-24)
--
-- rate_limits deliberately has NO org_id, which D12 otherwise requires. It is
-- an operational table in the same category as pg-boss's own: no tenant data
-- (keys are salted hashes), and its per-IP buckets are cross-tenant by nature —
-- one abuser hitting five projects must be one bucket, not five.
--
-- token_usage IS tenant data and is org-scoped normally.
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"day" date NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"embedding_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limits_expires_idx" ON "rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "token_usage_org_idx" ON "token_usage" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "token_usage_project_day_idx" ON "token_usage" USING btree ("project_id","day");