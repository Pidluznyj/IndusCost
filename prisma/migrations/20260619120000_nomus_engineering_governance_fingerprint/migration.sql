-- Persistência de fingerprint da estrutura Nomus para decisões de engenharia
ALTER TABLE "NomusOptionalPricingGroup" ADD COLUMN "nomusStructureFingerprint" TEXT;

ALTER TABLE "NomusBomReviewDecision" ADD COLUMN "nomusStructureFingerprint" TEXT;

CREATE INDEX "NomusOptionalPricingGroup_nomusStructureFingerprint_idx" ON "NomusOptionalPricingGroup"("nomusStructureFingerprint");

CREATE INDEX "NomusBomReviewDecision_nomusStructureFingerprint_idx" ON "NomusBomReviewDecision"("nomusStructureFingerprint");
