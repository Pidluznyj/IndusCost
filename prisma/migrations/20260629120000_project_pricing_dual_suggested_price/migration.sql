-- Persistir preço sugerido sem e com amortização na precificação comercial do projeto.
ALTER TABLE "ProjectPricingItem"
ADD COLUMN "suggestedPriceWithoutAmortization" DECIMAL(20,6),
ADD COLUMN "taxAmountWithoutAmortization" DECIMAL(20,6),
ADD COLUMN "marginAmountWithoutAmortization" DECIMAL(20,6);
