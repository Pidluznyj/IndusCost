-- PASSO 3C.1: campos opcionais de rastreabilidade / snapshot de tabela publicada (sem FK, sem backfill)

ALTER TABLE "Proposal" ADD COLUMN "priceTableId" UUID;
ALTER TABLE "Proposal" ADD COLUMN "priceTableVersionId" UUID;
ALTER TABLE "Proposal" ADD COLUMN "priceTableCode" TEXT;
ALTER TABLE "Proposal" ADD COLUMN "priceTableVersionNumber" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN "priceSource" TEXT;

CREATE INDEX "Proposal_priceTableId_idx" ON "Proposal"("priceTableId");
CREATE INDEX "Proposal_priceTableVersionId_idx" ON "Proposal"("priceTableVersionId");
CREATE INDEX "Proposal_priceSource_idx" ON "Proposal"("priceSource");

ALTER TABLE "ProposalItem" ADD COLUMN "priceTableItemId" UUID;
ALTER TABLE "ProposalItem" ADD COLUMN "priceSource" TEXT;
ALTER TABLE "ProposalItem" ADD COLUMN "pricingSnapshotJson" JSONB;

CREATE INDEX "ProposalItem_priceTableItemId_idx" ON "ProposalItem"("priceTableItemId");
CREATE INDEX "ProposalItem_priceSource_idx" ON "ProposalItem"("priceSource");
