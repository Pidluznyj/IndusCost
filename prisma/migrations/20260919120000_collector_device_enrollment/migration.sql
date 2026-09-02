-- Stock Collector — solicitação de autorização de dispositivo (self-service controlado).
--
-- Migration ADITIVA e DETERMINÍSTICA (fail-fast).
--   Não executa DROP, TRUNCATE, RENAME nem DELETE FROM.
--   Não altera nenhuma tabela existente.
--   1 CREATE TABLE, 1 índice único, 1 índice de consulta.
--
-- DDL sem `IF NOT EXISTS`: migration versionada não pode mascarar drift. Se a
-- tabela já existir inesperadamente, esta migration DEVE falhar.
--
-- Existir uma linha aqui NÃO autoriza dispositivo nenhum. A autorização
-- continua sendo exclusivamente InventoryCollectorDevice ativo, alcançado só
-- por decisão humana. Esta tabela é a fila de pedidos.
--
-- UNIQUE("tailscaleStableNodeId") é a garantia anti-spam: um tablet
-- recarregando a tela mil vezes atualiza UMA linha (requestCount/lastRequestedAt)
-- em vez de inserir mil.
--
-- Sem FOREIGN KEY para InventoryCollectorDevice de propósito: `approvedDeviceId`
-- é vínculo informativo da decisão e não pode impedir a revogação/limpeza
-- futura do device nem criar acoplamento de exclusão entre as duas tabelas.

-- CreateTable
CREATE TABLE "InventoryCollectorDeviceEnrollment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tailscaleStableNodeId" TEXT NOT NULL,
    "tailscaleNodeName" TEXT,
    "tailscaleLoginName" TEXT,
    "lastSeenIp" TEXT,
    "requestedSectorSlug" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestCount" INTEGER NOT NULL DEFAULT 1,
    "firstRequestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRequestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "decidedAt" TIMESTAMPTZ(6),
    "decidedByUserId" TEXT,
    "decisionNote" TEXT,
    "approvedDeviceId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryCollectorDeviceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryCollectorDeviceEnrollment_tailscaleStableNodeId_key" ON "InventoryCollectorDeviceEnrollment"("tailscaleStableNodeId");

-- CreateIndex
CREATE INDEX "InventoryCollectorDeviceEnrollment_status_lastRequestedAt_idx" ON "InventoryCollectorDeviceEnrollment"("status", "lastRequestedAt");
