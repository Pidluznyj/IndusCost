-- Decisão de crédito comercial.
-- Aditiva: exceção formal, vínculo societário e protesto externo.
-- Não altera Contas a Receber, cliente oficial nem pedido já existente.

CREATE TABLE IF NOT EXISTS "CommercialCreditException" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  "scope" TEXT NOT NULL,
  "justification" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "grantedByUserId" TEXT NOT NULL,
  "grantedByPermission" TEXT NOT NULL,
  "activeKey" TEXT NOT NULL DEFAULT 'ACTIVE',
  "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialCreditException_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialCreditException_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "CommercialCreditException_customerId_scope_activeKey_key"
  ON "CommercialCreditException"("customerId", "scope", "activeKey");
CREATE INDEX IF NOT EXISTS "CommercialCreditException_customerId_expiresAt_idx"
  ON "CommercialCreditException"("customerId", "expiresAt");

CREATE TABLE IF NOT EXISTS "CustomerCorporateLink" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  "relatedCustomerId" UUID NOT NULL,
  "evidenceRef" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerCorporateLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerCorporateLink_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "CustomerCorporateLink_relatedCustomerId_fkey"
    FOREIGN KEY ("relatedCustomerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerCorporateLink_customerId_relatedCustomerId_key"
  ON "CustomerCorporateLink"("customerId", "relatedCustomerId");
CREATE INDEX IF NOT EXISTS "CustomerCorporateLink_relatedCustomerId_idx"
  ON "CustomerCorporateLink"("relatedCustomerId");

CREATE TABLE IF NOT EXISTS "CommercialExternalProtest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "customerId" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "evidenceRef" TEXT NOT NULL,
  "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
  "effectiveUntil" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialExternalProtest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialExternalProtest_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX IF NOT EXISTS "CommercialExternalProtest_customerId_effectiveFrom_idx"
  ON "CommercialExternalProtest"("customerId", "effectiveFrom");
