-- Módulo de Metas (OKR & Goal Engine) — MVP 1 (docs/goal-engine-plan.md).
-- Tabelas novas; zero impacto no legado.

CREATE TYPE "GoalStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DONE', 'ARCHIVED');
CREATE TYPE "GoalKeyResultTrackingType" AS ENUM ('INCREASE', 'DECREASE');
CREATE TYPE "GoalDomain" AS ENUM ('COMERCIAL', 'PRODUCAO', 'FINANCEIRO', 'SUPRIMENTOS', 'PESSOAS', 'OUTROS');

CREATE TABLE "Goal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "description" TEXT,
  "startDate" TIMESTAMPTZ(6) NOT NULL,
  "endDate" TIMESTAMPTZ(6) NOT NULL,
  "status" "GoalStatus" NOT NULL DEFAULT 'DRAFT',
  "ownerAppUserId" UUID NOT NULL,
  "createdByUserId" UUID,
  "archivedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Goal"
  ADD CONSTRAINT "Goal_ownerAppUserId_fkey" FOREIGN KEY ("ownerAppUserId")
    REFERENCES "AppUser" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX "Goal_status_idx" ON "Goal" ("status");
CREATE INDEX "Goal_ownerAppUserId_idx" ON "Goal" ("ownerAppUserId");
CREATE INDEX "Goal_startDate_endDate_idx" ON "Goal" ("startDate", "endDate");

CREATE TABLE "GoalKeyResult" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "goalId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "domain" "GoalDomain" NOT NULL,
  "trackingType" "GoalKeyResultTrackingType" NOT NULL DEFAULT 'INCREASE',
  "baseline" DECIMAL(20,6) NOT NULL,
  "target" DECIMAL(20,6) NOT NULL,
  "achievedValue" DECIMAL(20,6) NOT NULL DEFAULT 0,
  "unit" TEXT,
  "weight" DECIMAL(10,4) NOT NULL DEFAULT 1,
  "ownerAppUserId" UUID NOT NULL,
  "manualTracking" BOOLEAN NOT NULL DEFAULT true,
  "ruleJson" JSONB,
  "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
  "archivedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoalKeyResult_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoalKeyResult_goalId_fkey" FOREIGN KEY ("goalId")
    REFERENCES "Goal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "GoalKeyResult_ownerAppUserId_fkey" FOREIGN KEY ("ownerAppUserId")
    REFERENCES "AppUser" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "GoalKeyResult_goalId_idx" ON "GoalKeyResult" ("goalId");
CREATE INDEX "GoalKeyResult_ownerAppUserId_idx" ON "GoalKeyResult" ("ownerAppUserId");
CREATE INDEX "GoalKeyResult_status_idx" ON "GoalKeyResult" ("status");
CREATE INDEX "GoalKeyResult_domain_idx" ON "GoalKeyResult" ("domain");

CREATE TABLE "GoalKeyResultSnapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "keyResultId" UUID NOT NULL,
  "snapshotDate" DATE NOT NULL,
  "achievedValue" DECIMAL(20,6) NOT NULL,
  "progressRatio" DECIMAL(8,6) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoalKeyResultSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoalKeyResultSnapshot_keyResultId_fkey" FOREIGN KEY ("keyResultId")
    REFERENCES "GoalKeyResult" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "GoalKeyResultSnapshot_keyResultId_snapshotDate_key"
  ON "GoalKeyResultSnapshot" ("keyResultId", "snapshotDate");
CREATE INDEX "GoalKeyResultSnapshot_snapshotDate_idx"
  ON "GoalKeyResultSnapshot" ("snapshotDate");
