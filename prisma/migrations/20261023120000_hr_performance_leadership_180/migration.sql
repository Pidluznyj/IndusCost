-- Desempenho, Cultura e Potencial: Avaliação 180° de liderança (LD-01..LD-08).
-- Só ADD COLUMN com default, CREATE TABLE, índices e chaves estrangeiras novas. Nada existente é
-- reescrito: modelos atuais ficam INDIVIDUAL, ciclos atuais sem liderança (leadershipModelId nulo),
-- participantes atuais isLeader = false. Aplicar depois de 20261022120000 e antes do código.

-- AlterTable
ALTER TABLE "HrPerformanceAssignment" ADD COLUMN     "modelId" UUID,
ADD COLUMN     "subjectParticipantId" UUID;

-- AlterTable
ALTER TABLE "HrPerformanceCycle" ADD COLUMN     "leadershipModelId" UUID;

-- AlterTable
ALTER TABLE "HrPerformanceModel" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'INDIVIDUAL';

-- AlterTable
ALTER TABLE "HrPerformanceParticipant" ADD COLUMN     "directReportCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isLeader" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leadershipSnapshotAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "HrPerformanceQuestion" ADD COLUMN     "upwardText" TEXT;

-- CreateTable
CREATE TABLE "HrPerformanceLeadershipResult" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participantId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "justifications" JSONB NOT NULL,
    "generalNote" TEXT NOT NULL,
    "exceptionReason" TEXT,
    "sources" JSONB NOT NULL,
    "teamRespondents" INTEGER NOT NULL DEFAULT 0,
    "teamDisclosed" BOOLEAN NOT NULL DEFAULT false,
    "official" BOOLEAN NOT NULL DEFAULT false,
    "modelId" UUID NOT NULL,
    "modelVersion" INTEGER NOT NULL,
    "calibratedByUserId" UUID,
    "calibratedAt" TIMESTAMPTZ(6) NOT NULL,
    "supersedesId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrPerformanceLeadershipResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrPerformanceLeadershipResult_participantId_active_idx" ON "HrPerformanceLeadershipResult"("participantId", "active");

-- CreateIndex
CREATE INDEX "HrPerformanceLeadershipResult_cycleId_idx" ON "HrPerformanceLeadershipResult"("cycleId");

-- CreateIndex
CREATE INDEX "HrPerformanceAssignment_subjectParticipantId_kind_idx" ON "HrPerformanceAssignment"("subjectParticipantId", "kind");

-- AddForeignKey
ALTER TABLE "HrPerformanceCycle" ADD CONSTRAINT "HrPerformanceCycle_leadershipModelId_fkey" FOREIGN KEY ("leadershipModelId") REFERENCES "HrPerformanceModel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrPerformanceAssignment" ADD CONSTRAINT "HrPerformanceAssignment_subjectParticipantId_fkey" FOREIGN KEY ("subjectParticipantId") REFERENCES "HrPerformanceParticipant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrPerformanceAssignment" ADD CONSTRAINT "HrPerformanceAssignment_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "HrPerformanceModel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrPerformanceLeadershipResult" ADD CONSTRAINT "HrPerformanceLeadershipResult_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "HrPerformanceParticipant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- Uma calibração de liderança ativa por pessoa (versões anteriores ficam inativas).
CREATE UNIQUE INDEX "HrPerformanceLeadershipResult_active_uidx" ON "HrPerformanceLeadershipResult"("participantId") WHERE "active" = true;
