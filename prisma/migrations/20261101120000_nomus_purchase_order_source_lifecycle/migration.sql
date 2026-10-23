-- Pedidos de Compra Nomus — ciclo de vida na origem (contrato canônico SYNC-02) e histórico de presença.
-- Aditiva: não altera externalId, valores, itens, avaliações nem vínculos com Contas a Pagar.
--
-- Inicialização conservadora dos pedidos já gravados:
--   * sourcePresenceStatus = PRESENT (nenhum pedido sai da carteira na implantação);
--   * presentInLastPayload = false — "ainda não observado pelo novo ciclo de vida". Não afirma que o
--     histórico existe no Nomus; a primeira varredura válida marca true em cada pedido que vier na API.
-- Ausência só é avaliada pelo motor canônico com execução completa + flag
-- NOMUS_SOURCE_RECONCILE_PURCHASE_ORDERS_ENABLED (desligada por padrão).
-- Rollback lógico: docs/nomus/rollback/20261101120000_nomus_purchase_order_source_lifecycle.rollback.sql
-- (os valores de enum acrescentados permanecem; ver documento). IF NOT EXISTS permite reaplicar a
-- migration depois desse rollback sem falhar nos valores que ficaram.

-- AlterEnum
ALTER TYPE "NomusSourceSyncEntityType" ADD VALUE IF NOT EXISTS 'PURCHASE_ORDER';

-- AlterEnum
ALTER TYPE "NomusSourceSyncRunStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';

-- AlterTable
ALTER TABLE "NomusPurchaseOrder" ADD COLUMN     "lastSyncRunId" UUID,
ADD COLUMN     "missingConsecutiveRuns" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "missingSince" TIMESTAMP(3),
ADD COLUMN     "presentInLastPayload" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "sourcePresenceStatus" "NomusSourcePresenceStatus" NOT NULL DEFAULT 'PRESENT',
ADD COLUMN     "sourceRemovedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "NomusPurchaseOrderPresenceEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchaseOrderId" TEXT NOT NULL,
    "externalId" INTEGER NOT NULL,
    "syncRunId" UUID,
    "action" TEXT NOT NULL,
    "fromStatus" "NomusSourcePresenceStatus",
    "toStatus" "NomusSourcePresenceStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "missingConsecutiveRuns" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "evidenceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NomusPurchaseOrderPresenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NomusPurchaseOrderPresenceEvent_purchaseOrderId_occurredAt_idx" ON "NomusPurchaseOrderPresenceEvent"("purchaseOrderId", "occurredAt");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrderPresenceEvent_externalId_idx" ON "NomusPurchaseOrderPresenceEvent"("externalId");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrderPresenceEvent_syncRunId_idx" ON "NomusPurchaseOrderPresenceEvent"("syncRunId");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrderPresenceEvent_action_idx" ON "NomusPurchaseOrderPresenceEvent"("action");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_sourcePresenceStatus_idx" ON "NomusPurchaseOrder"("sourcePresenceStatus");

-- CreateIndex
CREATE INDEX "NomusPurchaseOrder_lastSyncRunId_idx" ON "NomusPurchaseOrder"("lastSyncRunId");

-- AddForeignKey
ALTER TABLE "NomusPurchaseOrder" ADD CONSTRAINT "NomusPurchaseOrder_lastSyncRunId_fkey" FOREIGN KEY ("lastSyncRunId") REFERENCES "NomusSourceSyncRun"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NomusPurchaseOrderPresenceEvent" ADD CONSTRAINT "NomusPurchaseOrderPresenceEvent_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "NomusPurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "NomusPurchaseOrderPresenceEvent" ADD CONSTRAINT "NomusPurchaseOrderPresenceEvent_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "NomusSourceSyncRun"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- Pedidos já gravados: ainda não observados pelo ciclo de vida novo.
UPDATE "NomusPurchaseOrder" SET "presentInLastPayload" = false;
