-- AlterEnum
ALTER TYPE "MediaStatus" ADD VALUE 'PROCESSING';

-- DropIndex
DROP INDEX "UploadSession_videoId_idx";

-- AlterTable
ALTER TABLE "WatchEvent"
ADD COLUMN "watchedSeconds" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "WatchProgress"
ADD COLUMN "maxProgressPercent" INTEGER NOT NULL DEFAULT 0;

-- AddCheckConstraint
ALTER TABLE "Video"
ADD CONSTRAINT "Video_byteSize_nonnegative_check" CHECK ("byteSize" >= 0);

ALTER TABLE "Video"
ADD CONSTRAINT "Video_durationMs_nonnegative_check"
CHECK ("durationMs" IS NULL OR "durationMs" >= 0);

ALTER TABLE "UploadSession"
ADD CONSTRAINT "UploadSession_reservedBytes_nonnegative_check"
CHECK ("reservedBytes" >= 0);

ALTER TABLE "StorageQuota"
ADD CONSTRAINT "StorageQuota_maxBytes_nonnegative_check" CHECK ("maxBytes" >= 0);

ALTER TABLE "StorageQuota"
ADD CONSTRAINT "StorageQuota_usedBytes_nonnegative_check" CHECK ("usedBytes" >= 0);

ALTER TABLE "StorageQuota"
ADD CONSTRAINT "StorageQuota_reservedBytes_nonnegative_check" CHECK ("reservedBytes" >= 0);

ALTER TABLE "StorageQuota"
ADD CONSTRAINT "StorageQuota_usage_within_max_check"
CHECK ("usedBytes" + "reservedBytes" <= "maxBytes");

ALTER TABLE "WatchProgress"
ADD CONSTRAINT "WatchProgress_positionMs_nonnegative_check" CHECK ("positionMs" >= 0);

ALTER TABLE "WatchProgress"
ADD CONSTRAINT "WatchProgress_maxProgressPercent_range_check"
CHECK ("maxProgressPercent" BETWEEN 0 AND 100);

ALTER TABLE "WatchEvent"
ADD CONSTRAINT "WatchEvent_positionMs_nonnegative_check"
CHECK ("positionMs" IS NULL OR "positionMs" >= 0);

ALTER TABLE "WatchEvent"
ADD CONSTRAINT "WatchEvent_watchedSeconds_range_check"
CHECK ("watchedSeconds" BETWEEN 0 AND 30);

-- Initialize the fixed quota row used by row-locked quota transactions.
INSERT INTO "StorageQuota" ("id", "maxBytes", "usedBytes", "reservedBytes", "updatedAt")
VALUES (1, 100000000000, 0, 0, CURRENT_TIMESTAMP);
