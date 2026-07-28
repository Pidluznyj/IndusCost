-- Quantidade de referência no cadastro de matéria-prima (Suprimentos).
-- Valor total = quantity × currentCost (custo da unidade de medida).
-- Não altera fórmulas de custo posto fábrica / efetivo / BOM.
ALTER TABLE "Material"
  ADD COLUMN IF NOT EXISTS "quantity" DECIMAL(20, 6) NOT NULL DEFAULT 0;
