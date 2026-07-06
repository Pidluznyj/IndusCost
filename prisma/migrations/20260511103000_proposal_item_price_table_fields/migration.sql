-- ETAPA 2: campos opcionais de rastreabilidade da tabela de preco por item (sem FK, sem backfill)

ALTER TABLE "ProposalItem" ADD COLUMN "priceTableId" UUID;
ALTER TABLE "ProposalItem" ADD COLUMN "priceTableVersionId" UUID;
ALTER TABLE "ProposalItem" ADD COLUMN "priceTableCode" TEXT;
ALTER TABLE "ProposalItem" ADD COLUMN "priceTableVersionNumber" INTEGER;

CREATE INDEX "ProposalItem_priceTableId_idx" ON "ProposalItem"("priceTableId");
CREATE INDEX "ProposalItem_priceTableVersionId_idx" ON "ProposalItem"("priceTableVersionId");
CREATE INDEX "ProposalItem_priceTableCode_idx" ON "ProposalItem"("priceTableCode");
