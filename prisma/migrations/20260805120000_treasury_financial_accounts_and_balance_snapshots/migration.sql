-- Central de Tesouraria — contas financeiras, ACL por usuário e snapshots de saldo.
-- Aditiva e reversível: DROP TABLE/TYPE na ordem inversa. Não altera models existentes.
-- Não aplicar em produção via Cursor — usuário executa migrate deploy.

CREATE TYPE "TreasuryFinancialAccountType" AS ENUM (
  'CHECKING',
  'SAVINGS',
  'CASH',
  'INVESTMENT',
  'OTHER'
);

CREATE TYPE "TreasuryCurrencyCode" AS ENUM (
  'BRL'
);

CREATE TYPE "TreasuryAccountLiquidity" AS ENUM (
  'IMMEDIATE',
  'D_PLUS_1',
  'D_PLUS_N',
  'TERM',
  'ILLIQUID'
);

CREATE TYPE "TreasuryBalanceOrigin" AS ENUM (
  'MANUAL',
  'OFX',
  'CLOSING',
  'SYSTEM',
  'IMPORT'
);

CREATE TYPE "TreasuryAccountAccessLevel" AS ENUM (
  'VIEW',
  'OPERATE',
  'MANAGE'
);

CREATE TABLE "TreasuryFinancialAccount" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyCode" TEXT NOT NULL,
  "companyName" TEXT,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "institutionName" TEXT NOT NULL,
  "institutionCode" TEXT,
  "accountType" "TreasuryFinancialAccountType" NOT NULL,
  "currency" "TreasuryCurrencyCode" NOT NULL DEFAULT 'BRL',
  "agencyMasked" TEXT NOT NULL,
  "accountNumberMasked" TEXT NOT NULL,
  "includeInConsolidated" BOOLEAN NOT NULL DEFAULT true,
  "minimumBalance" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "allowNegativeBalance" BOOLEAN NOT NULL DEFAULT false,
  "liquidity" "TreasuryAccountLiquidity" NOT NULL DEFAULT 'IMMEDIATE',
  "defaultBalanceOrigin" "TreasuryBalanceOrigin" NOT NULL DEFAULT 'MANUAL',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "nomusBankAccountId" TEXT,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deactivatedAt" TIMESTAMPTZ(6),
  "deactivatedByUserId" UUID,
  "deactivationReason" TEXT,

  CONSTRAINT "TreasuryFinancialAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TreasuryFinancialAccountAccess" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "accessLevel" "TreasuryAccountAccessLevel" NOT NULL DEFAULT 'VIEW',
  "canViewBalance" BOOLEAN NOT NULL DEFAULT true,
  "canMutateBalance" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "grantedByUserId" UUID,
  "grantedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(6),
  "notes" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryFinancialAccountAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TreasuryBalanceSnapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "referenceAt" TIMESTAMPTZ(6) NOT NULL,
  "availableBalance" DECIMAL(20, 2) NOT NULL,
  "blockedBalance" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "investmentsBalance" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "usedLimit" DECIMAL(20, 2) NOT NULL DEFAULT 0,
  "origin" "TreasuryBalanceOrigin" NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "notes" TEXT,
  "attachmentUrl" TEXT,
  "createdByUserId" UUID NOT NULL,
  "previousSnapshotId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryBalanceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryFinancialAccount_companyCode_code_key"
  ON "TreasuryFinancialAccount"("companyCode", "code");

CREATE INDEX "TreasuryFinancialAccount_companyCode_idx"
  ON "TreasuryFinancialAccount"("companyCode");

CREATE INDEX "TreasuryFinancialAccount_isActive_idx"
  ON "TreasuryFinancialAccount"("isActive");

CREATE INDEX "TreasuryFinancialAccount_sortOrder_idx"
  ON "TreasuryFinancialAccount"("sortOrder");

CREATE INDEX "TreasuryFinancialAccount_accountType_idx"
  ON "TreasuryFinancialAccount"("accountType");

CREATE INDEX "TreasuryFinancialAccount_includeInConsolidated_idx"
  ON "TreasuryFinancialAccount"("includeInConsolidated");

CREATE INDEX "TreasuryFinancialAccount_createdByUserId_idx"
  ON "TreasuryFinancialAccount"("createdByUserId");

CREATE INDEX "TreasuryFinancialAccount_deactivatedByUserId_idx"
  ON "TreasuryFinancialAccount"("deactivatedByUserId");

CREATE INDEX "TreasuryFinancialAccount_nomusBankAccountId_idx"
  ON "TreasuryFinancialAccount"("nomusBankAccountId");

CREATE UNIQUE INDEX "TreasuryFinancialAccountAccess_accountId_userId_key"
  ON "TreasuryFinancialAccountAccess"("accountId", "userId");

CREATE INDEX "TreasuryFinancialAccountAccess_userId_idx"
  ON "TreasuryFinancialAccountAccess"("userId");

CREATE INDEX "TreasuryFinancialAccountAccess_accountId_idx"
  ON "TreasuryFinancialAccountAccess"("accountId");

CREATE INDEX "TreasuryFinancialAccountAccess_isActive_idx"
  ON "TreasuryFinancialAccountAccess"("isActive");

CREATE INDEX "TreasuryFinancialAccountAccess_accessLevel_idx"
  ON "TreasuryFinancialAccountAccess"("accessLevel");

CREATE INDEX "TreasuryFinancialAccountAccess_grantedByUserId_idx"
  ON "TreasuryFinancialAccountAccess"("grantedByUserId");

CREATE UNIQUE INDEX "TreasuryBalanceSnapshot_accountId_origin_idempotencyKey_key"
  ON "TreasuryBalanceSnapshot"("accountId", "origin", "idempotencyKey");

CREATE INDEX "TreasuryBalanceSnapshot_accountId_referenceAt_idx"
  ON "TreasuryBalanceSnapshot"("accountId", "referenceAt");

CREATE INDEX "TreasuryBalanceSnapshot_origin_idx"
  ON "TreasuryBalanceSnapshot"("origin");

CREATE INDEX "TreasuryBalanceSnapshot_createdByUserId_idx"
  ON "TreasuryBalanceSnapshot"("createdByUserId");

CREATE INDEX "TreasuryBalanceSnapshot_previousSnapshotId_idx"
  ON "TreasuryBalanceSnapshot"("previousSnapshotId");

CREATE INDEX "TreasuryBalanceSnapshot_createdAt_idx"
  ON "TreasuryBalanceSnapshot"("createdAt");

ALTER TABLE "TreasuryFinancialAccount"
  ADD CONSTRAINT "TreasuryFinancialAccount_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryFinancialAccount"
  ADD CONSTRAINT "TreasuryFinancialAccount_deactivatedByUserId_fkey"
  FOREIGN KEY ("deactivatedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryFinancialAccountAccess"
  ADD CONSTRAINT "TreasuryFinancialAccountAccess_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TreasuryFinancialAccountAccess"
  ADD CONSTRAINT "TreasuryFinancialAccountAccess_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "AppUser"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TreasuryFinancialAccountAccess"
  ADD CONSTRAINT "TreasuryFinancialAccountAccess_grantedByUserId_fkey"
  FOREIGN KEY ("grantedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryBalanceSnapshot"
  ADD CONSTRAINT "TreasuryBalanceSnapshot_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryBalanceSnapshot"
  ADD CONSTRAINT "TreasuryBalanceSnapshot_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryBalanceSnapshot"
  ADD CONSTRAINT "TreasuryBalanceSnapshot_previousSnapshotId_fkey"
  FOREIGN KEY ("previousSnapshotId") REFERENCES "TreasuryBalanceSnapshot"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
