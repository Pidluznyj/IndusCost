-- Compras Bloco 2: contexto adicional em linha de MP (cotação futura / operação), sem alterar Material
ALTER TABLE "PurchaseRequestItem" ADD COLUMN IF NOT EXISTS "supplierReference" TEXT;
ALTER TABLE "PurchaseRequestItem" ADD COLUMN IF NOT EXISTS "packagingPresentation" TEXT;
ALTER TABLE "PurchaseRequestItem" ADD COLUMN IF NOT EXISTS "minOrderQtySuggested" DECIMAL(20, 6);
