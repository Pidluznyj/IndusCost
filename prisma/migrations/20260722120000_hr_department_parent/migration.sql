-- RH: vínculo opcional Departamento → Departamento (hierarquia entre departamentos)
ALTER TABLE "HrDepartment" ADD COLUMN IF NOT EXISTS "parentDepartmentId" UUID;

CREATE INDEX IF NOT EXISTS "HrDepartment_parentDepartmentId_idx"
  ON "HrDepartment"("parentDepartmentId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'HrDepartment_parentDepartmentId_fkey'
  ) THEN
    ALTER TABLE "HrDepartment"
      ADD CONSTRAINT "HrDepartment_parentDepartmentId_fkey"
      FOREIGN KEY ("parentDepartmentId") REFERENCES "HrDepartment"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
