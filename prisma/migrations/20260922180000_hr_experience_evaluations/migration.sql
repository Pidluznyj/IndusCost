-- Avaliações de RH (experiência 45 dias e final, modelo genérico por template).
-- Aditivo. Não altera dados de Employee além de uma coluna opcional em documento.
-- Employee não ganha data de término de experiência: esse marco fica na avaliação.

ALTER TABLE "HrEmployeeDocument"
  ADD COLUMN IF NOT EXISTS "evaluationId" UUID;

CREATE TABLE IF NOT EXISTS "HrEvaluationTemplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "evaluationType" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEvaluationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HrEvaluationTemplate_code_key"
  ON "HrEvaluationTemplate"("code");

CREATE INDEX IF NOT EXISTS "HrEvaluationTemplate_evaluationType_active_idx"
  ON "HrEvaluationTemplate"("evaluationType", "active");

CREATE TABLE IF NOT EXISTS "HrEvaluationCriterion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "templateId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'GERAL',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "allowNotApplicable" BOOLEAN NOT NULL DEFAULT true,
  "weight" DECIMAL(10, 4) NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEvaluationCriterion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HrEvaluationCriterion_templateId_code_key"
  ON "HrEvaluationCriterion"("templateId", "code");

CREATE INDEX IF NOT EXISTS "HrEvaluationCriterion_templateId_sortOrder_idx"
  ON "HrEvaluationCriterion"("templateId", "sortOrder");

CREATE TABLE IF NOT EXISTS "HrEmployeeEvaluation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId" UUID NOT NULL,
  "templateId" UUID NOT NULL,
  "templateVersion" INTEGER NOT NULL,
  "templateNameSnapshot" TEXT NOT NULL,
  "evaluationType" TEXT NOT NULL,
  "referenceCode" TEXT NOT NULL,
  "cycleKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "admissionDateSnapshot" TIMESTAMPTZ(6),
  "roleNameSnapshot" TEXT,
  "departmentSnapshot" TEXT,
  "registrationSnapshot" TEXT,
  "periodStart" TIMESTAMPTZ(6),
  "periodEnd" TIMESTAMPTZ(6),
  "dueDate" TIMESTAMPTZ(6),
  "evaluationDate" TIMESTAMPTZ(6),
  "evaluatorEmployeeId" UUID,
  "evaluatorNameSnapshot" TEXT,
  "evaluatorRoleSnapshot" TEXT,
  "managerIdSnapshot" UUID,
  "managerNameSnapshot" TEXT,
  "transcriptionUserId" UUID,
  "transcriptionAt" TIMESTAMPTZ(6),
  "completedAt" TIMESTAMPTZ(6),
  "printedAt" TIMESTAMPTZ(6),
  "printedByUserId" UUID,
  "generalScore" DECIMAL(10, 2),
  "recommendation" TEXT,
  "recommendationNotes" TEXT,
  "strengths" TEXT,
  "developmentPoints" TEXT,
  "actionGuidance" TEXT,
  "employeeAcknowledged" BOOLEAN NOT NULL DEFAULT false,
  "employeeAcknowledgedAt" TIMESTAMPTZ(6),
  "employeeAcknowledgementNotes" TEXT,
  "hrValidatedBy" UUID,
  "hrValidatedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID,
  "updatedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HrEmployeeEvaluation_referenceCode_key"
  ON "HrEmployeeEvaluation"("referenceCode");

CREATE UNIQUE INDEX IF NOT EXISTS "HrEmployeeEvaluation_open_cycle_uidx"
  ON "HrEmployeeEvaluation"("employeeId", "evaluationType", "cycleKey")
  WHERE "status" <> 'CANCELLED';

CREATE INDEX IF NOT EXISTS "HrEmployeeEvaluation_employeeId_idx"
  ON "HrEmployeeEvaluation"("employeeId");

CREATE INDEX IF NOT EXISTS "HrEmployeeEvaluation_templateId_idx"
  ON "HrEmployeeEvaluation"("templateId");

CREATE INDEX IF NOT EXISTS "HrEmployeeEvaluation_status_idx"
  ON "HrEmployeeEvaluation"("status");

CREATE INDEX IF NOT EXISTS "HrEmployeeEvaluation_dueDate_idx"
  ON "HrEmployeeEvaluation"("dueDate");

CREATE INDEX IF NOT EXISTS "HrEmployeeEvaluation_evaluationType_idx"
  ON "HrEmployeeEvaluation"("evaluationType");

CREATE INDEX IF NOT EXISTS "HrEmployeeEvaluation_employeeId_evaluationType_idx"
  ON "HrEmployeeEvaluation"("employeeId", "evaluationType");

CREATE TABLE IF NOT EXISTS "HrEmployeeEvaluationAnswer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "evaluationId" UUID NOT NULL,
  "criterionId" UUID NOT NULL,
  "criterionCodeSnapshot" TEXT NOT NULL,
  "criterionNameSnapshot" TEXT NOT NULL,
  "criterionCategorySnapshot" TEXT,
  "sortOrderSnapshot" INTEGER NOT NULL DEFAULT 0,
  "allowNotApplicableSnapshot" BOOLEAN NOT NULL DEFAULT true,
  "score" INTEGER,
  "notApplicable" BOOLEAN NOT NULL DEFAULT false,
  "comment" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeEvaluationAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HrEmployeeEvaluationAnswer_evaluationId_criterionId_key"
  ON "HrEmployeeEvaluationAnswer"("evaluationId", "criterionId");

CREATE INDEX IF NOT EXISTS "HrEmployeeEvaluationAnswer_evaluationId_idx"
  ON "HrEmployeeEvaluationAnswer"("evaluationId");

CREATE TABLE IF NOT EXISTS "HrEvaluationActionPlan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "evaluationId" UUID NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "responsibleEmployeeId" UUID,
  "responsibleNameSnapshot" TEXT,
  "dueDate" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "completedAt" TIMESTAMPTZ(6),
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEvaluationActionPlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HrEvaluationActionPlan_evaluationId_idx"
  ON "HrEvaluationActionPlan"("evaluationId");

CREATE INDEX IF NOT EXISTS "HrEvaluationActionPlan_status_idx"
  ON "HrEvaluationActionPlan"("status");

CREATE TABLE IF NOT EXISTS "HrEvaluationAuditEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "evaluationId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" UUID,
  "details" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEvaluationAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HrEvaluationAuditEvent_evaluationId_createdAt_idx"
  ON "HrEvaluationAuditEvent"("evaluationId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "HrEmployeeDocument_evaluationId_idx"
  ON "HrEmployeeDocument"("evaluationId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEvaluationCriterion_templateId_fkey') THEN
    ALTER TABLE "HrEvaluationCriterion"
      ADD CONSTRAINT "HrEvaluationCriterion_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "HrEvaluationTemplate"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEmployeeEvaluation_employeeId_fkey') THEN
    ALTER TABLE "HrEmployeeEvaluation"
      ADD CONSTRAINT "HrEmployeeEvaluation_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEmployeeEvaluation_templateId_fkey') THEN
    ALTER TABLE "HrEmployeeEvaluation"
      ADD CONSTRAINT "HrEmployeeEvaluation_templateId_fkey"
      FOREIGN KEY ("templateId") REFERENCES "HrEvaluationTemplate"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEmployeeEvaluation_evaluatorEmployeeId_fkey') THEN
    ALTER TABLE "HrEmployeeEvaluation"
      ADD CONSTRAINT "HrEmployeeEvaluation_evaluatorEmployeeId_fkey"
      FOREIGN KEY ("evaluatorEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEmployeeEvaluationAnswer_evaluationId_fkey') THEN
    ALTER TABLE "HrEmployeeEvaluationAnswer"
      ADD CONSTRAINT "HrEmployeeEvaluationAnswer_evaluationId_fkey"
      FOREIGN KEY ("evaluationId") REFERENCES "HrEmployeeEvaluation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEmployeeEvaluationAnswer_criterionId_fkey') THEN
    ALTER TABLE "HrEmployeeEvaluationAnswer"
      ADD CONSTRAINT "HrEmployeeEvaluationAnswer_criterionId_fkey"
      FOREIGN KEY ("criterionId") REFERENCES "HrEvaluationCriterion"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEvaluationActionPlan_evaluationId_fkey') THEN
    ALTER TABLE "HrEvaluationActionPlan"
      ADD CONSTRAINT "HrEvaluationActionPlan_evaluationId_fkey"
      FOREIGN KEY ("evaluationId") REFERENCES "HrEmployeeEvaluation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEvaluationActionPlan_responsibleEmployeeId_fkey') THEN
    ALTER TABLE "HrEvaluationActionPlan"
      ADD CONSTRAINT "HrEvaluationActionPlan_responsibleEmployeeId_fkey"
      FOREIGN KEY ("responsibleEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEvaluationAuditEvent_evaluationId_fkey') THEN
    ALTER TABLE "HrEvaluationAuditEvent"
      ADD CONSTRAINT "HrEvaluationAuditEvent_evaluationId_fkey"
      FOREIGN KEY ("evaluationId") REFERENCES "HrEmployeeEvaluation"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEmployeeDocument_evaluationId_fkey') THEN
    ALTER TABLE "HrEmployeeDocument"
      ADD CONSTRAINT "HrEmployeeDocument_evaluationId_fkey"
      FOREIGN KEY ("evaluationId") REFERENCES "HrEmployeeEvaluation"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

INSERT INTO "HrEvaluationTemplate" (
  "id", "code", "name", "description", "evaluationType", "active", "version", "createdAt", "updatedAt"
) VALUES
(
  'c45d0000-0000-4000-8000-000000000045',
  'EXPERIENCE_45_DAYS',
  'Avaliação de Experiência — 45 dias',
  'Primeiro marco do período de experiência.',
  'EXPERIENCE_45_DAYS',
  true,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  'c90d0000-0000-4000-8000-000000000090',
  'EXPERIENCE_FINAL',
  'Avaliação Final do Período de Experiência',
  'Avaliação final do período de experiência. Sem data de término contratual na ficha, o marco usa admissão + 90 dias.',
  'EXPERIENCE_FINAL',
  true,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "HrEvaluationCriterion" (
  "id", "templateId", "code", "name", "description", "category", "sortOrder",
  "active", "allowNotApplicable", "weight", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  t."id",
  v.code,
  v.name,
  NULL,
  v.category,
  v.sort_order,
  true,
  true,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "HrEvaluationTemplate" t
JOIN (
  VALUES
    ('EXPERIENCE_45_DAYS', 'ASSIDUIDADE', 'Assiduidade', 'CONDUTA', 1),
    ('EXPERIENCE_45_DAYS', 'PONTUALIDADE', 'Pontualidade', 'CONDUTA', 2),
    ('EXPERIENCE_45_DAYS', 'QUALIDADE', 'Qualidade do trabalho', 'ENTREGA', 3),
    ('EXPERIENCE_45_DAYS', 'PRODUTIVIDADE', 'Produtividade / ritmo', 'ENTREGA', 4),
    ('EXPERIENCE_45_DAYS', 'APRENDIZADO', 'Aprendizado e adaptação', 'ENTREGA', 5),
    ('EXPERIENCE_45_DAYS', 'PROCEDIMENTOS', 'Cumprimento de procedimentos', 'ENTREGA', 6),
    ('EXPERIENCE_45_DAYS', 'SEGURANCA', 'Segurança no trabalho', 'SEGURANCA', 7),
    ('EXPERIENCE_45_DAYS', 'ORGANIZACAO', 'Organização', 'ENTREGA', 8),
    ('EXPERIENCE_45_DAYS', 'EQUIPE', 'Trabalho em equipe', 'RELACAO', 9),
    ('EXPERIENCE_45_DAYS', 'COMUNICACAO', 'Comunicação', 'RELACAO', 10),
    ('EXPERIENCE_45_DAYS', 'RESPONSABILIDADE', 'Responsabilidade', 'ENTREGA', 11),
    ('EXPERIENCE_45_DAYS', 'AUTONOMIA', 'Autonomia compatível com o cargo', 'ENTREGA', 12),
    ('EXPERIENCE_FINAL', 'ASSIDUIDADE', 'Assiduidade', 'CONDUTA', 1),
    ('EXPERIENCE_FINAL', 'PONTUALIDADE', 'Pontualidade', 'CONDUTA', 2),
    ('EXPERIENCE_FINAL', 'QUALIDADE', 'Qualidade do trabalho', 'ENTREGA', 3),
    ('EXPERIENCE_FINAL', 'PRODUTIVIDADE', 'Produtividade / ritmo', 'ENTREGA', 4),
    ('EXPERIENCE_FINAL', 'APRENDIZADO', 'Aprendizado e adaptação', 'ENTREGA', 5),
    ('EXPERIENCE_FINAL', 'PROCEDIMENTOS', 'Cumprimento de procedimentos', 'ENTREGA', 6),
    ('EXPERIENCE_FINAL', 'SEGURANCA', 'Segurança no trabalho', 'SEGURANCA', 7),
    ('EXPERIENCE_FINAL', 'ORGANIZACAO', 'Organização', 'ENTREGA', 8),
    ('EXPERIENCE_FINAL', 'EQUIPE', 'Trabalho em equipe', 'RELACAO', 9),
    ('EXPERIENCE_FINAL', 'COMUNICACAO', 'Comunicação', 'RELACAO', 10),
    ('EXPERIENCE_FINAL', 'RESPONSABILIDADE', 'Responsabilidade', 'ENTREGA', 11),
    ('EXPERIENCE_FINAL', 'AUTONOMIA', 'Autonomia compatível com o cargo', 'ENTREGA', 12)
) AS v(template_code, code, name, category, sort_order)
  ON t."code" = v.template_code
WHERE NOT EXISTS (
  SELECT 1
  FROM "HrEvaluationCriterion" c
  WHERE c."templateId" = t."id" AND c."code" = v.code
);
