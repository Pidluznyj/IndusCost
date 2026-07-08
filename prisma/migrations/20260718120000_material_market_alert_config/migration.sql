-- Configuração global e por material para limiares de alertas de mercado.

CREATE TYPE "MaterialMarketAlertConfigScope" AS ENUM ('GLOBAL', 'MATERIAL');

CREATE TABLE "MaterialMarketAlertGlobalConfig" (
    "id" TEXT NOT NULL DEFAULT 'GLOBAL',
    "risePercentThreshold" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "fallPercentThreshold" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "daysWithoutQuote" INTEGER NOT NULL DEFAULT 90,
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,

    CONSTRAINT "MaterialMarketAlertGlobalConfig_pkey" PRIMARY KEY ("id")
);

INSERT INTO "MaterialMarketAlertGlobalConfig" ("id")
VALUES ('GLOBAL')
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "MaterialMarketAlertConfig" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "materialId" UUID NOT NULL,
    "risePercentThreshold" DECIMAL(10,2),
    "fallPercentThreshold" DECIMAL(10,2),
    "daysWithoutQuote" INTEGER,
    "alertsEnabled" BOOLEAN,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT,

    CONSTRAINT "MaterialMarketAlertConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialMarketAlertConfig_materialId_key" ON "MaterialMarketAlertConfig"("materialId");

ALTER TABLE "MaterialMarketAlertConfig"
ADD CONSTRAINT "MaterialMarketAlertConfig_materialId_fkey"
FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE TABLE "MaterialMarketAlertConfigAudit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" "MaterialMarketAlertConfigScope" NOT NULL,
    "materialId" UUID,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialMarketAlertConfigAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialMarketAlertConfigAudit_scope_createdAt_idx"
ON "MaterialMarketAlertConfigAudit"("scope", "createdAt" DESC);

CREATE INDEX "MaterialMarketAlertConfigAudit_materialId_createdAt_idx"
ON "MaterialMarketAlertConfigAudit"("materialId", "createdAt" DESC);
