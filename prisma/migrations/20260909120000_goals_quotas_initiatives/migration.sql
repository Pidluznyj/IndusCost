-- Metas (OKR) — desdobramento (quotas) e planos de ação (iniciativas).
-- docs/goal-engine-plan.md — RN-006/RN-007, US-04/US-05.

CREATE TYPE "GoalInitiativeStatus" AS ENUM ('TODO', 'DOING', 'DONE');

CREATE TABLE "GoalKeyResultQuota" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "keyResultId" UUID NOT NULL,
  "assignedAppUserId" UUID NOT NULL,
  "quotaValue" DECIMAL(20,6) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoalKeyResultQuota_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoalKeyResultQuota_keyResultId_fkey" FOREIGN KEY ("keyResultId")
    REFERENCES "GoalKeyResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalKeyResultQuota_assignedAppUserId_fkey" FOREIGN KEY ("assignedAppUserId")
    REFERENCES "AppUser" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "GoalKeyResultQuota_keyResultId_assignedAppUserId_key"
  ON "GoalKeyResultQuota" ("keyResultId", "assignedAppUserId");
CREATE INDEX "GoalKeyResultQuota_assignedAppUserId_idx"
  ON "GoalKeyResultQuota" ("assignedAppUserId");

CREATE TABLE "GoalInitiative" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "goalId" UUID,
  "keyResultId" UUID,
  "title" TEXT NOT NULL,
  "status" "GoalInitiativeStatus" NOT NULL DEFAULT 'TODO',
  "assigneeAppUserId" UUID,
  "dueDate" TIMESTAMPTZ(6),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoalInitiative_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoalInitiative_goalId_fkey" FOREIGN KEY ("goalId")
    REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalInitiative_keyResultId_fkey" FOREIGN KEY ("keyResultId")
    REFERENCES "GoalKeyResult" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GoalInitiative_assigneeAppUserId_fkey" FOREIGN KEY ("assigneeAppUserId")
    REFERENCES "AppUser" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "GoalInitiative_goalId_idx" ON "GoalInitiative" ("goalId");
CREATE INDEX "GoalInitiative_keyResultId_idx" ON "GoalInitiative" ("keyResultId");
CREATE INDEX "GoalInitiative_status_idx" ON "GoalInitiative" ("status");
