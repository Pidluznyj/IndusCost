-- OP-14.1: datas oficiais do GET /rest/ordens (aditivo).
-- releasedAt ← dataHoraLiberacao; deliveryAt ← dataHoraEntrega.
-- closedAt permanece; não backfill a partir de dataHoraEntrega.

ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP(3);
ALTER TABLE "NomusProductionOrder" ADD COLUMN IF NOT EXISTS "deliveryAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "NomusProductionOrder_releasedAt_idx" ON "NomusProductionOrder"("releasedAt");
CREATE INDEX IF NOT EXISTS "NomusProductionOrder_plannedAt_idx" ON "NomusProductionOrder"("plannedAt");
CREATE INDEX IF NOT EXISTS "NomusProductionOrder_deliveryAt_idx" ON "NomusProductionOrder"("deliveryAt");
CREATE INDEX IF NOT EXISTS "NomusProductionOrder_nomusUpdatedAt_idx" ON "NomusProductionOrder"("nomusUpdatedAt");
