CREATE TABLE "action_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text,
	"server_id" text,
	"tool" text NOT NULL,
	"title" text NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb,
	"output_truncated" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"summary" text,
	"tool_call_id" text,
	"approval_id" text,
	"approval_signature" text,
	"resume_messages" jsonb,
	"expires_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	"end_user_id" text,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"url" text NOT NULL,
	"transport" text DEFAULT 'http' NOT NULL,
	"auth_kind" text DEFAULT 'none' NOT NULL,
	"auth_header_name" text,
	"auth_secret" text,
	"identity" text DEFAULT 'none' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"policies" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tools" jsonb,
	"tools_fetched_at" timestamp with time zone,
	"server_info" jsonb,
	"initialize_result" jsonb,
	"status" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signing_keys" (
	"kid" text PRIMARY KEY NOT NULL,
	"alg" text NOT NULL,
	"public_jwk" jsonb NOT NULL,
	"private_jwk" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "action_calls" ADD CONSTRAINT "action_calls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_calls" ADD CONSTRAINT "action_calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_calls" ADD CONSTRAINT "action_calls_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_calls" ADD CONSTRAINT "action_calls_server_id_action_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."action_servers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_calls" ADD CONSTRAINT "action_calls_end_user_id_end_users_id_fk" FOREIGN KEY ("end_user_id") REFERENCES "public"."end_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_servers" ADD CONSTRAINT "action_servers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_calls_org_idx" ON "action_calls" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "action_calls_project_created_idx" ON "action_calls" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "action_calls_conversation_idx" ON "action_calls" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "action_calls_message_idx" ON "action_calls" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_calls_approval_idx" ON "action_calls" USING btree ("approval_id");--> statement-breakpoint
CREATE INDEX "action_servers_org_idx" ON "action_servers" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_servers_project_slug_idx" ON "action_servers" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "signing_keys_active_idx" ON "signing_keys" USING btree ("retired_at","created_at");