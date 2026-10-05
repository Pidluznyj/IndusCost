-- POL-COM-001 §11: relógio dos 90 dias para cliente nunca faturado.
-- "assignmentStartedAt" = início do ciclo do Responsável Comercial atual.
-- Aditivo: não remove nem renomeia coluna, índice ou FK; não apaga nenhum vínculo.
--
-- Backfill: "createdAt" é o melhor dado determinístico disponível. O CommercialAuditLog
-- guarda só rótulos de exibição (oldValue/newValue), sem identidade estruturada do vendedor,
-- então não permite reconstruir de forma inequívoca a data da última troca real.
-- "updatedAt" não serve: muda com notas e gravações administrativas.

ALTER TABLE "CrmCustomerCommercialOwner"
  ADD COLUMN IF NOT EXISTS "assignmentStartedAt" TIMESTAMP(6);

UPDATE "CrmCustomerCommercialOwner"
  SET "assignmentStartedAt" = "createdAt"
  WHERE "assignmentStartedAt" IS NULL;

ALTER TABLE "CrmCustomerCommercialOwner"
  ALTER COLUMN "assignmentStartedAt" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "CrmCustomerCommercialOwner"
  ALTER COLUMN "assignmentStartedAt" SET NOT NULL;
