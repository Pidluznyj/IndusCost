-- Central de Tesouraria — fechamento diário versionado (imutável após CLOSED).
-- Models: closing, posição por conta, pendências/exceções congeladas, ressalvas, reabertura.
-- Aditiva: enums + CREATE TABLE + índices + triggers anti UPDATE/DELETE de payload.
-- Não aplicar em produção via Cursor — usuário executa migrate deploy.

CREATE TYPE "TreasuryDailyClosingStatus" AS ENUM (
  'OPEN',
  'CLOSED',
  'REOPENED'
);

CREATE TABLE "TreasuryDailyClosing" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "companyCode" TEXT NOT NULL,
  "civilDate" DATE NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "TreasuryDailyClosingStatus" NOT NULL DEFAULT 'OPEN',
  "sourceHash" TEXT NOT NULL,
  "contentHash" TEXT,
  "openingBalance" DECIMAL(20,2) NOT NULL,
  "realizedInflows" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "realizedOutflows" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "pendenciesAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "closingBalance" DECIMAL(20,2) NOT NULL,
  "observedBalance" DECIMAL(20,2) NOT NULL,
  "reconciledBalance" DECIMAL(20,2) NOT NULL,
  "differenceAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "exceptionsCount" INTEGER NOT NULL DEFAULT 0,
  "exceptionsAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "caveatsCount" INTEGER NOT NULL DEFAULT 0,
  "notes" TEXT,
  "previousClosingId" UUID,
  "supersededByClosingId" UUID,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedByUserId" UUID,
  "closedAt" TIMESTAMPTZ(6),

  CONSTRAINT "TreasuryDailyClosing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryDailyClosing_companyCode_civilDate_version_key"
  ON "TreasuryDailyClosing"("companyCode", "civilDate", "version");

-- Apenas um fechamento corrente (OPEN|CLOSED) por empresa+data; REOPENED permanece histórico.
CREATE UNIQUE INDEX "TreasuryDailyClosing_companyCode_civilDate_current_uidx"
  ON "TreasuryDailyClosing"("companyCode", "civilDate")
  WHERE "status" IN ('OPEN', 'CLOSED');

CREATE INDEX "TreasuryDailyClosing_companyCode_civilDate_status_idx"
  ON "TreasuryDailyClosing"("companyCode", "civilDate", "status");

CREATE INDEX "TreasuryDailyClosing_status_civilDate_idx"
  ON "TreasuryDailyClosing"("status", "civilDate");

CREATE INDEX "TreasuryDailyClosing_sourceHash_idx"
  ON "TreasuryDailyClosing"("sourceHash");

CREATE INDEX "TreasuryDailyClosing_contentHash_idx"
  ON "TreasuryDailyClosing"("contentHash");

CREATE INDEX "TreasuryDailyClosing_previousClosingId_idx"
  ON "TreasuryDailyClosing"("previousClosingId");

CREATE INDEX "TreasuryDailyClosing_supersededByClosingId_idx"
  ON "TreasuryDailyClosing"("supersededByClosingId");

CREATE INDEX "TreasuryDailyClosing_createdByUserId_idx"
  ON "TreasuryDailyClosing"("createdByUserId");

CREATE INDEX "TreasuryDailyClosing_closedByUserId_idx"
  ON "TreasuryDailyClosing"("closedByUserId");

CREATE INDEX "TreasuryDailyClosing_closedAt_idx"
  ON "TreasuryDailyClosing"("closedAt");

ALTER TABLE "TreasuryDailyClosing"
  ADD CONSTRAINT "TreasuryDailyClosing_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryDailyClosing"
  ADD CONSTRAINT "TreasuryDailyClosing_closedByUserId_fkey"
  FOREIGN KEY ("closedByUserId") REFERENCES "AppUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryDailyClosing"
  ADD CONSTRAINT "TreasuryDailyClosing_previousClosingId_fkey"
  FOREIGN KEY ("previousClosingId") REFERENCES "TreasuryDailyClosing"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryDailyClosing"
  ADD CONSTRAINT "TreasuryDailyClosing_supersededByClosingId_fkey"
  FOREIGN KEY ("supersededByClosingId") REFERENCES "TreasuryDailyClosing"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TreasuryDailyClosingAccountPosition" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "closingId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "openingBalance" DECIMAL(20,2) NOT NULL,
  "realizedInflows" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "realizedOutflows" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "pendenciesAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "closingBalance" DECIMAL(20,2) NOT NULL,
  "observedBalance" DECIMAL(20,2) NOT NULL,
  "reconciledBalance" DECIMAL(20,2) NOT NULL,
  "differenceAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryDailyClosingAccountPosition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryDailyClosingAccountPosition_closingId_accountId_key"
  ON "TreasuryDailyClosingAccountPosition"("closingId", "accountId");

CREATE INDEX "TreasuryDailyClosingAccountPosition_closingId_sortOrder_idx"
  ON "TreasuryDailyClosingAccountPosition"("closingId", "sortOrder");

CREATE INDEX "TreasuryDailyClosingAccountPosition_accountId_idx"
  ON "TreasuryDailyClosingAccountPosition"("accountId");

ALTER TABLE "TreasuryDailyClosingAccountPosition"
  ADD CONSTRAINT "TreasuryDailyClosingAccountPosition_closingId_fkey"
  FOREIGN KEY ("closingId") REFERENCES "TreasuryDailyClosing"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryDailyClosingAccountPosition"
  ADD CONSTRAINT "TreasuryDailyClosingAccountPosition_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TreasuryDailyClosingFrozenPendency" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "closingId" UUID NOT NULL,
  "accountId" UUID,
  "titleKind" "TreasuryOfficialTitleKind" NOT NULL,
  "officialTitleId" UUID,
  "nomusExternalId" INTEGER,
  "dueDate" DATE,
  "expectedDate" DATE,
  "openAmount" DECIMAL(20,2) NOT NULL,
  "statusSnapshot" TEXT,
  "counterpartyName" TEXT,
  "label" TEXT,
  "metadataJson" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryDailyClosingFrozenPendency_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreasuryDailyClosingFrozenPendency_closingId_sortOrder_idx"
  ON "TreasuryDailyClosingFrozenPendency"("closingId", "sortOrder");

CREATE INDEX "TreasuryDailyClosingFrozenPendency_closingId_titleKind_idx"
  ON "TreasuryDailyClosingFrozenPendency"("closingId", "titleKind");

CREATE INDEX "TreasuryDailyClosingFrozenPendency_accountId_idx"
  ON "TreasuryDailyClosingFrozenPendency"("accountId");

CREATE INDEX "TreasuryDailyClosingFrozenPendency_officialTitleId_idx"
  ON "TreasuryDailyClosingFrozenPendency"("officialTitleId");

CREATE INDEX "TreasuryDailyClosingFrozenPendency_nomusExternalId_idx"
  ON "TreasuryDailyClosingFrozenPendency"("nomusExternalId");

ALTER TABLE "TreasuryDailyClosingFrozenPendency"
  ADD CONSTRAINT "TreasuryDailyClosingFrozenPendency_closingId_fkey"
  FOREIGN KEY ("closingId") REFERENCES "TreasuryDailyClosing"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryDailyClosingFrozenPendency"
  ADD CONSTRAINT "TreasuryDailyClosingFrozenPendency_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TreasuryDailyClosingFrozenException" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "closingId" UUID NOT NULL,
  "sourceExceptionId" UUID,
  "accountId" UUID,
  "type" "TreasuryExceptionType" NOT NULL,
  "severity" "TreasuryExceptionSeverity" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "amount" DECIMAL(20,2),
  "entityKind" "TreasuryExceptionEntityKind",
  "entityId" TEXT,
  "snapshotJson" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryDailyClosingFrozenException_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreasuryDailyClosingFrozenException_closingId_sortOrder_idx"
  ON "TreasuryDailyClosingFrozenException"("closingId", "sortOrder");

CREATE INDEX "TreasuryDailyClosingFrozenException_closingId_severity_idx"
  ON "TreasuryDailyClosingFrozenException"("closingId", "severity");

CREATE INDEX "TreasuryDailyClosingFrozenException_sourceExceptionId_idx"
  ON "TreasuryDailyClosingFrozenException"("sourceExceptionId");

CREATE INDEX "TreasuryDailyClosingFrozenException_accountId_idx"
  ON "TreasuryDailyClosingFrozenException"("accountId");

CREATE INDEX "TreasuryDailyClosingFrozenException_type_idx"
  ON "TreasuryDailyClosingFrozenException"("type");

ALTER TABLE "TreasuryDailyClosingFrozenException"
  ADD CONSTRAINT "TreasuryDailyClosingFrozenException_closingId_fkey"
  FOREIGN KEY ("closingId") REFERENCES "TreasuryDailyClosing"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryDailyClosingFrozenException"
  ADD CONSTRAINT "TreasuryDailyClosingFrozenException_sourceExceptionId_fkey"
  FOREIGN KEY ("sourceExceptionId") REFERENCES "TreasuryException"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TreasuryDailyClosingFrozenException"
  ADD CONSTRAINT "TreasuryDailyClosingFrozenException_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "TreasuryFinancialAccount"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TreasuryDailyClosingCaveat" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "closingId" UUID NOT NULL,
  "code" TEXT,
  "severity" "TreasuryExceptionSeverity" NOT NULL DEFAULT 'WARNING',
  "message" TEXT NOT NULL,
  "acknowledged" BOOLEAN NOT NULL DEFAULT false,
  "metadataJson" JSONB,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryDailyClosingCaveat_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreasuryDailyClosingCaveat_closingId_sortOrder_idx"
  ON "TreasuryDailyClosingCaveat"("closingId", "sortOrder");

CREATE INDEX "TreasuryDailyClosingCaveat_closingId_severity_idx"
  ON "TreasuryDailyClosingCaveat"("closingId", "severity");

CREATE INDEX "TreasuryDailyClosingCaveat_code_idx"
  ON "TreasuryDailyClosingCaveat"("code");

ALTER TABLE "TreasuryDailyClosingCaveat"
  ADD CONSTRAINT "TreasuryDailyClosingCaveat_closingId_fkey"
  FOREIGN KEY ("closingId") REFERENCES "TreasuryDailyClosing"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "TreasuryDailyClosingReopening" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fromClosingId" UUID NOT NULL,
  "toClosingId" UUID NOT NULL,
  "reason" TEXT NOT NULL,
  "requestId" TEXT,
  "reopenedByUserId" UUID NOT NULL,
  "reopenedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TreasuryDailyClosingReopening_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TreasuryDailyClosingReopening_fromClosingId_key"
  ON "TreasuryDailyClosingReopening"("fromClosingId");

CREATE UNIQUE INDEX "TreasuryDailyClosingReopening_toClosingId_key"
  ON "TreasuryDailyClosingReopening"("toClosingId");

CREATE INDEX "TreasuryDailyClosingReopening_reopenedAt_idx"
  ON "TreasuryDailyClosingReopening"("reopenedAt");

CREATE INDEX "TreasuryDailyClosingReopening_reopenedByUserId_idx"
  ON "TreasuryDailyClosingReopening"("reopenedByUserId");

CREATE INDEX "TreasuryDailyClosingReopening_requestId_idx"
  ON "TreasuryDailyClosingReopening"("requestId");

ALTER TABLE "TreasuryDailyClosingReopening"
  ADD CONSTRAINT "TreasuryDailyClosingReopening_fromClosingId_fkey"
  FOREIGN KEY ("fromClosingId") REFERENCES "TreasuryDailyClosing"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryDailyClosingReopening"
  ADD CONSTRAINT "TreasuryDailyClosingReopening_toClosingId_fkey"
  FOREIGN KEY ("toClosingId") REFERENCES "TreasuryDailyClosing"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TreasuryDailyClosingReopening"
  ADD CONSTRAINT "TreasuryDailyClosingReopening_reopenedByUserId_fkey"
  FOREIGN KEY ("reopenedByUserId") REFERENCES "AppUser"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Imutabilidade do payload: DELETE sempre bloqueado; UPDATE de CLOSED só permite transição de reabertura.
CREATE OR REPLACE FUNCTION treasury_daily_closing_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TreasuryDailyClosing is immutable and cannot be deleted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status = 'REOPENED' THEN
    RAISE EXCEPTION 'TreasuryDailyClosing REOPENED version is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status = 'CLOSED' THEN
    IF NEW.status = 'REOPENED'
       AND NEW.supersededByClosingId IS NOT NULL
       AND NEW.companyCode IS NOT DISTINCT FROM OLD.companyCode
       AND NEW.civilDate IS NOT DISTINCT FROM OLD.civilDate
       AND NEW.version IS NOT DISTINCT FROM OLD.version
       AND NEW.sourceHash IS NOT DISTINCT FROM OLD.sourceHash
       AND NEW.contentHash IS NOT DISTINCT FROM OLD.contentHash
       AND NEW.openingBalance IS NOT DISTINCT FROM OLD.openingBalance
       AND NEW.realizedInflows IS NOT DISTINCT FROM OLD.realizedInflows
       AND NEW.realizedOutflows IS NOT DISTINCT FROM OLD.realizedOutflows
       AND NEW.pendenciesAmount IS NOT DISTINCT FROM OLD.pendenciesAmount
       AND NEW.closingBalance IS NOT DISTINCT FROM OLD.closingBalance
       AND NEW.observedBalance IS NOT DISTINCT FROM OLD.observedBalance
       AND NEW.reconciledBalance IS NOT DISTINCT FROM OLD.reconciledBalance
       AND NEW.differenceAmount IS NOT DISTINCT FROM OLD.differenceAmount
       AND NEW.exceptionsCount IS NOT DISTINCT FROM OLD.exceptionsCount
       AND NEW.exceptionsAmount IS NOT DISTINCT FROM OLD.exceptionsAmount
       AND NEW.caveatsCount IS NOT DISTINCT FROM OLD.caveatsCount
       AND NEW.previousClosingId IS NOT DISTINCT FROM OLD.previousClosingId
       AND NEW.createdByUserId IS NOT DISTINCT FROM OLD.createdByUserId
       AND NEW.createdAt IS NOT DISTINCT FROM OLD.createdAt
       AND NEW.closedByUserId IS NOT DISTINCT FROM OLD.closedByUserId
       AND NEW.closedAt IS NOT DISTINCT FROM OLD.closedAt
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'TreasuryDailyClosing CLOSED payload is immutable (reopen creates a new version)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- OPEN: updates allowed until close.
  RETURN NEW;
END;
$$;

CREATE TRIGGER treasury_daily_closing_immutable_trg
  BEFORE UPDATE OR DELETE ON "TreasuryDailyClosing"
  FOR EACH ROW
  EXECUTE FUNCTION treasury_daily_closing_reject_mutation();

-- Filhos do fechamento: append-only (sem UPDATE/DELETE).
CREATE OR REPLACE FUNCTION treasury_daily_closing_child_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'TreasuryDailyClosing child snapshot is append-only and cannot be updated or deleted'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER treasury_daily_closing_account_position_immutable_trg
  BEFORE UPDATE OR DELETE ON "TreasuryDailyClosingAccountPosition"
  FOR EACH ROW
  EXECUTE FUNCTION treasury_daily_closing_child_reject_mutation();

CREATE TRIGGER treasury_daily_closing_frozen_pendency_immutable_trg
  BEFORE UPDATE OR DELETE ON "TreasuryDailyClosingFrozenPendency"
  FOR EACH ROW
  EXECUTE FUNCTION treasury_daily_closing_child_reject_mutation();

CREATE TRIGGER treasury_daily_closing_frozen_exception_immutable_trg
  BEFORE UPDATE OR DELETE ON "TreasuryDailyClosingFrozenException"
  FOR EACH ROW
  EXECUTE FUNCTION treasury_daily_closing_child_reject_mutation();

CREATE TRIGGER treasury_daily_closing_caveat_immutable_trg
  BEFORE UPDATE OR DELETE ON "TreasuryDailyClosingCaveat"
  FOR EACH ROW
  EXECUTE FUNCTION treasury_daily_closing_child_reject_mutation();

CREATE TRIGGER treasury_daily_closing_reopening_immutable_trg
  BEFORE UPDATE OR DELETE ON "TreasuryDailyClosingReopening"
  FOR EACH ROW
  EXECUTE FUNCTION treasury_daily_closing_child_reject_mutation();
