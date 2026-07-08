-- Trilha unificada de auditoria — Inteligência de Mercado (append-only).

CREATE TYPE "MaterialMarketAuditEntityType" AS ENUM (
  'QUOTE',
  'ALERT_CONFIG',
  'OFFICIAL_QUOTE',
  'APPROVAL',
  'GLOBAL_CONFIG',
  'PURCHASE_LINK'
);

CREATE TYPE "MaterialMarketAuditEventType" AS ENUM (
  'CREATED',
  'UPDATED',
  'PRICE_CHANGED',
  'SUPPLIER_CHANGED',
  'EXCHANGE_CHANGED',
  'STATUS_CHANGED',
  'APPROVED',
  'REJECTED',
  'SET_OFFICIAL',
  'REPLACED',
  'CONFIG_CHANGED',
  'SUBMITTED_FOR_APPROVAL',
  'MONITORING_CHANGED',
  'ALERT_STATUS_CHANGED',
  'PURCHASE_LINKED'
);

CREATE TABLE "MaterialMarketAuditEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "materialId" UUID,
    "entityType" "MaterialMarketAuditEntityType" NOT NULL,
    "entityId" TEXT,
    "eventType" "MaterialMarketAuditEventType" NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "metadata" JSONB,

    CONSTRAINT "MaterialMarketAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialMarketAuditEvent_materialId_occurredAt_idx"
ON "MaterialMarketAuditEvent"("materialId", "occurredAt" DESC);

CREATE INDEX "MaterialMarketAuditEvent_entityType_entityId_idx"
ON "MaterialMarketAuditEvent"("entityType", "entityId");

CREATE INDEX "MaterialMarketAuditEvent_eventType_idx"
ON "MaterialMarketAuditEvent"("eventType");

ALTER TABLE "MaterialMarketAuditEvent"
ADD CONSTRAINT "MaterialMarketAuditEvent_materialId_fkey"
FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
