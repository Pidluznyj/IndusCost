-- Vínculo Pedido de Compra Nomus ↔ título de Contas a Pagar.
--
-- Migration ADITIVA. Sem writeback Nomus.
-- Identidade: NomusPurchaseOrder.id (FK) e NomusAccountsPayable.externalId (sem FK:
-- o espelho de títulos é reconciliado pelo sync e pode ser recriado).
-- A baixa do pedido é DERIVADA dos títulos vinculados; nada de coluna de status.

CREATE TABLE "NomusPurchaseOrderPayableLink" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nomusPurchaseOrderId" TEXT NOT NULL,
    "payableExternalId" INTEGER NOT NULL,
    "installmentIndex" INTEGER,
    "method" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "evidence" TEXT,
    "reason" TEXT,
    "createdByUserId" TEXT,
    "createdByUserName" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NomusPurchaseOrderPayableLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NomusPurchaseOrderPayableLink_nomusPurchaseOrderId_payableExternalId_key"
  ON "NomusPurchaseOrderPayableLink"("nomusPurchaseOrderId", "payableExternalId");

CREATE INDEX "NomusPurchaseOrderPayableLink_payableExternalId_idx"
  ON "NomusPurchaseOrderPayableLink"("payableExternalId");

CREATE INDEX "NomusPurchaseOrderPayableLink_nomusPurchaseOrderId_idx"
  ON "NomusPurchaseOrderPayableLink"("nomusPurchaseOrderId");

ALTER TABLE "NomusPurchaseOrderPayableLink"
  ADD CONSTRAINT "NomusPurchaseOrderPayableLink_nomusPurchaseOrderId_fkey"
  FOREIGN KEY ("nomusPurchaseOrderId") REFERENCES "NomusPurchaseOrder"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "NomusPurchaseOrderPayableLinkHistory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "linkId" UUID NOT NULL,
    "nomusPurchaseOrderId" TEXT NOT NULL,
    "payableExternalId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "detailsJson" JSONB NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NomusPurchaseOrderPayableLinkHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NomusPurchaseOrderPayableLinkHistory_nomusPurchaseOrderId_createdAt_idx"
  ON "NomusPurchaseOrderPayableLinkHistory"("nomusPurchaseOrderId", "createdAt");

CREATE INDEX "NomusPurchaseOrderPayableLinkHistory_payableExternalId_idx"
  ON "NomusPurchaseOrderPayableLinkHistory"("payableExternalId");

CREATE INDEX "NomusPurchaseOrderPayableLinkHistory_action_idx"
  ON "NomusPurchaseOrderPayableLinkHistory"("action");
