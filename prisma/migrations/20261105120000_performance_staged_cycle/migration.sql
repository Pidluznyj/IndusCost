-- Desempenho e Cultura: fluxo por etapas (calendário de etapas no ciclo + plano de calibração/devolutiva do líder).
-- Aditiva: colunas opcionais e tabela nova. Ciclos existentes ficam com o calendário NULL (comportamento anterior).

-- AlterTable
ALTER TABLE "HrPerformanceCycle" ADD COLUMN     "calibrationDueAt" TEXT,
ADD COLUMN     "calibrationStartAt" TEXT,
ADD COLUMN     "leaderStartAt" TEXT,
ADD COLUMN     "leadershipDueAt" TEXT,
ADD COLUMN     "leadershipStartAt" TEXT,
ADD COLUMN     "selfStartAt" TEXT;

-- CreateTable
CREATE TABLE "HrPerformanceFollowUpPlan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycleId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "leaderEmployeeId" UUID NOT NULL,
    "proposalDecision" TEXT,
    "proposalNineX" TEXT,
    "proposalNineY" TEXT,
    "proposalNote" TEXT,
    "proposedAt" TIMESTAMPTZ(6),
    "meetingAt" TEXT,
    "meetingPlace" TEXT,
    "draftStrength" TEXT,
    "draftImprovement" TEXT,
    "draftAction" TEXT,
    "draftPdiTitle" TEXT,
    "draftPdiObjective" TEXT,
    "draftPdiDueAt" TEXT,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrPerformanceFollowUpPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrPerformanceFollowUpPlan_participantId_key" ON "HrPerformanceFollowUpPlan"("participantId");

-- CreateIndex
CREATE INDEX "HrPerformanceFollowUpPlan_cycleId_idx" ON "HrPerformanceFollowUpPlan"("cycleId");

-- CreateIndex
CREATE INDEX "HrPerformanceFollowUpPlan_leaderEmployeeId_idx" ON "HrPerformanceFollowUpPlan"("leaderEmployeeId");

-- AddForeignKey
ALTER TABLE "HrPerformanceFollowUpPlan" ADD CONSTRAINT "HrPerformanceFollowUpPlan_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "HrPerformanceParticipant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

