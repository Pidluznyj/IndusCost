-- Snapshots diários PTAX USD/BRL (BCB) para indicadores globais de mercado.

CREATE TYPE "PtaxSnapshotStatus" AS ENUM ('SUCCESS', 'FAILED');

CREATE TABLE "PtaxSnapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "quoteDate" DATE NOT NULL,
    "buyRate" DECIMAL(20,6),
    "sellRate" DECIMAL(20,6),
    "source" TEXT NOT NULL DEFAULT 'BCB PTAX',
    "status" "PtaxSnapshotStatus" NOT NULL,
    "errorMessage" TEXT,
    "collectedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PtaxSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PtaxSnapshot_status_collectedAt_idx" ON "PtaxSnapshot"("status", "collectedAt" DESC);
CREATE INDEX "PtaxSnapshot_quoteDate_idx" ON "PtaxSnapshot"("quoteDate" DESC);
