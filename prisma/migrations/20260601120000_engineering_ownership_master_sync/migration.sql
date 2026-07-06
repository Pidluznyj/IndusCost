-- Ownership de engenharia: Nomus x IndusCost
-- Não remove dados existentes. Default seguro: produtos antigos continuam locais até o primeiro sync de engenharia.

-- Product: campos de origem/controle
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "sourceSystem"        TEXT,
  ADD COLUMN IF NOT EXISTS "sourceExternalId"    TEXT,
  ADD COLUMN IF NOT EXISTS "isNomusControlled"   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "lastNomusSyncAt"     TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "nomusPayloadHash"    TEXT;

CREATE INDEX IF NOT EXISTS "idx_Product_isNomusControlled"
  ON "Product"("isNomusControlled");
CREATE INDEX IF NOT EXISTS "idx_Product_sourceSystem"
  ON "Product"("sourceSystem");

-- ProductBOM: campos de origem/controle e exceção local
ALTER TABLE "ProductBOM"
  ADD COLUMN IF NOT EXISTS "sourceSystem"        TEXT,
  ADD COLUMN IF NOT EXISTS "isNomusControlled"   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "localException"      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "lastNomusSyncAt"     TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "nomusComponentCode"  TEXT;

CREATE INDEX IF NOT EXISTS "idx_ProductBOM_isNomusControlled"
  ON "ProductBOM"("isNomusControlled");
CREATE INDEX IF NOT EXISTS "idx_ProductBOM_localException"
  ON "ProductBOM"("localException");

-- EngineeringSyncRun: cabeçalho de execuções de sincronização de engenharia
CREATE TYPE "EngineeringSyncRunMode" AS ENUM ('ONE_PRODUCT', 'ALL_NOMUS_PRODUCTS');
CREATE TYPE "EngineeringSyncRunStatus" AS ENUM ('PREVIEWED', 'APPLIED', 'FAILED', 'PARTIAL');

CREATE TABLE "EngineeringSyncRun" (
    "id"               TEXT NOT NULL,
    "mode"             "EngineeringSyncRunMode" NOT NULL DEFAULT 'ONE_PRODUCT',
    "status"           "EngineeringSyncRunStatus" NOT NULL DEFAULT 'PREVIEWED',
    "parentCode"       TEXT,
    "planHash"         TEXT NOT NULL,
    "confirmationText" TEXT,
    "approvedBy"       TEXT,
    "startedAt"        TIMESTAMP(3),
    "finishedAt"       TIMESTAMP(3),
    "summaryJson"      JSONB,
    "warningsJson"     JSONB,
    "errorsJson"       JSONB,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EngineeringSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EngineeringSyncRun_parentCode_idx" ON "EngineeringSyncRun"("parentCode");
CREATE INDEX "EngineeringSyncRun_status_idx"     ON "EngineeringSyncRun"("status");
CREATE INDEX "EngineeringSyncRun_planHash_idx"   ON "EngineeringSyncRun"("planHash");
CREATE INDEX "EngineeringSyncRun_createdAt_idx"  ON "EngineeringSyncRun"("createdAt");

-- EngineeringChangeLog: log antes/depois por campo/linha
CREATE TYPE "EngineeringChangeEntityType" AS ENUM ('PRODUCT', 'PRODUCT_BOM', 'MATERIAL', 'ROUTING', 'PRICE_INPUT');
CREATE TYPE "EngineeringChangeOrigin"   AS ENUM ('NOMUS_SYNC', 'NOMUS_ENGINEERING_APPLY', 'MANUAL_EDIT', 'LOCAL_EXCEPTION');

CREATE TABLE "EngineeringChangeLog" (
    "id"            TEXT NOT NULL,
    "entityType"    "EngineeringChangeEntityType" NOT NULL,
    "entityId"      TEXT,
    "productId"     UUID,
    "productSku"    TEXT,
    "sourceSystem"  TEXT,
    "changeOrigin"  "EngineeringChangeOrigin" NOT NULL,
    "fieldName"     TEXT,
    "oldValue"      TEXT,
    "newValue"      TEXT,
    "oldValueJson"  JSONB,
    "newValueJson"  JSONB,
    "changedBy"     TEXT,
    "changedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "runId"         TEXT,
    "planHash"      TEXT,
    "reason"        TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EngineeringChangeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EngineeringChangeLog_productId_idx"    ON "EngineeringChangeLog"("productId");
CREATE INDEX "EngineeringChangeLog_productSku_idx"   ON "EngineeringChangeLog"("productSku");
CREATE INDEX "EngineeringChangeLog_entityType_idx"   ON "EngineeringChangeLog"("entityType");
CREATE INDEX "EngineeringChangeLog_changeOrigin_idx" ON "EngineeringChangeLog"("changeOrigin");
CREATE INDEX "EngineeringChangeLog_changedAt_idx"    ON "EngineeringChangeLog"("changedAt");
CREATE INDEX "EngineeringChangeLog_runId_idx"        ON "EngineeringChangeLog"("runId");

ALTER TABLE "EngineeringChangeLog"
  ADD CONSTRAINT "EngineeringChangeLog_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "EngineeringSyncRun"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
