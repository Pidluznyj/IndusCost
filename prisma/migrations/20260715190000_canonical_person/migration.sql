-- Pessoa canônica (identidade física) + personId opcional nos papéis de domínio.
-- Não executar em produção pelo Cursor. Compatível com legado (tudo nullable).

CREATE TABLE IF NOT EXISTS "Person" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "displayName" TEXT NOT NULL,
  "socialName" TEXT,
  "corporateEmail" TEXT,
  "personalEmail" TEXT,
  "cpfNormalized" TEXT,
  "phoneNormalized" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Person_displayName_idx" ON "Person"("displayName");
CREATE INDEX IF NOT EXISTS "Person_corporateEmail_idx" ON "Person"("corporateEmail");
CREATE INDEX IF NOT EXISTS "Person_personalEmail_idx" ON "Person"("personalEmail");
CREATE INDEX IF NOT EXISTS "Person_cpfNormalized_idx" ON "Person"("cpfNormalized");
CREATE INDEX IF NOT EXISTS "Person_phoneNormalized_idx" ON "Person"("phoneNormalized");
CREATE INDEX IF NOT EXISTS "Person_status_idx" ON "Person"("status");

CREATE UNIQUE INDEX IF NOT EXISTS "Person_cpfNormalized_uidx"
ON "Person"("cpfNormalized")
WHERE "cpfNormalized" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Person_corporateEmail_lower_uidx"
ON "Person"(lower("corporateEmail"))
WHERE "corporateEmail" IS NOT NULL;

ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "personId" UUID;
ALTER TABLE "AppUser" ADD COLUMN IF NOT EXISTS "personId" UUID;
ALTER TABLE "CommissionPerson" ADD COLUMN IF NOT EXISTS "personId" UUID;
ALTER TABLE "FleetDriver" ADD COLUMN IF NOT EXISTS "personId" UUID;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "personId" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "Employee_personId_key" ON "Employee"("personId") WHERE "personId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "AppUser_personId_key" ON "AppUser"("personId") WHERE "personId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "CommissionPerson_personId_idx" ON "CommissionPerson"("personId");
CREATE INDEX IF NOT EXISTS "FleetDriver_personId_idx" ON "FleetDriver"("personId");
CREATE INDEX IF NOT EXISTS "Customer_personId_idx" ON "Customer"("personId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Employee_personId_fkey') THEN
    ALTER TABLE "Employee"
      ADD CONSTRAINT "Employee_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AppUser_personId_fkey') THEN
    ALTER TABLE "AppUser"
      ADD CONSTRAINT "AppUser_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CommissionPerson_personId_fkey') THEN
    ALTER TABLE "CommissionPerson"
      ADD CONSTRAINT "CommissionPerson_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FleetDriver_personId_fkey') THEN
    ALTER TABLE "FleetDriver"
      ADD CONSTRAINT "FleetDriver_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Customer_personId_fkey') THEN
    ALTER TABLE "Customer"
      ADD CONSTRAINT "Customer_personId_fkey"
      FOREIGN KEY ("personId") REFERENCES "Person"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
