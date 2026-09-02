-- OP-26 — Avaliação de Pedido de Compra e Desempenho de Fornecedores.
--
-- Migration ADITIVA. Auditoria:
--   0 DROP, 0 RENAME, 0 DELETE, 0 TRUNCATE, 0 ALTER em tabela existente.
--   1 CREATE TABLE, 1 índice único, 1 FOREIGN KEY.
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
CREATE TABLE IF NOT EXISTS "PurchaseOrderSupplierEvaluation" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrderSupplierEvaluation_purchaseOrderId_key"
  ON "PurchaseOrderSupplierEvaluation"("purchaseOrderId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PurchaseOrderSupplierEvaluation"
    ADD CONSTRAINT "PurchaseOrderSupplierEvaluation_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
