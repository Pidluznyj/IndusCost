-- Desempenho, Cultura e Potencial.
-- Aditivo: só cria tabelas novas. Não altera Employee, avaliação de experiência,
-- competência de posto, custo ou folha.
-- A migration não foi aplicada por este trabalho.

CREATE TABLE "HrPerformanceModel" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "lineageId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "governance" TEXT NOT NULL DEFAULT 'EM_VALIDACAO',
    "publishedAt" TIMESTAMPTZ(6),
    "createdByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrPerformanceModel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformanceQuestion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "modelId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "pillar" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "selfText" TEXT NOT NULL,
    "leaderText" TEXT NOT NULL,
    "hint" TEXT,
    CONSTRAINT "HrPerformanceQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformanceCycle" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "modelId" UUID NOT NULL,
    "selfDueAt" TEXT NOT NULL,
    "leaderDueAt" TEXT NOT NULL,
    "ownerUserId" UUID,
    "minObservationDays" INTEGER NOT NULL,
    "openedAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrPerformanceCycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformanceParticipant" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycleId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "employeeName" TEXT NOT NULL,
    "eligibility" TEXT NOT NULL,
    "eligibilityReason" TEXT NOT NULL,
    "roleId" UUID NOT NULL,
    "roleName" TEXT NOT NULL,
    "departmentId" UUID,
    "departmentName" TEXT NOT NULL,
    "managerId" UUID,
    "managerName" TEXT,
    "admissionDate" TIMESTAMPTZ(6),
    "registration" TEXT,
    "frozen" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "HrPerformanceParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformanceAssignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participantId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "evaluatorEmployeeId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "submittedAt" TIMESTAMPTZ(6),
    "assistedByUserId" UUID,
    CONSTRAINT "HrPerformanceAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformanceAnswer" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assignmentId" UUID NOT NULL,
    "questionCode" TEXT NOT NULL,
    "pillar" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "score" INTEGER,
    "evidence" TEXT,
    CONSTRAINT "HrPerformanceAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformanceInvite" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assignmentId" UUID NOT NULL,
    "linkDigest" TEXT NOT NULL,
    "otpDigest" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrPerformanceInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformanceSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inviteId" UUID,
    "assignmentId" UUID NOT NULL,
    "phase" TEXT NOT NULL,
    "sessionDigest" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "assistantUserId" UUID,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "HrPerformanceSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformanceResult" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participantId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "technicalSum" INTEGER NOT NULL,
    "technicalCount" INTEGER NOT NULL,
    "cultureSum" INTEGER NOT NULL,
    "cultureCount" INTEGER NOT NULL,
    "potentialSum" INTEGER NOT NULL,
    "potentialCount" INTEGER NOT NULL,
    "technicalValidation" TEXT NOT NULL,
    "validationNote" TEXT,
    "cultureBand" TEXT NOT NULL,
    "cultureBasis" TEXT NOT NULL,
    "quadrant" TEXT NOT NULL,
    "nineBoxReason" TEXT NOT NULL,
    "nineX" TEXT,
    "nineY" TEXT,
    "official" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" TEXT NOT NULL,
    "algorithmId" TEXT NOT NULL,
    "nineBoxRuleId" TEXT NOT NULL,
    "cultureRuleId" TEXT NOT NULL,
    "supersedesId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrPerformanceResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformanceFeedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participantId" UUID NOT NULL,
    "resultId" UUID NOT NULL,
    "strength" TEXT NOT NULL,
    "improvement" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "dueAt" TEXT,
    "conversationAt" TEXT,
    "leaderEmployeeId" UUID NOT NULL,
    "viewedAt" TIMESTAMPTZ(6),
    "acknowledgedAt" TIMESTAMPTZ(6),
    "agreedAt" TIMESTAMPTZ(6),
    "contestation" TEXT,
    "internalNotes" TEXT,
    CONSTRAINT "HrPerformanceFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformancePdi" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "participantId" UUID NOT NULL,
    "feedbackId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "priority" BOOLEAN NOT NULL,
    "justification" TEXT,
    "ownerName" TEXT NOT NULL,
    "dueAt" TEXT,
    "status" TEXT NOT NULL,
    CONSTRAINT "HrPerformancePdi_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformancePdiCheckin" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pdiId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "obstacle" TEXT,
    "nextStep" TEXT,
    "authorUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "HrPerformancePdiCheckin_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformanceConductCase" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "employeeId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "proven" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HrPerformanceConductCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformanceAuditEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "at" TIMESTAMPTZ(6) NOT NULL,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "detail" JSONB NOT NULL,
    CONSTRAINT "HrPerformanceAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrPerformanceReminder" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cycleId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "audience" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    CONSTRAINT "HrPerformanceReminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrPerformanceQuestion_modelId_code_key" ON "HrPerformanceQuestion"("modelId", "code");
CREATE UNIQUE INDEX "HrPerformanceParticipant_cycleId_employeeId_key" ON "HrPerformanceParticipant"("cycleId", "employeeId");
CREATE UNIQUE INDEX "HrPerformanceAssignment_active_kind_uidx" ON "HrPerformanceAssignment"("participantId", "kind") WHERE "active" = true;
CREATE UNIQUE INDEX "HrPerformanceAnswer_assignmentId_questionCode_key" ON "HrPerformanceAnswer"("assignmentId", "questionCode");
CREATE UNIQUE INDEX "HrPerformanceInvite_linkDigest_key" ON "HrPerformanceInvite"("linkDigest");
CREATE UNIQUE INDEX "HrPerformanceSession_sessionDigest_key" ON "HrPerformanceSession"("sessionDigest");

CREATE INDEX "HrPerformanceModel_lineageId_version_idx" ON "HrPerformanceModel"("lineageId", "version");
CREATE INDEX "HrPerformanceModel_status_idx" ON "HrPerformanceModel"("status");
CREATE INDEX "HrPerformanceQuestion_modelId_sortOrder_idx" ON "HrPerformanceQuestion"("modelId", "sortOrder");
CREATE INDEX "HrPerformanceCycle_status_idx" ON "HrPerformanceCycle"("status");
CREATE INDEX "HrPerformanceCycle_modelId_idx" ON "HrPerformanceCycle"("modelId");
CREATE INDEX "HrPerformanceParticipant_employeeId_idx" ON "HrPerformanceParticipant"("employeeId");
CREATE INDEX "HrPerformanceAssignment_cycleId_kind_active_idx" ON "HrPerformanceAssignment"("cycleId", "kind", "active");
CREATE INDEX "HrPerformanceAssignment_evaluatorEmployeeId_idx" ON "HrPerformanceAssignment"("evaluatorEmployeeId");
CREATE INDEX "HrPerformanceAssignment_employeeId_idx" ON "HrPerformanceAssignment"("employeeId");
CREATE INDEX "HrPerformanceInvite_assignmentId_idx" ON "HrPerformanceInvite"("assignmentId");
CREATE INDEX "HrPerformanceSession_assignmentId_idx" ON "HrPerformanceSession"("assignmentId");
CREATE INDEX "HrPerformanceResult_participantId_active_idx" ON "HrPerformanceResult"("participantId", "active");
CREATE INDEX "HrPerformanceFeedback_participantId_idx" ON "HrPerformanceFeedback"("participantId");
CREATE INDEX "HrPerformancePdi_participantId_status_idx" ON "HrPerformancePdi"("participantId", "status");
CREATE INDEX "HrPerformancePdiCheckin_pdiId_createdAt_idx" ON "HrPerformancePdiCheckin"("pdiId", "createdAt");
CREATE INDEX "HrPerformanceConductCase_employeeId_status_idx" ON "HrPerformanceConductCase"("employeeId", "status");
CREATE INDEX "HrPerformanceAuditEvent_entityId_at_idx" ON "HrPerformanceAuditEvent"("entityId", "at");
CREATE INDEX "HrPerformanceAuditEvent_action_at_idx" ON "HrPerformanceAuditEvent"("action", "at");
CREATE INDEX "HrPerformanceReminder_cycleId_status_idx" ON "HrPerformanceReminder"("cycleId", "status");

ALTER TABLE "HrPerformanceQuestion" ADD CONSTRAINT "HrPerformanceQuestion_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "HrPerformanceModel"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "HrPerformanceCycle" ADD CONSTRAINT "HrPerformanceCycle_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "HrPerformanceModel"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "HrPerformanceParticipant" ADD CONSTRAINT "HrPerformanceParticipant_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "HrPerformanceCycle"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "HrPerformanceParticipant" ADD CONSTRAINT "HrPerformanceParticipant_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "HrPerformanceAssignment" ADD CONSTRAINT "HrPerformanceAssignment_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "HrPerformanceParticipant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "HrPerformanceAssignment" ADD CONSTRAINT "HrPerformanceAssignment_evaluatorEmployeeId_fkey" FOREIGN KEY ("evaluatorEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "HrPerformanceAnswer" ADD CONSTRAINT "HrPerformanceAnswer_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "HrPerformanceAssignment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "HrPerformanceInvite" ADD CONSTRAINT "HrPerformanceInvite_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "HrPerformanceAssignment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "HrPerformanceSession" ADD CONSTRAINT "HrPerformanceSession_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "HrPerformanceAssignment"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "HrPerformanceResult" ADD CONSTRAINT "HrPerformanceResult_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "HrPerformanceParticipant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "HrPerformanceFeedback" ADD CONSTRAINT "HrPerformanceFeedback_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "HrPerformanceParticipant"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "HrPerformancePdi" ADD CONSTRAINT "HrPerformancePdi_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES "HrPerformanceFeedback"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "HrPerformancePdiCheckin" ADD CONSTRAINT "HrPerformancePdiCheckin_pdiId_fkey" FOREIGN KEY ("pdiId") REFERENCES "HrPerformancePdi"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "HrPerformanceConductCase" ADD CONSTRAINT "HrPerformanceConductCase_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "HrPerformanceGraphLock" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "HrPerformanceGraphLock_pkey" PRIMARY KEY ("id")
);
