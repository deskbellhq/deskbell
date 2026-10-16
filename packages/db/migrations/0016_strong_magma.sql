ALTER TABLE "chunks" ADD COLUMN "vector_store" text;--> statement-breakpoint
-- Every install that exists keeps its vectors in pgvector: a chunk with a
-- vector is indexed there (spec: vector-store-single-home).
UPDATE "chunks" SET "vector_store" = 'pgvector' WHERE "embedding" IS NOT NULL;
