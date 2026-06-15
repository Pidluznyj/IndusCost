ALTER TABLE "ProjectCostAmortization"
  ALTER COLUMN "sourceId" TYPE TEXT USING "sourceId"::TEXT;

ALTER TABLE "ProjectCostAmortization"
  ALTER COLUMN "sourceBatchId" TYPE TEXT USING "sourceBatchId"::TEXT;
