-- DS-03.3 — Enrichment aditivo do cabeçalho NomusStockDocument.
-- Reversível: apenas ADD COLUMN / CREATE INDEX (ver bloco DOWN no final).
-- Não altera NomusStockDocumentItem, NF-e, CR, Pedido, O2C, Comissões ou InventoryMovement.

-- AlterTable
ALTER TABLE "NomusStockDocument" ADD COLUMN "documentNumber" TEXT;
ALTER TABLE "NomusStockDocument" ADD COLUMN "statusRaw" TEXT;
ALTER TABLE "NomusStockDocument" ADD COLUMN "isCancelled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "NomusStockDocument" ADD COLUMN "cancelledAt" TIMESTAMP(3);
ALTER TABLE "NomusStockDocument" ADD COLUMN "cancellationReason" TEXT;
ALTER TABLE "NomusStockDocument" ADD COLUMN "totalValue" DECIMAL(20,2);
ALTER TABLE "NomusStockDocument" ADD COLUMN "personExternalId" INTEGER;
ALTER TABLE "NomusStockDocument" ADD COLUMN "personName" TEXT;
ALTER TABLE "NomusStockDocument" ADD COLUMN "companyExternalId" INTEGER;
ALTER TABLE "NomusStockDocument" ADD COLUMN "companyName" TEXT;
ALTER TABLE "NomusStockDocument" ADD COLUMN "movementDate" TIMESTAMP(3);
ALTER TABLE "NomusStockDocument" ADD COLUMN "paymentTermsRaw" TEXT;
ALTER TABLE "NomusStockDocument" ADD COLUMN "payloadHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "NomusStockDocument" ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "NomusStockDocument" ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "NomusStockDocument" ADD COLUMN "presentInLastPayload" BOOLEAN NOT NULL DEFAULT true;

-- Drop defaults transitórios de payloadHash (linhas legadas ficam com '' até o próximo sync).
ALTER TABLE "NomusStockDocument" ALTER COLUMN "payloadHash" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "NomusStockDocument_documentNumber_idx" ON "NomusStockDocument"("documentNumber");
CREATE INDEX "NomusStockDocument_isCancelled_idx" ON "NomusStockDocument"("isCancelled");
CREATE INDEX "NomusStockDocument_personExternalId_idx" ON "NomusStockDocument"("personExternalId");
CREATE INDEX "NomusStockDocument_companyExternalId_idx" ON "NomusStockDocument"("companyExternalId");
CREATE INDEX "NomusStockDocument_movementDate_idx" ON "NomusStockDocument"("movementDate");
CREATE INDEX "NomusStockDocument_payloadHash_idx" ON "NomusStockDocument"("payloadHash");
CREATE INDEX "NomusStockDocument_presentInLastPayload_idx" ON "NomusStockDocument"("presentInLastPayload");
CREATE INDEX "NomusStockDocument_lastSeenAt_idx" ON "NomusStockDocument"("lastSeenAt");

-- DOWN (manual / reversível):
-- DROP INDEX IF EXISTS "NomusStockDocument_lastSeenAt_idx";
-- DROP INDEX IF EXISTS "NomusStockDocument_presentInLastPayload_idx";
-- DROP INDEX IF EXISTS "NomusStockDocument_payloadHash_idx";
-- DROP INDEX IF EXISTS "NomusStockDocument_movementDate_idx";
-- DROP INDEX IF EXISTS "NomusStockDocument_companyExternalId_idx";
-- DROP INDEX IF EXISTS "NomusStockDocument_personExternalId_idx";
-- DROP INDEX IF EXISTS "NomusStockDocument_isCancelled_idx";
-- DROP INDEX IF EXISTS "NomusStockDocument_documentNumber_idx";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "presentInLastPayload";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "lastSeenAt";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "firstSeenAt";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "payloadHash";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "paymentTermsRaw";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "movementDate";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "companyName";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "companyExternalId";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "personName";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "personExternalId";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "totalValue";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "cancellationReason";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "cancelledAt";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "isCancelled";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "statusRaw";
-- ALTER TABLE "NomusStockDocument" DROP COLUMN IF EXISTS "documentNumber";
