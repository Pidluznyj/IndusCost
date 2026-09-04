-- PURCH-MIRROR-01 — Espelho oficial (mirror) do Pedido de Compra do Nomus.
-- Aditiva: cria tabelas/enums novos; NÃO toca PurchaseOrder/PurchaseOrderItem/
-- PurchaseReceipt (workflow interno de compras — fluxo separado, não migrado).
-- Rollback lógico: dropar NomusPurchaseOrderItem, NomusPurchaseOrder, os 3
-- enums novos abaixo, e reverter o ALTER TYPE (Postgres não remove valor de
-- enum nativamente — rollback real exige recriar o tipo sem PURCHASE_ORDER
-- se nenhuma linha o utilizar).
--
-- NOTA: ALTER TYPE ... ADD VALUE não pode ser usado na mesma transação em
-- que o novo valor é referenciado (restrição do Postgre pré-12 e, mesmo em
-- 12+, quando o valor citado está DEFAULT/USED no mesmo statement). Este
-- migration não referencia 'PURCHASE_ORDER' em nenhuma outra instrução do
-- mesmo arquivo, então é seguro rodar como uma migration Prisma normal.

-- Enum: nova entidade tipada para runs de sync (reaproveita NomusSourceSyncRun).
ALTER TYPE "NomusSourceSyncEntityType" ADD VALUE 'PURCHASE_ORDER';

-- Enums novos do mirror de Pedido de Compra.
CREATE TYPE "NomusPurchaseOrderSupplierMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'AMBIGUOUS');
CREATE TYPE "NomusPurchaseOrderProductMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED');
CREATE TYPE "NomusPurchaseOrderDerivedStage" AS ENUM (
    'AGUARDANDO_LIBERACAO',
    'LIBERADO',
    'PARCIALMENTE_ATENDIDO',
    'CONCLUIDO',
    'ATENDIDO_COM_CORTE',
    'CANCELADO',
    'DEVOLUCAO',
    'MISTO'
);

-- Cabeçalho do Pedido de Compra Nomus (mirror; nunca escrito pelo workflow interno).
CREATE TABLE "NomusPurchaseOrder" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "externalId" INTEGER NOT NULL,
    "code" TEXT,
    "externalCompanyId" INTEGER,
    "companyCode" TEXT,
    "companyName" TEXT,
    "externalSupplierId" INTEGER,
    "supplierNameSnapshot" TEXT,
    "supplierDocumentSnapshot" TEXT,
    "financialSupplierId" UUID,
    "supplierMatchStatus" "NomusPurchaseOrderSupplierMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "externalBuyerId" INTEGER,
    "buyerNameSnapshot" TEXT,
    "issueDate" TIMESTAMP(3),
    "expectedDeliveryDate" TIMESTAMP(3),
    "paymentConditionId" INTEGER,
    "paymentConditionText" TEXT,
    "paymentMethodId" INTEGER,
    "paymentMethodText" TEXT,
    "freightValue" DECIMAL(20,6),
    "insuranceValue" DECIMAL(20,6),
    "otherExpensesValue" DECIMAL(20,6),
    "discountValue" DECIMAL(20,6),
    "subtotalValue" DECIMAL(20,6),
    "totalValue" DECIMAL(20,6),
    "nomusStatusCode" TEXT,
    "derivedStage" "NomusPurchaseOrderDerivedStage" NOT NULL DEFAULT 'MISTO',
    "rawPayload" JSONB,
    "payloadHash" TEXT,
    "sourcePresenceStatus" "NomusSourcePresenceStatus" NOT NULL DEFAULT 'PRESENT',
    "presentInLastPayload" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "missingSince" TIMESTAMP(3),
    "missingConsecutiveRuns" INTEGER NOT NULL DEFAULT 0,
    "sourceRemovedAt" TIMESTAMP(3),
    "lastSyncRunId" UUID,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusPurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NomusPurchaseOrder_externalId_key" ON "NomusPurchaseOrder"("externalId");
CREATE INDEX "NomusPurchaseOrder_code_idx" ON "NomusPurchaseOrder"("code");
CREATE INDEX "NomusPurchaseOrder_issueDate_idx" ON "NomusPurchaseOrder"("issueDate");
CREATE INDEX "NomusPurchaseOrder_externalSupplierId_idx" ON "NomusPurchaseOrder"("externalSupplierId");
CREATE INDEX "NomusPurchaseOrder_financialSupplierId_idx" ON "NomusPurchaseOrder"("financialSupplierId");
CREATE INDEX "NomusPurchaseOrder_externalBuyerId_idx" ON "NomusPurchaseOrder"("externalBuyerId");
CREATE INDEX "NomusPurchaseOrder_derivedStage_idx" ON "NomusPurchaseOrder"("derivedStage");
CREATE INDEX "NomusPurchaseOrder_syncedAt_idx" ON "NomusPurchaseOrder"("syncedAt");
CREATE INDEX "NomusPurchaseOrder_sourcePresenceStatus_idx" ON "NomusPurchaseOrder"("sourcePresenceStatus");
CREATE INDEX "NomusPurchaseOrder_lastSeenAt_idx" ON "NomusPurchaseOrder"("lastSeenAt");
CREATE INDEX "NomusPurchaseOrder_lastSyncRunId_idx" ON "NomusPurchaseOrder"("lastSyncRunId");
CREATE INDEX "NomusPurchaseOrder_payloadHash_idx" ON "NomusPurchaseOrder"("payloadHash");

ALTER TABLE "NomusPurchaseOrder" ADD CONSTRAINT "NomusPurchaseOrder_financialSupplierId_fkey"
    FOREIGN KEY ("financialSupplierId") REFERENCES "FinancialSupplier"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "NomusPurchaseOrder" ADD CONSTRAINT "NomusPurchaseOrder_lastSyncRunId_fkey"
    FOREIGN KEY ("lastSyncRunId") REFERENCES "NomusSourceSyncRun"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Item/linha do Pedido de Compra Nomus.
CREATE TABLE "NomusPurchaseOrderItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchaseOrderId" UUID NOT NULL,
    "externalItemId" INTEGER,
    "lineNumber" INTEGER NOT NULL,
    "externalProductId" INTEGER,
    "productCodeSnapshot" TEXT,
    "productDescriptionSnapshot" TEXT,
    "unitSnapshot" TEXT,
    "quantityOrdered" DECIMAL(20,6),
    "quantityAttended" DECIMAL(20,6),
    "quantityPending" DECIMAL(20,6),
    "unitPrice" DECIMAL(20,6),
    "discountPercent" DECIMAL(10,6),
    "discountValue" DECIMAL(20,6),
    "lineTotal" DECIMAL(20,6),
    "expectedDeliveryDate" TIMESTAMP(3),
    "nomusStatusCode" TEXT,
    "nomusStatusName" TEXT,
    "materialId" UUID,
    "inventoryItemId" UUID,
    "productMatchStatus" "NomusPurchaseOrderProductMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
    "rawPayload" JSONB,
    "payloadHash" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NomusPurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NomusPurchaseOrderItem_purchaseOrderId_lineNumber_key" ON "NomusPurchaseOrderItem"("purchaseOrderId", "lineNumber");
CREATE INDEX "NomusPurchaseOrderItem_purchaseOrderId_idx" ON "NomusPurchaseOrderItem"("purchaseOrderId");
CREATE INDEX "NomusPurchaseOrderItem_externalItemId_idx" ON "NomusPurchaseOrderItem"("externalItemId");
CREATE INDEX "NomusPurchaseOrderItem_externalProductId_idx" ON "NomusPurchaseOrderItem"("externalProductId");
CREATE INDEX "NomusPurchaseOrderItem_materialId_idx" ON "NomusPurchaseOrderItem"("materialId");
CREATE INDEX "NomusPurchaseOrderItem_inventoryItemId_idx" ON "NomusPurchaseOrderItem"("inventoryItemId");
CREATE INDEX "NomusPurchaseOrderItem_productMatchStatus_idx" ON "NomusPurchaseOrderItem"("productMatchStatus");
CREATE INDEX "NomusPurchaseOrderItem_nomusStatusCode_idx" ON "NomusPurchaseOrderItem"("nomusStatusCode");

ALTER TABLE "NomusPurchaseOrderItem" ADD CONSTRAINT "NomusPurchaseOrderItem_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "NomusPurchaseOrder"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "NomusPurchaseOrderItem" ADD CONSTRAINT "NomusPurchaseOrderItem_materialId_fkey"
    FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "NomusPurchaseOrderItem" ADD CONSTRAINT "NomusPurchaseOrderItem_inventoryItemId_fkey"
    FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
