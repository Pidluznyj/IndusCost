-- Preço unitário acordado com o cliente (proposta comercial).
-- Null = usar o preço sugerido com amortização.
ALTER TABLE "ProjectPricingItem"
ADD COLUMN "agreedCustomerPrice" DECIMAL(20,6);
