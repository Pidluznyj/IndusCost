-- Desligamento e afastamentos com as regras legais (src/lib/employeeLifecycle.ts).
-- Aditivo: só colunas novas, todas opcionais (ou com padrão). Nenhum dado existente muda.
-- Afastado NÃO é status do Employee: o vínculo continua ACTIVE; a situação vem do HrAbsence em andamento.

ALTER TABLE "Employee" ADD COLUMN "terminationReason" TEXT;
ALTER TABLE "Employee" ADD COLUMN "terminationNoticeType" TEXT;
ALTER TABLE "Employee" ADD COLUMN "terminationNoticeDate" TIMESTAMPTZ(6);
ALTER TABLE "Employee" ADD COLUMN "terminationDetails" TEXT;

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_terminationReason_check" CHECK (
  "terminationReason" IS NULL OR "terminationReason" IN (
    'DISMISSAL_WITHOUT_CAUSE', 'DISMISSAL_WITH_CAUSE', 'RESIGNATION', 'MUTUAL_AGREEMENT', 'CONTRACT_END',
    'EARLY_END_BY_EMPLOYER', 'EARLY_END_BY_EMPLOYEE', 'INDIRECT_TERMINATION', 'DEATH', 'OTHER'
  )
);
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_terminationNoticeType_check" CHECK (
  "terminationNoticeType" IS NULL OR "terminationNoticeType" IN ('WORKED', 'INDEMNIFIED', 'WAIVED', 'NOT_APPLICABLE')
);
-- Motivo de desligamento só em colaborador desligado.
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_terminationReason_inactive_check" CHECK (
  "terminationReason" IS NULL OR "status" = 'INACTIVE'
);

ALTER TABLE "HrAbsence" ADD COLUMN "extendedLicense" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "HrAbsence" ADD COLUMN "inssBenefitNumber" TEXT;
ALTER TABLE "HrAbsence" ADD COLUMN "catNumber" TEXT;
