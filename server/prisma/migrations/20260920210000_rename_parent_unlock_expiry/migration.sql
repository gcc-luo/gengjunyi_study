ALTER TABLE "Session" RENAME COLUMN "parentUnlockedAt" TO "parentUnlockedUntil";
ALTER TABLE "Session"
  ALTER COLUMN "parentUnlockedUntil" TYPE TIMESTAMPTZ(3)
  USING "parentUnlockedUntil" AT TIME ZONE 'UTC';
