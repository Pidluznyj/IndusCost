-- OP-55 — observedAt no evento do Fluxo de Pedidos (timeline).
-- Aditiva: não altera SalesOrder / SalesOrderItem oficiais.

ALTER TABLE "SalesOrderFlowEvent" ADD COLUMN "observedAt" TIMESTAMPTZ(6);

CREATE INDEX "SalesOrderFlowEvent_observedAt_idx" ON "SalesOrderFlowEvent"("observedAt");
