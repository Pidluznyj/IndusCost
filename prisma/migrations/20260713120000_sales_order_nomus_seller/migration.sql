-- Vendedor oficial do pedido Nomus (separado do responsável comercial CRM em SalesOrder.responsible legado).
ALTER TABLE "SalesOrder" ADD COLUMN IF NOT EXISTS "nomusSellerName" TEXT;

-- Backfill a partir do payload bruto quando existir nome explícito no pedido Nomus.
UPDATE "SalesOrder"
SET "nomusSellerName" = NULLIF(TRIM("nomusRawResponse"->>'nomeVendedor'), '')
WHERE "nomusRawResponse" IS NOT NULL
  AND ("nomusSellerName" IS NULL OR TRIM("nomusSellerName") = '')
  AND NULLIF(TRIM("nomusRawResponse"->>'nomeVendedor'), '') IS NOT NULL;
