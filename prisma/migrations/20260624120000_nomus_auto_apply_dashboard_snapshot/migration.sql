-- Snapshot/job da revalidação read-only do painel auto-apply BOM Nomus.
CREATE TABLE "NomusAutoApplyDashboardSnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(6),
    "generatedAt" TIMESTAMPTZ(6),
    "totalProducts" INTEGER NOT NULL DEFAULT 0,
    "eligibleProducts" INTEGER NOT NULL DEFAULT 0,
    "processedProducts" INTEGER NOT NULL DEFAULT 0,
    "revalidatedProductCount" INTEGER NOT NULL DEFAULT 0,
    "revalidationErrorCount" INTEGER NOT NULL DEFAULT 0,
    "currentParentCode" TEXT,
    "resultJson" JSONB,
    "errorMessage" TEXT,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NomusAutoApplyDashboardSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NomusAutoApplyDashboardSnapshot_status_idx" ON "NomusAutoApplyDashboardSnapshot"("status");

CREATE INDEX "NomusAutoApplyDashboardSnapshot_startedAt_idx" ON "NomusAutoApplyDashboardSnapshot"("startedAt");

CREATE INDEX "NomusAutoApplyDashboardSnapshot_generatedAt_idx" ON "NomusAutoApplyDashboardSnapshot"("generatedAt");
