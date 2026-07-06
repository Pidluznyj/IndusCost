-- AlterTable: ProductionCostTableVersion — FK para tabela de MP usada na geração
ALTER TABLE "ProductionCostTableVersion" ADD COLUMN "materialCostTableVersionId" UUID;

CREATE INDEX "ProductionCostTableVersion_materialCostTableVersionId_idx" ON "ProductionCostTableVersion"("materialCostTableVersionId");

ALTER TABLE "ProductionCostTableVersion" ADD CONSTRAINT "ProductionCostTableVersion_materialCostTableVersionId_fkey" FOREIGN KEY ("materialCostTableVersionId") REFERENCES "MaterialCostTableVersion"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
