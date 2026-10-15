-- Competências e Desenvolvimento (Gestão de pessoas).
-- Aditivo: só cria tabelas novas. Não altera colunas nem dados de Employee/HrDepartment.
-- Postos de trabalho são entidades próprias (não substituem o cargo `Role`); setor = HrDepartment.
-- Avaliação de competências é separada de HrEmployeeEvaluation (experiência por template).
-- Inclui a trilha da importação assistida por planilha (HrCompetencyImportBatch).
-- Inclui a governança de níveis (competência crítica, versão e HrCompetencyLevelRequest).
-- CreateTable
CREATE TABLE "HrCompetency" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "requiresRecycling" BOOLEAN NOT NULL DEFAULT false,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrCompetency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrWorkPosition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "departmentId" UUID,
    "shiftPattern" TEXT NOT NULL DEFAULT 'ONE_SHIFT',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdByUserId" UUID,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrWorkPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrWorkPositionRequirement" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "positionId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "minLevel" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrWorkPositionRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEmployeeWorkPosition" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "positionId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(6),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrEmployeeWorkPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEmployeeCompetencyLevel" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "assessedAt" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrEmployeeCompetencyLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrEmployeeCompetencyLevelHistory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "previousLevel" INTEGER NOT NULL,
    "newLevel" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "assessmentId" UUID,
    "importBatchId" UUID,
    "requestId" UUID,
    "actorUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrEmployeeCompetencyLevelHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrCompetencyAssessment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "evaluatorEmployeeId" UUID,
    "evaluatorNameSnapshot" TEXT,
    "positionId" UUID,
    "positionNameSnapshot" TEXT,
    "assessmentDate" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "averageLevel" DECIMAL(4,2),
    "completedAt" TIMESTAMPTZ(6),
    "createdByUserId" UUID,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrCompetencyAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrCompetencyAssessmentItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assessmentId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "requiredLevel" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrCompetencyAssessmentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTraining" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "competencyId" UUID NOT NULL,
    "modality" TEXT NOT NULL,
    "workloadHours" INTEGER NOT NULL,
    "startDate" TIMESTAMPTZ(6) NOT NULL,
    "validityMonths" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "completedAt" TIMESTAMPTZ(6),
    "createdByUserId" UUID,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrTraining_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrTrainingParticipant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trainingId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrTrainingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrCompetencyImportBatch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "changedCount" INTEGER NOT NULL,
    "conflictAppliedCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB,
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrCompetencyImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HrCompetencyLevelRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "competencyId" UUID NOT NULL,
    "fromLevel" INTEGER NOT NULL,
    "toLevel" INTEGER NOT NULL,
    "baseVersion" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "importBatchId" UUID,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" UUID,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrCompetencyLevelRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HrCompetency_status_sortOrder_idx" ON "HrCompetency"("status", "sortOrder");

-- CreateIndex
CREATE INDEX "HrWorkPosition_status_idx" ON "HrWorkPosition"("status");

-- CreateIndex
CREATE INDEX "HrWorkPosition_departmentId_idx" ON "HrWorkPosition"("departmentId");

-- CreateIndex
CREATE INDEX "HrWorkPositionRequirement_competencyId_idx" ON "HrWorkPositionRequirement"("competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "HrWorkPositionRequirement_positionId_competencyId_key" ON "HrWorkPositionRequirement"("positionId", "competencyId");

-- CreateIndex
CREATE INDEX "HrEmployeeWorkPosition_employeeId_startedAt_idx" ON "HrEmployeeWorkPosition"("employeeId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "HrEmployeeWorkPosition_positionId_idx" ON "HrEmployeeWorkPosition"("positionId");

-- CreateIndex
CREATE INDEX "HrEmployeeCompetencyLevel_competencyId_idx" ON "HrEmployeeCompetencyLevel"("competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "HrEmployeeCompetencyLevel_employeeId_competencyId_key" ON "HrEmployeeCompetencyLevel"("employeeId", "competencyId");

-- CreateIndex
CREATE INDEX "HrEmployeeCompetencyLevelHistory_employeeId_createdAt_idx" ON "HrEmployeeCompetencyLevelHistory"("employeeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "HrEmployeeCompetencyLevelHistory_competencyId_idx" ON "HrEmployeeCompetencyLevelHistory"("competencyId");

-- CreateIndex
CREATE INDEX "HrCompetencyAssessment_employeeId_assessmentDate_idx" ON "HrCompetencyAssessment"("employeeId", "assessmentDate" DESC);

-- CreateIndex
CREATE INDEX "HrCompetencyAssessment_status_idx" ON "HrCompetencyAssessment"("status");

-- CreateIndex
CREATE INDEX "HrCompetencyAssessmentItem_competencyId_idx" ON "HrCompetencyAssessmentItem"("competencyId");

-- CreateIndex
CREATE UNIQUE INDEX "HrCompetencyAssessmentItem_assessmentId_competencyId_key" ON "HrCompetencyAssessmentItem"("assessmentId", "competencyId");

-- CreateIndex
CREATE INDEX "HrTraining_competencyId_idx" ON "HrTraining"("competencyId");

-- CreateIndex
CREATE INDEX "HrTraining_status_startDate_idx" ON "HrTraining"("status", "startDate");

-- CreateIndex
CREATE INDEX "HrTrainingParticipant_employeeId_idx" ON "HrTrainingParticipant"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "HrTrainingParticipant_trainingId_employeeId_key" ON "HrTrainingParticipant"("trainingId", "employeeId");

-- CreateIndex
CREATE INDEX "HrCompetencyImportBatch_fileSha256_idx" ON "HrCompetencyImportBatch"("fileSha256");

-- CreateIndex
CREATE INDEX "HrCompetencyImportBatch_createdAt_idx" ON "HrCompetencyImportBatch"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "HrCompetencyLevelRequest_status_createdAt_idx" ON "HrCompetencyLevelRequest"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "HrCompetencyLevelRequest_employeeId_idx" ON "HrCompetencyLevelRequest"("employeeId");

-- AddForeignKey
ALTER TABLE "HrWorkPosition" ADD CONSTRAINT "HrWorkPosition_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "HrDepartment"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrWorkPositionRequirement" ADD CONSTRAINT "HrWorkPositionRequirement_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "HrWorkPosition"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrWorkPositionRequirement" ADD CONSTRAINT "HrWorkPositionRequirement_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "HrCompetency"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrEmployeeWorkPosition" ADD CONSTRAINT "HrEmployeeWorkPosition_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrEmployeeWorkPosition" ADD CONSTRAINT "HrEmployeeWorkPosition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "HrWorkPosition"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrEmployeeCompetencyLevel" ADD CONSTRAINT "HrEmployeeCompetencyLevel_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrEmployeeCompetencyLevel" ADD CONSTRAINT "HrEmployeeCompetencyLevel_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "HrCompetency"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrEmployeeCompetencyLevelHistory" ADD CONSTRAINT "HrEmployeeCompetencyLevelHistory_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrEmployeeCompetencyLevelHistory" ADD CONSTRAINT "HrEmployeeCompetencyLevelHistory_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "HrCompetency"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrEmployeeCompetencyLevelHistory" ADD CONSTRAINT "HrEmployeeCompetencyLevelHistory_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "HrCompetencyAssessment"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrEmployeeCompetencyLevelHistory" ADD CONSTRAINT "HrEmployeeCompetencyLevelHistory_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "HrCompetencyImportBatch"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrEmployeeCompetencyLevelHistory" ADD CONSTRAINT "HrEmployeeCompetencyLevelHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "HrCompetencyLevelRequest"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrCompetencyAssessment" ADD CONSTRAINT "HrCompetencyAssessment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrCompetencyAssessment" ADD CONSTRAINT "HrCompetencyAssessment_evaluatorEmployeeId_fkey" FOREIGN KEY ("evaluatorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrCompetencyAssessment" ADD CONSTRAINT "HrCompetencyAssessment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "HrWorkPosition"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrCompetencyAssessmentItem" ADD CONSTRAINT "HrCompetencyAssessmentItem_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "HrCompetencyAssessment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrCompetencyAssessmentItem" ADD CONSTRAINT "HrCompetencyAssessmentItem_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "HrCompetency"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrTraining" ADD CONSTRAINT "HrTraining_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "HrCompetency"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrTrainingParticipant" ADD CONSTRAINT "HrTrainingParticipant_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "HrTraining"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrTrainingParticipant" ADD CONSTRAINT "HrTrainingParticipant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrCompetencyLevelRequest" ADD CONSTRAINT "HrCompetencyLevelRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrCompetencyLevelRequest" ADD CONSTRAINT "HrCompetencyLevelRequest_competencyId_fkey" FOREIGN KEY ("competencyId") REFERENCES "HrCompetency"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "HrCompetencyLevelRequest" ADD CONSTRAINT "HrCompetencyLevelRequest_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "HrCompetencyImportBatch"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- Índices parciais e checks escritos à mão (Prisma não expressa).
-- Nome de competência único (sem diferenciar maiúsculas) entre as ativas.
CREATE UNIQUE INDEX "HrCompetency_name_active_uidx"
  ON "HrCompetency"(lower("name")) WHERE "status" = 'ACTIVE';

-- No máximo uma alocação ativa por colaborador.
CREATE UNIQUE INDEX "HrEmployeeWorkPosition_employee_active_uidx"
  ON "HrEmployeeWorkPosition"("employeeId") WHERE "endedAt" IS NULL;

-- No máximo uma solicitação de nível pendente por colaborador + competência.
CREATE UNIQUE INDEX "HrCompetencyLevelRequest_pending_uidx"
  ON "HrCompetencyLevelRequest"("employeeId", "competencyId") WHERE "status" = 'PENDING';

ALTER TABLE "HrWorkPositionRequirement"
  ADD CONSTRAINT "HrWorkPositionRequirement_minLevel_check" CHECK ("minLevel" BETWEEN 1 AND 4);

ALTER TABLE "HrEmployeeCompetencyLevel"
  ADD CONSTRAINT "HrEmployeeCompetencyLevel_level_check" CHECK ("level" BETWEEN 0 AND 4);

ALTER TABLE "HrCompetencyAssessmentItem"
  ADD CONSTRAINT "HrCompetencyAssessmentItem_level_check" CHECK ("level" BETWEEN 1 AND 4);

ALTER TABLE "HrTraining"
  ADD CONSTRAINT "HrTraining_workload_validity_check" CHECK ("workloadHours" >= 0 AND "validityMonths" >= 0);

ALTER TABLE "HrCompetencyLevelRequest"
  ADD CONSTRAINT "HrCompetencyLevelRequest_levels_check" CHECK ("fromLevel" BETWEEN 0 AND 4 AND "toLevel" BETWEEN 0 AND 4);
