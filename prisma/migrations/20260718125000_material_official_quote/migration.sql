-- Cotação oficial de referência por matéria-prima + auditoria de alterações.

ALTER TABLE "MaterialMarketQuote"
ADD COLUMN "isOfficialReference" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "MaterialMarketQuote_one_official_per_material_idx"
ON "MaterialMarketQuote" ("materialId")
WHERE "isOfficialReference" = true;

CREATE INDEX "MaterialMarketQuote_materialId_isOfficialReference_idx"
ON "MaterialMarketQuote" ("materialId", "isOfficialReference");

CREATE TABLE "MaterialOfficialQuoteAudit" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "materialId" UUID NOT NULL,
    "previousQuoteId" UUID,
    "newQuoteId" UUID NOT NULL,
    "changedBy" TEXT,
    "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "MaterialOfficialQuoteAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialOfficialQuoteAudit_materialId_idx" ON "MaterialOfficialQuoteAudit"("materialId");
CREATE INDEX "MaterialOfficialQuoteAudit_changedAt_idx" ON "MaterialOfficialQuoteAudit"("changedAt");

ALTER TABLE "MaterialOfficialQuoteAudit"
ADD CONSTRAINT "MaterialOfficialQuoteAudit_materialId_fkey"
FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
