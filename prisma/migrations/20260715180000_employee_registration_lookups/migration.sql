-- Evolução do cadastro de colaborador (Pessoas / RH).
-- Campos opcionais: não quebra colaboradores existentes.
-- Unicidade de e-mail corporativo case-insensitive (somente quando preenchido).

ALTER TABLE "Employee"
ADD COLUMN IF NOT EXISTS "corporateEmail" TEXT,
ADD COLUMN IF NOT EXISTS "costCenterId" UUID,
ADD COLUMN IF NOT EXISTS "managerId" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "Employee_corporateEmail_lower_uidx"
ON "Employee" (lower("corporateEmail"))
WHERE "corporateEmail" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Employee_costCenterId_idx" ON "Employee"("costCenterId");
CREATE INDEX IF NOT EXISTS "Employee_managerId_idx" ON "Employee"("managerId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Employee_costCenterId_fkey'
  ) THEN
    ALTER TABLE "Employee"
    ADD CONSTRAINT "Employee_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "FinancialCostCenter"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Employee_managerId_fkey'
  ) THEN
    ALTER TABLE "Employee"
    ADD CONSTRAINT "Employee_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "Employee"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
