-- CreateTable
CREATE TABLE "AccessProfile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "roleBase" "AppUserRole",
    "systemKey" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AccessProfile_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "AppUser" ADD COLUMN "accessProfileId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "AccessProfile_name_key" ON "AccessProfile"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AccessProfile_systemKey_key" ON "AccessProfile"("systemKey");

-- CreateIndex
CREATE INDEX "AccessProfile_isActive_idx" ON "AccessProfile"("isActive");

-- CreateIndex
CREATE INDEX "AccessProfile_isSystem_idx" ON "AccessProfile"("isSystem");

-- CreateIndex
CREATE INDEX "AppUser_accessProfileId_idx" ON "AppUser"("accessProfileId");

-- AddForeignKey
ALTER TABLE "AppUser" ADD CONSTRAINT "AppUser_accessProfileId_fkey" FOREIGN KEY ("accessProfileId") REFERENCES "AccessProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
