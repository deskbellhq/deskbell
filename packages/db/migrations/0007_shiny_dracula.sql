-- Hand-corrected after `drizzle-kit generate` (spec: hybrid-retrieval §1; the
-- precedent for hand-augmented generated SQL is 0004). Three corrections:
--   1. The unaccent extension and the `deskbell_search` text-search config are
--      created first — the generated column below references the config, and
--      drizzle-kit cannot express either. unaccent() the FUNCTION is STABLE,
--      so it cannot appear in a generated expression; chained as a FILTER
--      DICTIONARY inside a constant config, to_tsvector() stays IMMUTABLE.
--      `simple` + unaccent, no stemming: the vector leg owns morphology; this
--      leg exists for exact tokens, and unaccent fixes diacritic-less typing.
--      unaccent is a trusted extension (installs without superuser) and a
--      contrib extension is not a service — the Postgres-only bar holds (D11).
--   2. project_id is backfilled from documents→sources before NOT NULL is
--      applied (drizzle-kit emitted a bare ADD COLUMN NOT NULL, which fails on
--      any populated table). Same backfill-then-tighten pattern as 0006's slug.
--   3. Operator note: adding a STORED generated column REWRITES the chunks
--      table under an ACCESS EXCLUSIVE lock. Fine at typical corpus sizes;
--      plan a maintenance window if chunks holds millions of rows.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE TEXT SEARCH CONFIGURATION "deskbell_search" (COPY = simple);--> statement-breakpoint
ALTER TEXT SEARCH CONFIGURATION "deskbell_search"
  ALTER MAPPING FOR asciiword, asciihword, hword_asciipart, word, hword, hword_part
  WITH unaccent, simple;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "project_id" text;--> statement-breakpoint
UPDATE "chunks" c
  SET "project_id" = s."project_id"
  FROM "documents" d
  JOIN "sources" s ON s."id" = d."source_id"
  WHERE c."document_id" = d."id";--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "project_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "position" integer;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('deskbell_search', "content")) STORED;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_org_project_idx" ON "chunks" USING btree ("org_id","project_id");--> statement-breakpoint
CREATE INDEX "chunks_search_tsv_idx" ON "chunks" USING gin ("search_tsv");
