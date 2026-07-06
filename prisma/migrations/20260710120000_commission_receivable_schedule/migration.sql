-- Rateio da comissão materializada (order snapshot) por título de Contas a Receber.
-- Reversível: DROP TABLE CommissionReceivableSchedule; DROP TYPE CommissionReceivableScheduleStatus;

CREATE TYPE "CommissionReceivableScheduleStatus" AS ENUM (
  'ACTIVE',
  'STALE',
  'SUPERSEDED',
  'ORPHAN',
  'CUSTOMER_EXCLUDED',
  'ERROR'
);

CREATE TABLE "CommissionReceivableSchedule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderSnapshotId" UUID NOT NULL,
  "receivableId" INTEGER NOT NULL,
  "receivableCode" TEXT,
  "installmentNumber" INTEGER NOT NULL,
  "nfeId" INTEGER,
  "salesOrderId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "canonicalSellerId" UUID,
  "receivableNominalAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "receivableSharePercent" DECIMAL(10, 4) NOT NULL DEFAULT 0,
  "scheduledCommissionAmount" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "status" "CommissionReceivableScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
  "sourceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommissionReceivableSchedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommissionReceivableSchedule_sourceHash_key"
  ON "CommissionReceivableSchedule"("sourceHash");

CREATE INDEX "CommissionReceivableSchedule_orderSnapshotId_idx"
  ON "CommissionReceivableSchedule"("orderSnapshotId");
CREATE INDEX "CommissionReceivableSchedule_receivableId_idx"
  ON "CommissionReceivableSchedule"("receivableId");
CREATE INDEX "CommissionReceivableSchedule_salesOrderId_idx"
  ON "CommissionReceivableSchedule"("salesOrderId");
CREATE INDEX "CommissionReceivableSchedule_nfeId_idx"
  ON "CommissionReceivableSchedule"("nfeId");
CREATE INDEX "CommissionReceivableSchedule_customerId_idx"
  ON "CommissionReceivableSchedule"("customerId");
CREATE INDEX "CommissionReceivableSchedule_canonicalSellerId_idx"
  ON "CommissionReceivableSchedule"("canonicalSellerId");
CREATE INDEX "CommissionReceivableSchedule_status_idx"
  ON "CommissionReceivableSchedule"("status");

-- Um schedule ACTIVE por snapshot + título Nomus.
CREATE UNIQUE INDEX "CommissionReceivableSchedule_snapshot_receivable_active_key"
  ON "CommissionReceivableSchedule"("orderSnapshotId", "receivableId")
  WHERE "status" = 'ACTIVE';

ALTER TABLE "CommissionReceivableSchedule"
  ADD CONSTRAINT "CommissionReceivableSchedule_orderSnapshotId_fkey"
  FOREIGN KEY ("orderSnapshotId") REFERENCES "CommissionOrderSnapshot"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "CommissionReceivableSchedule"
  ADD CONSTRAINT "CommissionReceivableSchedule_salesOrderId_fkey"
  FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "CommissionReceivableSchedule"
  ADD CONSTRAINT "CommissionReceivableSchedule_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "CommissionReceivableSchedule"
  ADD CONSTRAINT "CommissionReceivableSchedule_canonicalSellerId_fkey"
  FOREIGN KEY ("canonicalSellerId") REFERENCES "CommissionPerson"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
