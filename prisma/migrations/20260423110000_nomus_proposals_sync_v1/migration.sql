-- Nomus Proposal Sync V1 (minimal, backward-safe)
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "sourceSystem" TEXT;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "externalProposalId" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "externalProposalCode" TEXT;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "externalCustomerId" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "externalSellerId" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "externalCompanyId" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "externalMovementTypeId" INTEGER;
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "externalOpenedAt" TIMESTAMPTZ(6);
ALTER TABLE "Proposal" ADD COLUMN IF NOT EXISTS "externalRawPayload" JSONB;

ALTER TABLE "ProposalItem" ADD COLUMN IF NOT EXISTS "externalItemId" INTEGER;
ALTER TABLE "ProposalItem" ADD COLUMN IF NOT EXISTS "externalProductId" INTEGER;
ALTER TABLE "ProposalItem" ADD COLUMN IF NOT EXISTS "externalItemStatus" TEXT;
ALTER TABLE "ProposalItem" ADD COLUMN IF NOT EXISTS "externalRawPayload" JSONB;

CREATE INDEX IF NOT EXISTS "Proposal_sourceSystem_idx" ON "Proposal"("sourceSystem");
CREATE INDEX IF NOT EXISTS "Proposal_externalProposalCode_idx" ON "Proposal"("externalProposalCode");
CREATE INDEX IF NOT EXISTS "ProposalItem_externalProductId_idx" ON "ProposalItem"("externalProductId");

CREATE UNIQUE INDEX IF NOT EXISTS "Proposal_sourceSystem_externalProposalId_key"
  ON "Proposal"("sourceSystem", "externalProposalId");

CREATE UNIQUE INDEX IF NOT EXISTS "ProposalItem_proposalId_externalItemId_key"
  ON "ProposalItem"("proposalId", "externalItemId");
