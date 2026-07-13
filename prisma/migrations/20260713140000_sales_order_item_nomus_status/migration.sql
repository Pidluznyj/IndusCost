-- Enrich SalesOrderItem with Nomus item status (itensPedido[].status).
-- status 4 = Atendido totalmente → FULFILLED; status 6 = Cancelado → CANCELED.

ALTER TABLE "SalesOrderItem"
  ADD COLUMN IF NOT EXISTS "nomusItemExternalId" INTEGER,
  ADD COLUMN IF NOT EXISTS "nomusItemSequence" TEXT,
  ADD COLUMN IF NOT EXISTS "nomusItemStatusRaw" TEXT,
  ADD COLUMN IF NOT EXISTS "nomusItemStatusNormalized" TEXT,
  ADD COLUMN IF NOT EXISTS "nomusQuantityFulfilled" DECIMAL(20, 6),
  ADD COLUMN IF NOT EXISTS "nomusQuantityPending" DECIMAL(20, 6),
  ADD COLUMN IF NOT EXISTS "nomusIsCanceled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "nomusIsStale" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "nomusLastSeenAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nomusRawItem" JSONB;

CREATE INDEX IF NOT EXISTS "SalesOrderItem_nomusItemExternalId_idx"
  ON "SalesOrderItem"("nomusItemExternalId");

CREATE INDEX IF NOT EXISTS "SalesOrderItem_nomusIsCanceled_idx"
  ON "SalesOrderItem"("nomusIsCanceled");

CREATE INDEX IF NOT EXISTS "SalesOrderItem_nomusIsStale_idx"
  ON "SalesOrderItem"("nomusIsStale");
