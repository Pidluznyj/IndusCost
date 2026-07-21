-- RH: estrutura organizacional oficial (Diretoria → Departamento + líderes)
CREATE TABLE IF NOT EXISTS "HrDirectorate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "leaderEmployeeId" UUID NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrDirectorate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HrDirectorate_code_key" ON "HrDirectorate"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "HrDirectorate_name_key" ON "HrDirectorate"("name");
CREATE INDEX IF NOT EXISTS "HrDirectorate_status_idx" ON "HrDirectorate"("status");
CREATE INDEX IF NOT EXISTS "HrDirectorate_leaderEmployeeId_idx" ON "HrDirectorate"("leaderEmployeeId");

CREATE TABLE IF NOT EXISTS "HrDepartment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "directorateId" UUID NOT NULL,
  "leaderEmployeeId" UUID NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrDepartment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HrDepartment_code_key" ON "HrDepartment"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "HrDepartment_directorateId_name_key" ON "HrDepartment"("directorateId", "name");
CREATE INDEX IF NOT EXISTS "HrDepartment_status_idx" ON "HrDepartment"("status");
CREATE INDEX IF NOT EXISTS "HrDepartment_directorateId_idx" ON "HrDepartment"("directorateId");
CREATE INDEX IF NOT EXISTS "HrDepartment_leaderEmployeeId_idx" ON "HrDepartment"("leaderEmployeeId");

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "departmentId" UUID;

CREATE INDEX IF NOT EXISTS "Employee_departmentId_idx" ON "Employee"("departmentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HrDirectorate_leaderEmployeeId_fkey'
  ) THEN
    ALTER TABLE "HrDirectorate"
      ADD CONSTRAINT "HrDirectorate_leaderEmployeeId_fkey"
      FOREIGN KEY ("leaderEmployeeId") REFERENCES "Employee"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HrDepartment_directorateId_fkey'
  ) THEN
    ALTER TABLE "HrDepartment"
      ADD CONSTRAINT "HrDepartment_directorateId_fkey"
      FOREIGN KEY ("directorateId") REFERENCES "HrDirectorate"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HrDepartment_leaderEmployeeId_fkey'
  ) THEN
    ALTER TABLE "HrDepartment"
      ADD CONSTRAINT "HrDepartment_leaderEmployeeId_fkey"
      FOREIGN KEY ("leaderEmployeeId") REFERENCES "Employee"("id")
      ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Employee_departmentId_fkey'
  ) THEN
    ALTER TABLE "Employee"
      ADD CONSTRAINT "Employee_departmentId_fkey"
      FOREIGN KEY ("departmentId") REFERENCES "HrDepartment"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
