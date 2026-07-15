-- Customer.contactPersonId: Pessoa canônica do contato cadastral (não identidade de PJ).
-- NÃO executar migrate deploy em produção neste prompt sem confirmação explícita.

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "contactPersonId" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Customer_contactPersonId_fkey'
  ) THEN
    ALTER TABLE "Customer"
      ADD CONSTRAINT "Customer_contactPersonId_fkey"
      FOREIGN KEY ("contactPersonId") REFERENCES "Person"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Customer_contactPersonId_idx" ON "Customer"("contactPersonId");
