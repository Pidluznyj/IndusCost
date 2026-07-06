-- Aditivo: hierarquia e snapshots oficiais em ProjectStructureLine (módulo Projetos)

ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "parentLineId" UUID;
ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "level" INTEGER;
ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "treePath" TEXT;
ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "snapshotRootProductId" UUID;
ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "sourceOfficialBomId" TEXT;
ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "sourceOfficialRoutingId" TEXT;
ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "officialQuantitySnapshot" DECIMAL(20,6);
ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "officialLossPercentSnapshot" DECIMAL(10,6);
ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "officialUnitCostSnapshot" DECIMAL(20,6);
ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "costSource" TEXT;
ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "isChangedFromOfficial" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "isMissingCost" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProjectStructureLine" ADD COLUMN IF NOT EXISTS "countsInSimulatedProductCost" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "ProjectStructureLine_parentLineId_idx" ON "ProjectStructureLine"("parentLineId");
CREATE INDEX IF NOT EXISTS "ProjectStructureLine_snapshotRootProductId_idx" ON "ProjectStructureLine"("snapshotRootProductId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProjectStructureLine_parentLineId_fkey'
  ) THEN
    ALTER TABLE "ProjectStructureLine"
      ADD CONSTRAINT "ProjectStructureLine_parentLineId_fkey"
      FOREIGN KEY ("parentLineId") REFERENCES "ProjectStructureLine"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;
