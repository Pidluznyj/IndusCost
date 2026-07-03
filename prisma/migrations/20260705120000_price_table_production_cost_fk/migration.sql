-- AlterTable: PriceTableVersion — FK para tabela de custo de produção usada na geração
ALTER TABLE "PriceTableVersion" ADD COLUMN "productionCostTableVersionId" UUID;

CREATE INDEX "PriceTableVersion_productionCostTableVersionId_idx" ON "PriceTableVersion"("productionCostTableVersionId");

ALTER TABLE "PriceTableVersion" ADD CONSTRAINT "PriceTableVersion_productionCostTableVersionId_fkey" FOREIGN KEY ("productionCostTableVersionId") REFERENCES "ProductionCostTableVersion"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
