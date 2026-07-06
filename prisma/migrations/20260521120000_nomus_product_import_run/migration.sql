-- CreateEnum
CREATE TYPE "NomusProductImportRunStatus" AS ENUM ('PREVIEWED', 'IMPORTED', 'FAILED');

-- CreateTable
CREATE TABLE "NomusProductImportRun" (
    "id" TEXT NOT NULL,
    "parentCode" TEXT NOT NULL,
    "productId" UUID,
    "status" "NomusProductImportRunStatus" NOT NULL DEFAULT 'PREVIEWED',
    "planHash" TEXT NOT NULL,
    "confirmationText" TEXT,
    "approvedBy" TEXT,
    "summaryJson" JSONB,
    "warningsJson" JSONB,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3),

    CONSTRAINT "NomusProductImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NomusProductImportRunLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "componentCode" TEXT NOT NULL,
    "componentDescription" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NomusProductImportRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NomusProductImportRun_parentCode_idx" ON "NomusProductImportRun"("parentCode");

-- CreateIndex
CREATE INDEX "NomusProductImportRun_productId_idx" ON "NomusProductImportRun"("productId");

-- CreateIndex
CREATE INDEX "NomusProductImportRun_status_idx" ON "NomusProductImportRun"("status");

-- CreateIndex
CREATE INDEX "NomusProductImportRun_planHash_idx" ON "NomusProductImportRun"("planHash");

-- CreateIndex
CREATE INDEX "NomusProductImportRun_createdAt_idx" ON "NomusProductImportRun"("createdAt");

-- CreateIndex
CREATE INDEX "NomusProductImportRunLine_runId_idx" ON "NomusProductImportRunLine"("runId");

-- CreateIndex
CREATE INDEX "NomusProductImportRunLine_componentCode_idx" ON "NomusProductImportRunLine"("componentCode");

-- CreateIndex
CREATE INDEX "NomusProductImportRunLine_actionType_idx" ON "NomusProductImportRunLine"("actionType");

-- AddForeignKey
ALTER TABLE "NomusProductImportRunLine" ADD CONSTRAINT "NomusProductImportRunLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "NomusProductImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
