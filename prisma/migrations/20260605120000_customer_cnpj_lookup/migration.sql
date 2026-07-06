-- Customer CNPJ public lookup cache and commercial intelligence history
CREATE TABLE "CustomerCnpjLookup" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cnpj" TEXT NOT NULL,
    "customerId" UUID,
    "source" TEXT NOT NULL DEFAULT 'publica.cnpj.ws',
    "rawJson" JSONB NOT NULL,
    "normalizedSummary" JSONB NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "riskVerdict" TEXT NOT NULL,
    "riskDetails" JSONB NOT NULL,
    "commercialInsights" JSONB NOT NULL,
    "fetchedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "fetchedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCnpjLookup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerCnpjLookup_cnpj_idx" ON "CustomerCnpjLookup"("cnpj");
CREATE INDEX "CustomerCnpjLookup_customerId_idx" ON "CustomerCnpjLookup"("customerId");
CREATE INDEX "CustomerCnpjLookup_fetchedAt_idx" ON "CustomerCnpjLookup"("fetchedAt");
CREATE INDEX "CustomerCnpjLookup_expiresAt_idx" ON "CustomerCnpjLookup"("expiresAt");

ALTER TABLE "CustomerCnpjLookup" ADD CONSTRAINT "CustomerCnpjLookup_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
