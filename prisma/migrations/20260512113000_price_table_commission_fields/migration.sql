-- ETAPA C2: campos estruturados de comissao de vendedor em PriceTableVersion e PriceTableItem
-- Aditivo, retrocompativel, sem FK, sem enum, sem backfill, sem indices.

-- PriceTableVersion: comissao padrao informada na geracao desta versao (opcional).
ALTER TABLE "PriceTableVersion" ADD COLUMN "commissionPerc" DECIMAL(10,6);

-- PriceTableItem: comissao aplicada por item (taxa e valor por unidade), default 0 para itens existentes.
ALTER TABLE "PriceTableItem" ADD COLUMN "commissionPerc" DECIMAL(10,6) NOT NULL DEFAULT 0;
ALTER TABLE "PriceTableItem" ADD COLUMN "commissionValue" DECIMAL(20,6) NOT NULL DEFAULT 0;
