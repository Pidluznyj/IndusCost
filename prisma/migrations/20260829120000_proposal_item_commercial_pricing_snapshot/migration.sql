-- Snapshot comercial versionado do item da Proposta (formação, faixas, comissão, margem).
-- Aditivo e nullable: registros legados permanecem NULL (sem backfill, sem zero falso).

ALTER TABLE "ProposalItem"
ADD COLUMN IF NOT EXISTS "commercialPricingSnapshotJson" JSONB;
