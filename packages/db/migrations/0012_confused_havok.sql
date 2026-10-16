ALTER TABLE "gap_clusters" ADD COLUMN "correction_document_id" text;--> statement-breakpoint
ALTER TABLE "gap_clusters" ADD CONSTRAINT "gap_clusters_correction_document_id_documents_id_fk" FOREIGN KEY ("correction_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gap_clusters_correction_document_idx" ON "gap_clusters" USING btree ("correction_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_project_corrections_idx" ON "sources" USING btree ("project_id") WHERE type = 'corrections';