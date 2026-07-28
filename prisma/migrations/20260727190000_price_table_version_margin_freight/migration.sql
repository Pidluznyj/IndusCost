-- Margem-alvo e frete % auditáveis por versão de tabela comercial.
-- Null preserva versões legadas (cálculo original sem frete percentual).

ALTER TABLE "PriceTableVersion"
ADD COLUMN IF NOT EXISTS "targetMarginPercent" DECIMAL(10,6),
ADD COLUMN IF NOT EXISTS "freightPercent" DECIMAL(10,6);
