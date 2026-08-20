-- FASE 2C — Device Registry do Stock Collector.
-- Aditiva: cria somente a tabela nova. Zero DROP, zero backfill, nenhuma
-- coluna existente alterada. Não toca Material, Nomus*, InventoryBalance,
-- InventoryMovement, InventoryCountObservation ou InventoryCountOperation.

CREATE TABLE "InventoryCollectorDevice" (
  "id"                    UUID           NOT NULL DEFAULT gen_random_uuid(),
  "name"                  TEXT           NOT NULL,
  "tailscaleStableNodeId" TEXT           NOT NULL,
  "active"                BOOLEAN        NOT NULL DEFAULT true,
  "tailscaleNodeName"     TEXT,
  "tailscaleLoginName"    TEXT,
  "lastSeenIp"            TEXT,
  "lastSeenAt"            TIMESTAMPTZ(6),
  "createdByUserId"       TEXT,
  "disabledAt"            TIMESTAMPTZ(6),
  "disabledByUserId"      TEXT,
  "createdAt"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "InventoryCollectorDevice_pkey" PRIMARY KEY ("id")
);

-- Chave de autorização: stable node id do Tailscale.
CREATE UNIQUE INDEX "InventoryCollectorDevice_tailscaleStableNodeId_key"
  ON "InventoryCollectorDevice"("tailscaleStableNodeId");

CREATE INDEX "InventoryCollectorDevice_active_idx"
  ON "InventoryCollectorDevice"("active");
