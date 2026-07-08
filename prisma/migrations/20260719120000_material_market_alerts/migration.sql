-- Alertas inteligentes de mercado por matéria-prima monitorada.

CREATE TYPE "MaterialMarketAlertType" AS ENUM (
  'PRICE_UP_PCT',
  'PRICE_DOWN_PCT',
  'BREAK_MAX',
  'BREAK_MIN',
  'NO_RECENT_QUOTE',
  'SUPPLIER_ABOVE_AVG',
  'SAVINGS_OPPORTUNITY'
);

CREATE TYPE "MaterialMarketAlertStatus" AS ENUM ('OPEN', 'READ', 'RESOLVED');

CREATE TYPE "MaterialMarketAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE "MaterialMarketAlert" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "materialId" UUID NOT NULL,
    "alertType" "MaterialMarketAlertType" NOT NULL,
    "status" "MaterialMarketAlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "MaterialMarketAlertSeverity" NOT NULL,
    "metadata" JSONB,
    "triggeredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(6),
    "resolvedAt" TIMESTAMPTZ(6),
    "readBy" TEXT,
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialMarketAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialMarketAlert_materialId_status_idx" ON "MaterialMarketAlert"("materialId", "status");
CREATE INDEX "MaterialMarketAlert_materialId_alertType_status_idx" ON "MaterialMarketAlert"("materialId", "alertType", "status");
CREATE INDEX "MaterialMarketAlert_status_triggeredAt_idx" ON "MaterialMarketAlert"("status", "triggeredAt" DESC);

ALTER TABLE "MaterialMarketAlert" ADD CONSTRAINT "MaterialMarketAlert_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
