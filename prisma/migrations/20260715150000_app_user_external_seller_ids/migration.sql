-- Múltiplos IDs Nomus por usuário (login de vendedor).
ALTER TABLE "AppUser"
ADD COLUMN IF NOT EXISTS "externalSellerIds" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

-- Backfill a partir do ID legado único.
UPDATE "AppUser"
SET "externalSellerIds" = ARRAY["externalSellerId"]
WHERE "externalSellerId" IS NOT NULL
  AND (
    "externalSellerIds" IS NULL
    OR cardinality("externalSellerIds") = 0
  );
