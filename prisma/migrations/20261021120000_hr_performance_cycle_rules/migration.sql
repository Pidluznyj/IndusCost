-- Desempenho, Cultura e Potencial: regras versionadas no modelo, competência por pergunta,
-- remoção lógica de participante, motivos de revisão e revogação, histórico de calibração
-- e emissão de documentos. Só ADD COLUMN com default e CREATE TABLE. Nada é apagado.
-- Aplicar depois de 20261016180000_hr_performance_cycle e antes do código desta versão.

-- AlterTable
ALTER TABLE "HrPerformanceAssignment" ADD COLUMN     "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "returnReason" TEXT;

-- AlterTable
ALTER TABLE "HrPerformanceFeedback" ADD COLUMN     "acknowledgedByUserId" UUID,
ADD COLUMN     "acknowledgedVia" TEXT,
ADD COLUMN     "collaboratorNote" TEXT,
ADD COLUMN     "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdByUserId" UUID;

-- AlterTable
ALTER TABLE "HrPerformanceInvite" ADD COLUMN     "revokedReason" TEXT;

-- AlterTable
ALTER TABLE "HrPerformanceModel" ADD COLUMN     "archivedAt" TIMESTAMPTZ(6),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "instructions" TEXT,
ADD COLUMN     "rules" JSONB;

-- AlterTable
ALTER TABLE "HrPerformanceParticipant" ADD COLUMN     "absenceInWindow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "addedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "eligibilityException" TEXT,
ADD COLUMN     "employeeStatus" TEXT,
ADD COLUMN     "managerSource" TEXT NOT NULL DEFAULT 'CADASTRO',
ADD COLUMN     "removedAt" TIMESTAMPTZ(6),
ADD COLUMN     "removedReason" TEXT,
ADD COLUMN     "roleChangedInWindow" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "HrPerformancePdi" ADD COLUMN     "competencyCode" TEXT,
ADD COLUMN     "completedAt" TIMESTAMPTZ(6),
ADD COLUMN     "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "evidence" TEXT,
ADD COLUMN     "objective" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "HrPerformanceQuestion" ADD COLUMN     "competency" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "negativeExample" TEXT,
ADD COLUMN     "positiveExample" TEXT,
ADD COLUMN     "roleExamples" JSONB;

-- AlterTable
ALTER TABLE "HrPerformanceResult" ADD COLUMN     "adjusted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "calibratedAt" TIMESTAMPTZ(6),
ADD COLUMN     "calibratedByUserId" UUID,
ADD COLUMN     "calibrationNote" TEXT,
ADD COLUMN     "ruleSnapshot" JSONB;

-- AlterTable
ALTER TABLE "HrPerformanceSession" ADD COLUMN     "assistReason" TEXT;

-- CreateTable
CREATE TABLE "HrPerformanceReportIssue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "cycleId" UUID NOT NULL,
    "participantId" UUID,
    "version" INTEGER NOT NULL,
    "issuedByUserId" UUID,
    "issuedByName" TEXT,
    "issuedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "HrPerformanceReportIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HrPerformanceReportIssue_code_key" ON "HrPerformanceReportIssue"("code");

-- CreateIndex
CREATE INDEX "HrPerformanceReportIssue_cycleId_kind_idx" ON "HrPerformanceReportIssue"("cycleId", "kind");

-- AddForeignKey
ALTER TABLE "HrPerformanceReportIssue" ADD CONSTRAINT "HrPerformanceReportIssue_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "HrPerformanceCycle"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

