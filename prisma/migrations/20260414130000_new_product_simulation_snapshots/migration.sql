-- CreateEnum
CREATE TYPE "NewProductSimulationStatus" AS ENUM ('DRAFT', 'SAVED');

-- CreateTable
CREATE TABLE "NewProductSimulation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "status" "NewProductSimulationStatus" NOT NULL DEFAULT 'SAVED',
    "sourceSimulationId" UUID,
    "productName" TEXT NOT NULL,
    "productSku" TEXT,
    "notes" TEXT,
    "snapshot" JSONB NOT NULL,
    "savedAt" TIMESTAMPTZ(6),
    "createdBy" TEXT,
    "origin" TEXT,
    "createdAt" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewProductSimulation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_NewProductSimulation_status_createdAt" ON "NewProductSimulation"("status", "createdAt");
