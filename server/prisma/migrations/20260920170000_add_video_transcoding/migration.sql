ALTER TABLE "Video"
  ADD COLUMN "processingStage" TEXT,
  ADD COLUMN "processingProgress" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sourceByteSize" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "sourceDeleteAfter" TIMESTAMPTZ(3),
  ADD COLUMN "sourceDeletedAt" TIMESTAMPTZ(3);

ALTER TABLE "Video"
  ADD CONSTRAINT "Video_processingProgress_range_check"
    CHECK ("processingProgress" >= 0 AND "processingProgress" <= 100),
  ADD CONSTRAINT "Video_sourceByteSize_nonnegative_check"
    CHECK ("sourceByteSize" >= 0);

CREATE INDEX "Video_status_processingStage_createdAt_idx"
  ON "Video"("status", "processingStage", "createdAt");
