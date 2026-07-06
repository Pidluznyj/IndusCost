-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('RASCUNHO', 'ABERTA', 'CANCELADA', 'ENCERRADA');

-- CreateEnum
CREATE TYPE "PurchasePriority" AS ENUM ('BAIXA', 'NORMAL', 'ALTA', 'URGENTE');

-- CreateEnum
CREATE TYPE "PurchaseLineType" AS ENUM ('MATERIA_PRIMA', 'INDIRETO');

-- CreateEnum
CREATE TYPE "PurchaseItemLineStatus" AS ENUM ('ABERTA', 'CANCELADA');

-- CreateTable
CREATE TABLE "CostCenter" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostCenter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" SERIAL NOT NULL,
    "requester" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "requestCategory" TEXT,
    "priority" "PurchasePriority" NOT NULL DEFAULT 'NORMAL',
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'RASCUNHO',
    "justification" TEXT NOT NULL,
    "defaultCostCenterId" UUID NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseRequestItem" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchaseRequestId" UUID NOT NULL,
    "lineType" "PurchaseLineType" NOT NULL,
    "materialId" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" TEXT NOT NULL,
    "costCenterId" UUID,
    "desiredDate" TIMESTAMPTZ(6),
    "priority" "PurchasePriority",
    "notes" TEXT,
    "suggestedSupplier" TEXT,
    "lineStatus" "PurchaseItemLineStatus" NOT NULL DEFAULT 'ABERTA',

    CONSTRAINT "PurchaseRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_code_key" ON "CostCenter"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseRequest_number_key" ON "PurchaseRequest"("number");

-- CreateIndex
CREATE INDEX "PurchaseRequest_status_idx" ON "PurchaseRequest"("status");

-- CreateIndex
CREATE INDEX "PurchaseRequest_defaultCostCenterId_idx" ON "PurchaseRequest"("defaultCostCenterId");

-- CreateIndex
CREATE INDEX "PurchaseRequestItem_purchaseRequestId_idx" ON "PurchaseRequestItem"("purchaseRequestId");

-- CreateIndex
CREATE INDEX "PurchaseRequestItem_materialId_idx" ON "PurchaseRequestItem"("materialId");

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_defaultCostCenterId_fkey" FOREIGN KEY ("defaultCostCenterId") REFERENCES "CostCenter"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PurchaseRequestItem" ADD CONSTRAINT "PurchaseRequestItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
