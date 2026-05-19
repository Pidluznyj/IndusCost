-- CreateEnum
CREATE TYPE "NomusBomReviewDecisionType" AS ENUM (
  'PENDING',
  'INCLUDE_AS_LOCAL_EXCEPTION',
  'EXCLUDE_FROM_PRICING',
  'DUPLICATED_BY_NOMUS_COMPONENT',
  'OPERATIONAL_ROUTING_COST',
  'NEEDS_ENGINEERING_REVIEW'
);

-- CreateTable
CREATE TABLE "NomusBomReviewDecision" (
    "id" TEXT NOT NULL,
    "parentCode" TEXT NOT NULL,
    "parentProductId" UUID,
    "productBomLineId" TEXT,
    "componentCode" TEXT NOT NULL,
    "componentDescription" TEXT,
    "quantitySnapshot" DECIMAL(20,6),
    "decision" "NomusBomReviewDecisionType" NOT NULL DEFAULT 'PENDING',
    "includeForPricing" BOOLEAN NOT NULL DEFAULT false,
    "relatedNomusComponentCode" TEXT,
    "reason" TEXT,
    "notes" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusBomReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NomusBomReviewDecision_parentCode_idx" ON "NomusBomReviewDecision"("parentCode");

-- CreateIndex
CREATE INDEX "NomusBomReviewDecision_parentProductId_idx" ON "NomusBomReviewDecision"("parentProductId");

-- CreateIndex
CREATE INDEX "NomusBomReviewDecision_productBomLineId_idx" ON "NomusBomReviewDecision"("productBomLineId");

-- CreateIndex
CREATE INDEX "NomusBomReviewDecision_componentCode_idx" ON "NomusBomReviewDecision"("componentCode");

-- CreateIndex
CREATE INDEX "NomusBomReviewDecision_decision_idx" ON "NomusBomReviewDecision"("decision");

-- CreateIndex
CREATE INDEX "NomusBomReviewDecision_isActive_idx" ON "NomusBomReviewDecision"("isActive");
