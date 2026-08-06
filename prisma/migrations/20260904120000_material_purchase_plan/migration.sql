-- Anotações manuais de compra do Planejamento de Matéria-Prima (uma por material):
-- data da compra, previsão de chegada e nº do pedido de compra (alfanumérico livre).
CREATE TABLE "MaterialPurchasePlan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "materialId" UUID NOT NULL,
    "purchaseDate" DATE,
    "expectedArrivalDate" DATE,
    "purchaseOrderRef" TEXT,
    "updatedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialPurchasePlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MaterialPurchasePlan_materialId_key" ON "MaterialPurchasePlan"("materialId");

CREATE INDEX "MaterialPurchasePlan_purchaseOrderRef_idx" ON "MaterialPurchasePlan"("purchaseOrderRef");

ALTER TABLE "MaterialPurchasePlan" ADD CONSTRAINT "MaterialPurchasePlan_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
