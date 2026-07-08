-- Campos de confiabilidade aplicada vs sugerida e override manual.

ALTER TABLE "MaterialMarketQuote"
  ADD COLUMN IF NOT EXISTS "reliabilityLevel" "MaterialMarketQuoteReliabilityLevel",
  ADD COLUMN IF NOT EXISTS "reliabilitySuggestedLevel" "MaterialMarketQuoteReliabilityLevel",
  ADD COLUMN IF NOT EXISTS "reliabilityOverrideReason" TEXT,
  ADD COLUMN IF NOT EXISTS "reliabilitySetBy" TEXT,
  ADD COLUMN IF NOT EXISTS "reliabilitySetAt" TIMESTAMPTZ(6);

UPDATE "MaterialMarketQuote"
SET
  "reliabilitySuggestedLevel" = COALESCE("reliabilitySuggestedLevel", "suggestedReliabilityLevel"),
  "reliabilityLevel" = COALESCE("reliabilityLevel", "suggestedReliabilityLevel", 'MANUAL'::"MaterialMarketQuoteReliabilityLevel")
WHERE "suggestedReliabilityLevel" IS NOT NULL
   OR "reliabilitySuggestedLevel" IS NULL;
