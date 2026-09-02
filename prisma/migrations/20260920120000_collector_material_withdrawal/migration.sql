-- Stock Collector — retirada de material pelo tablet.
--
-- Migration ADITIVA e DETERMINÍSTICA (fail-fast).
--   Não executa DROP, TRUNCATE, RENAME nem DELETE FROM.
--   Não altera nenhuma tabela existente.
--   1 CREATE TABLE, 1 índice único, 3 índices de consulta.
--
-- DDL sem `IF NOT EXISTS`: migration versionada não pode mascarar drift. Se a
-- tabela já existir inesperadamente, esta migration DEVE falhar.
--
-- UNIQUE("operationId") é o coração da coisa: a linha é gravada na MESMA
-- transação do InventoryMovement, então um segundo toque no botão com o mesmo
-- operationId aborta a transação inteira e o saldo não é debitado duas vezes.
--
-- Sem FOREIGN KEY (device / item / warehouse / location / movement), pela mesma
-- razão adotada no enrollment: este é o registro imutável de um fato logístico
-- e não pode travar limpeza futura nem acoplar exclusão entre tabelas.

-- CreateTable
CREATE TABLE "InventoryCollectorWithdrawal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "operationId" TEXT NOT NULL,
    "deviceId" UUID NOT NULL,
    "sector" TEXT NOT NULL,
    "itemId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "locationId" UUID,
    "quantity" DECIMAL(20,6) NOT NULL,
    "withdrawnBy" TEXT NOT NULL,
    "movementId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryCollectorWithdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCollectorWithdrawal_operationId_key" ON "InventoryCollectorWithdrawal"("operationId");

-- CreateIndex
CREATE INDEX "InventoryCollectorWithdrawal_deviceId_createdAt_idx" ON "InventoryCollectorWithdrawal"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryCollectorWithdrawal_itemId_idx" ON "InventoryCollectorWithdrawal"("itemId");

-- CreateIndex
CREATE INDEX "InventoryCollectorWithdrawal_movementId_idx" ON "InventoryCollectorWithdrawal"("movementId");
