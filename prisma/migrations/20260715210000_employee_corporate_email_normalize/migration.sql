-- E-mail corporativo do colaborador: normalização e garantia do índice CI.
-- Não falha se já existir; não aplica constraint em Person (ainda sem UNIQUE no hub).
-- Colaboradores sem e-mail permanecem NULL.

UPDATE "Employee"
SET "corporateEmail" = lower(btrim("corporateEmail"))
WHERE "corporateEmail" IS NOT NULL
  AND "corporateEmail" <> lower(btrim("corporateEmail"));

CREATE UNIQUE INDEX IF NOT EXISTS "Employee_corporateEmail_lower_uidx"
ON "Employee" (lower("corporateEmail"))
WHERE "corporateEmail" IS NOT NULL;
