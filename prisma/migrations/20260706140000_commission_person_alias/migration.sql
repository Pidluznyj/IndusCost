-- Aliases auditáveis de vendedor Nomus → pessoa comissionada canônica.
-- Justificativa: múltiplos rawSellerId (ex.: Gislene 464 e sem ID) precisam
-- mapear deterministicamente sem alterar pedidos/NF/CR originais.

CREATE TYPE "CommissionPersonAliasStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PENDING');

CREATE TYPE "CommissionPersonAliasSource" AS ENUM (
  'NOMUS_ORDER',
  'NOMUS_NFE',
  'NOMUS_AR',
  'COMMISSION_RECORD',
  'MANUAL',
  'IMPORT',
  'OTHER'
);

CREATE TABLE "CommissionPersonAlias" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "commissionedPersonId" UUID NOT NULL,
  "source" "CommissionPersonAliasSource" NOT NULL DEFAULT 'MANUAL',
  "rawSellerId" INTEGER,
  "rawSellerName" TEXT NOT NULL,
  "normalizedSellerName" TEXT NOT NULL,
  "status" "CommissionPersonAliasStatus" NOT NULL DEFAULT 'ACTIVE',
  "confidence" DECIMAL(5, 4),
  "notes" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CommissionPersonAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommissionPersonAlias_commissionedPersonId_fkey"
    FOREIGN KEY ("commissionedPersonId") REFERENCES "CommissionPerson"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CommissionPersonAlias_commissionedPersonId_idx" ON "CommissionPersonAlias"("commissionedPersonId");
CREATE INDEX "CommissionPersonAlias_rawSellerId_idx" ON "CommissionPersonAlias"("rawSellerId");
CREATE INDEX "CommissionPersonAlias_normalizedSellerName_idx" ON "CommissionPersonAlias"("normalizedSellerName");
CREATE INDEX "CommissionPersonAlias_status_idx" ON "CommissionPersonAlias"("status");
CREATE INDEX "CommissionPersonAlias_source_rawSellerId_idx" ON "CommissionPersonAlias"("source", "rawSellerId");

CREATE UNIQUE INDEX "CommissionPersonAlias_source_rawSellerId_active_key"
  ON "CommissionPersonAlias"("source", "rawSellerId")
  WHERE "rawSellerId" IS NOT NULL AND "status" = 'ACTIVE';
