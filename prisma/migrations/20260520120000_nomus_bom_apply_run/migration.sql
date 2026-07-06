-- CreateEnum
CREATE TYPE "NomusBomApplyRunStatus" AS ENUM ('PREVIEWED', 'APPLIED', 'FAILED');

-- CreateEnum
CREATE TYPE "NomusBomApplyRunLineStatus" AS ENUM ('PLANNED', 'APPLIED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "NomusBomApplyRun" (
    "id" TEXT NOT NULL,
    "parentCode" TEXT NOT NULL,
    "productId" UUID NOT NULL,
    "status" "NomusBomApplyRunStatus" NOT NULL DEFAULT 'PREVIEWED',
    "planHash" TEXT NOT NULL,
    "effectiveBomHash" TEXT NOT NULL,
    "approvedBy" TEXT,
    "confirmationText" TEXT,
    "beforeBomJson" JSONB,
    "afterBomJson" JSONB,
    "summaryJson" JSONB,
    "warningsJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "NomusBomApplyRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NomusBomApplyRunLine" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "componentCode" TEXT NOT NULL,
    "componentDescription" TEXT,
    "productBomLineId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "status" "NomusBomApplyRunLineStatus" NOT NULL DEFAULT 'PLANNED',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NomusBomApplyRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NomusBomApplyRun_parentCode_idx" ON "NomusBomApplyRun"("parentCode");

-- CreateIndex
CREATE INDEX "NomusBomApplyRun_productId_idx" ON "NomusBomApplyRun"("productId");

-- CreateIndex
CREATE INDEX "NomusBomApplyRun_status_idx" ON "NomusBomApplyRun"("status");

-- CreateIndex
CREATE INDEX "NomusBomApplyRun_planHash_idx" ON "NomusBomApplyRun"("planHash");

-- CreateIndex
CREATE INDEX "NomusBomApplyRun_createdAt_idx" ON "NomusBomApplyRun"("createdAt");

-- CreateIndex
CREATE INDEX "NomusBomApplyRunLine_runId_idx" ON "NomusBomApplyRunLine"("runId");

-- CreateIndex
CREATE INDEX "NomusBomApplyRunLine_componentCode_idx" ON "NomusBomApplyRunLine"("componentCode");

-- CreateIndex
CREATE INDEX "NomusBomApplyRunLine_actionType_idx" ON "NomusBomApplyRunLine"("actionType");

-- AddForeignKey
ALTER TABLE "NomusBomApplyRunLine" ADD CONSTRAINT "NomusBomApplyRunLine_runId_fkey" FOREIGN KEY ("runId") REFERENCES "NomusBomApplyRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
