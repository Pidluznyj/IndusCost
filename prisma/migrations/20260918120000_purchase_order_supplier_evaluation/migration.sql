-- OP-26 — Avaliação de Pedido de Compra e Desempenho de Fornecedores.
--
-- Migration ADITIVA e DETERMINÍSTICA (fail-fast).
--   Não executa DROP, TRUNCATE, RENAME nem DELETE FROM.
--   Não altera nenhuma tabela existente: o único ALTER TABLE é a FK da tabela nova.
--   1 CREATE TABLE, 1 índice único, 1 FOREIGN KEY.
--
-- DDL sem `IF NOT EXISTS` e sem `EXCEPTION WHEN duplicate_object` de propósito:
-- migration versionada não pode mascarar drift nem estado parcial do banco. Se a
-- tabela, o índice ou a constraint já existirem inesperadamente, esta migration
-- DEVE falhar e exigir investigação.
--
-- FK com ON DELETE RESTRICT (referential action, não DML): a avaliação é
-- evidência auditável do processo de qualificação de fornecedores. Uma exclusão
-- física do PurchaseOrder não pode apagar a avaliação em silêncio — apagar um
-- pedido avaliado passa a exigir decisão humana explícita.
--
-- A nota do fornecedor NÃO é materializada: `FinancialSupplier` não recebe
-- coluna nova. O desempenho é sempre derivado por agregação sobre esta tabela
-- + `PurchaseOrder` (sem stale data, sem sincronização, sem trigger).
--
-- A auditoria (criação/revisão, before/after, autor, data) reutiliza
-- `PurchaseOrderHistoryEvent` — nenhuma tabela de histórico nova.
--
-- UNIQUE("purchaseOrderId") é a única garantia estrutural exigida: no máximo
-- uma avaliação vigente por pedido; duas criações simultâneas viram conflito
-- controlado de domínio, nunca erro bruto do Prisma.
--
-- Notas em NUMERIC(4,2) (0.00..10.00) — nunca ponto flutuante.

-- CreateTable
CREATE TABLE "PurchaseOrderSupplierEvaluation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchaseOrderId" UUID NOT NULL,
    "qualityScore" DECIMAL(4,2) NOT NULL,
    "deliveryScore" DECIMAL(4,2) NOT NULL,
    "conformityScore" DECIMAL(4,2) NOT NULL,
    "serviceScore" DECIMAL(4,2) NOT NULL,
    "overallScore" DECIMAL(4,2) NOT NULL,
    "methodologyVersion" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT,
    "createdByUserName" TEXT,
    "updatedByUserId" TEXT,
    "updatedByUserName" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderSupplierEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderSupplierEvaluation_purchaseOrderId_key" ON "PurchaseOrderSupplierEvaluation"("purchaseOrderId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderSupplierEvaluation" ADD CONSTRAINT "PurchaseOrderSupplierEvaluation_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
