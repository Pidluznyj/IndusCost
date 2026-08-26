-- Ficha funcional corporativa (RH).
-- Aditivo: Employee permanece snapshot atual; histórico e satélites em tabelas próprias.
-- Não inventa eventos de promoção/reajuste. Compatível com colaboradores sem Person.
-- Índices: queries reais de timeline paginada (employeeId + effectiveDate DESC).

ALTER TABLE "Employee"
ADD COLUMN IF NOT EXISTS "maritalStatus" TEXT,
ADD COLUMN IF NOT EXISTS "city" TEXT,
ADD COLUMN IF NOT EXISTS "state" TEXT,
ADD COLUMN IF NOT EXISTS "zipCode" TEXT,
ADD COLUMN IF NOT EXISTS "workSchedule" TEXT,
ADD COLUMN IF NOT EXISTS "photoStorageKey" TEXT;

CREATE TABLE IF NOT EXISTS "HrEmployeeHistory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "effectiveDate" TIMESTAMPTZ(6) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'USER',
  "reason" TEXT,
  "notes" TEXT,
  "previousRoleId" UUID,
  "newRoleId" UUID,
  "previousRoleName" TEXT,
  "newRoleName" TEXT,
  "previousDepartmentId" UUID,
  "newDepartmentId" UUID,
  "previousDepartment" TEXT,
  "newDepartment" TEXT,
  "previousCostCenterId" UUID,
  "newCostCenterId" UUID,
  "previousCostCenter" TEXT,
  "newCostCenter" TEXT,
  "previousManagerId" UUID,
  "newManagerId" UUID,
  "previousManagerName" TEXT,
  "newManagerName" TEXT,
  "previousContractType" TEXT,
  "newContractType" TEXT,
  "previousWorkSchedule" TEXT,
  "newWorkSchedule" TEXT,
  "previousStatus" TEXT,
  "newStatus" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByUserId" UUID,
  CONSTRAINT "HrEmployeeHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HrCompensationAdjustment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId" UUID NOT NULL,
  "effectiveDate" TIMESTAMPTZ(6) NOT NULL,
  "registeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "type" TEXT NOT NULL,
  "percentage" DECIMAL(10, 6),
  "previousAmount" DECIMAL(20, 6),
  "newAmount" DECIMAL(20, 6),
  "differenceAmount" DECIMAL(20, 6),
  "reason" TEXT,
  "notes" TEXT,
  "historyEventId" UUID,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrCompensationAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HrBenefit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'OTHER',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "isFinancial" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrBenefit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HrEmployeeBenefit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId" UUID NOT NULL,
  "benefitId" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startDate" TIMESTAMPTZ(6) NOT NULL,
  "endDate" TIMESTAMPTZ(6),
  "planName" TEXT,
  "amount" DECIMAL(20, 6),
  "notes" TEXT,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeBenefit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HrEmergencyContact" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "relationship" TEXT,
  "phone" TEXT NOT NULL,
  "alternatePhone" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 2,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmergencyContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HrEpiDelivery" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId" UUID NOT NULL,
  "item" TEXT NOT NULL,
  "deliveredAt" TIMESTAMPTZ(6) NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "size" TEXT,
  "validUntil" TIMESTAMPTZ(6),
  "responsibleName" TEXT,
  "returnedAt" TIMESTAMPTZ(6),
  "notes" TEXT,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEpiDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HrEmployeeDocument" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId" UUID NOT NULL,
  "personId" UUID,
  "documentType" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "mimeType" TEXT,
  "fileSize" INTEGER,
  "issuedAt" TIMESTAMPTZ(6),
  "expiresAt" TIMESTAMPTZ(6),
  "notes" TEXT,
  "uploadedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HrAbsence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "startDate" TIMESTAMPTZ(6) NOT NULL,
  "endDate" TIMESTAMPTZ(6),
  "expectedReturn" TIMESTAMPTZ(6),
  "actualReturn" TIMESTAMPTZ(6),
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "reason" TEXT,
  "notes" TEXT,
  "documentId" UUID,
  "createdByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrAbsence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "HrEmployeeNote" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "employeeId" UUID NOT NULL,
  "category" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'STANDARD',
  "createdByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HrBenefit_code_key" ON "HrBenefit"("code");

-- Timeline paginada: ORDER BY effectiveDate DESC, createdAt DESC, id DESC WHERE employeeId = $1
CREATE INDEX IF NOT EXISTS "HrEmployeeHistory_employeeId_effectiveDate_createdAt_id_idx"
  ON "HrEmployeeHistory"("employeeId", "effectiveDate" DESC, "createdAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "HrEmployeeHistory_eventType_effectiveDate_idx"
  ON "HrEmployeeHistory"("eventType", "effectiveDate" DESC);

-- Backfill INITIAL_STATE idempotente (um baseline por colaborador).
CREATE UNIQUE INDEX IF NOT EXISTS "HrEmployeeHistory_employee_initial_state_uidx"
  ON "HrEmployeeHistory"("employeeId")
  WHERE "eventType" = 'INITIAL_STATE';

CREATE INDEX IF NOT EXISTS "HrCompensationAdjustment_employeeId_effectiveDate_idx"
  ON "HrCompensationAdjustment"("employeeId", "effectiveDate" DESC, "createdAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "HrBenefit_status_idx" ON "HrBenefit"("status");

CREATE INDEX IF NOT EXISTS "HrEmployeeBenefit_employeeId_startDate_idx"
  ON "HrEmployeeBenefit"("employeeId", "startDate" DESC);

CREATE INDEX IF NOT EXISTS "HrEmployeeBenefit_benefitId_idx" ON "HrEmployeeBenefit"("benefitId");

CREATE INDEX IF NOT EXISTS "HrEmergencyContact_employeeId_priority_idx"
  ON "HrEmergencyContact"("employeeId", "priority");

CREATE INDEX IF NOT EXISTS "HrEpiDelivery_employeeId_deliveredAt_idx"
  ON "HrEpiDelivery"("employeeId", "deliveredAt" DESC);

CREATE INDEX IF NOT EXISTS "HrEmployeeDocument_employeeId_createdAt_idx"
  ON "HrEmployeeDocument"("employeeId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "HrAbsence_employeeId_startDate_idx"
  ON "HrAbsence"("employeeId", "startDate" DESC);

CREATE INDEX IF NOT EXISTS "HrAbsence_employeeId_status_idx"
  ON "HrAbsence"("employeeId", "status");

CREATE INDEX IF NOT EXISTS "HrEmployeeNote_employeeId_createdAt_idx"
  ON "HrEmployeeNote"("employeeId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "HrEmployeeNote_employeeId_category_idx"
  ON "HrEmployeeNote"("employeeId", "category");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEmployeeHistory_employeeId_fkey') THEN
    ALTER TABLE "HrEmployeeHistory"
      ADD CONSTRAINT "HrEmployeeHistory_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrCompensationAdjustment_employeeId_fkey') THEN
    ALTER TABLE "HrCompensationAdjustment"
      ADD CONSTRAINT "HrCompensationAdjustment_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEmployeeBenefit_employeeId_fkey') THEN
    ALTER TABLE "HrEmployeeBenefit"
      ADD CONSTRAINT "HrEmployeeBenefit_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEmployeeBenefit_benefitId_fkey') THEN
    ALTER TABLE "HrEmployeeBenefit"
      ADD CONSTRAINT "HrEmployeeBenefit_benefitId_fkey"
      FOREIGN KEY ("benefitId") REFERENCES "HrBenefit"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEmergencyContact_employeeId_fkey') THEN
    ALTER TABLE "HrEmergencyContact"
      ADD CONSTRAINT "HrEmergencyContact_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEpiDelivery_employeeId_fkey') THEN
    ALTER TABLE "HrEpiDelivery"
      ADD CONSTRAINT "HrEpiDelivery_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEmployeeDocument_employeeId_fkey') THEN
    ALTER TABLE "HrEmployeeDocument"
      ADD CONSTRAINT "HrEmployeeDocument_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrAbsence_employeeId_fkey') THEN
    ALTER TABLE "HrAbsence"
      ADD CONSTRAINT "HrAbsence_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HrEmployeeNote_employeeId_fkey') THEN
    ALTER TABLE "HrEmployeeNote"
      ADD CONSTRAINT "HrEmployeeNote_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;
