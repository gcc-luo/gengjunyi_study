CREATE TABLE "ParentSetting" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentSetting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ParentSetting_adminUserId_key_key" ON "ParentSetting"("adminUserId", "key");
CREATE INDEX "ParentSetting_adminUserId_idx" ON "ParentSetting"("adminUserId");

ALTER TABLE "ParentSetting" ADD CONSTRAINT "ParentSetting_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "AdminUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
