import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const schemaPath = join(repoRoot, "prisma/schema.prisma");
const migrationPath = join(
  repoRoot,
  "prisma/migrations/20260805120000_treasury_financial_accounts_and_balance_snapshots/migration.sql"
);

describe("treasuryPrismaSchema", () => {
  it("schema declara models Tesouraria e FKs AppUser", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model TreasuryFinancialAccount \{/);
    assert.match(schema, /model TreasuryFinancialAccountAccess \{/);
    assert.match(schema, /model TreasuryBalanceSnapshot \{/);
    assert.match(schema, /companyCode\s+String/);
    assert.match(schema, /agencyMasked\s+String/);
    assert.match(schema, /accountNumberMasked\s+String/);
    assert.match(schema, /includeInConsolidated\s+Boolean/);
    assert.match(schema, /minimumBalance\s+Decimal/);
    assert.match(schema, /allowNegativeBalance\s+Boolean/);
    assert.match(schema, /liquidity\s+TreasuryAccountLiquidity/);
    assert.match(schema, /defaultBalanceOrigin\s+TreasuryBalanceOrigin/);
    assert.match(schema, /deactivatedAt\s+DateTime\?/);
    assert.match(schema, /availableBalance\s+Decimal/);
    assert.match(schema, /blockedBalance\s+Decimal/);
    assert.match(schema, /investmentsBalance\s+Decimal/);
    assert.match(schema, /usedLimit\s+Decimal/);
    assert.match(schema, /idempotencyKey\s+String/);
    assert.match(schema, /previousSnapshotId\s+String\?/);
    assert.match(schema, /attachmentUrl\s+String\?/);
    assert.match(schema, /@@unique\(\[accountId, origin, idempotencyKey\]\)/);
    assert.match(schema, /TreasuryAccountCreatedBy/);
    assert.match(schema, /createdByUser\s+AppUser/);
  });

  it("migration aditiva versionada existe e só cria artifacts Tesouraria", () => {
    assert.ok(existsSync(migrationPath), migrationPath);
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryFinancialAccount"/);
    assert.match(sql, /CREATE TABLE "TreasuryFinancialAccountAccess"/);
    assert.match(sql, /CREATE TABLE "TreasuryBalanceSnapshot"/);
    assert.match(
      sql,
      /UNIQUE INDEX "TreasuryBalanceSnapshot_accountId_origin_idempotencyKey_key"/
    );
    assert.match(sql, /REFERENCES "AppUser"/);
    assert.doesNotMatch(sql, /DROP TABLE "(?!Treasury)/);
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
    assert.doesNotMatch(sql, /ALTER TABLE "AppUser"/);
  });

  it("schema e migration de auditoria append-only existem", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model TreasuryAuditLog \{/);
    assert.match(schema, /beforeJson\s+Json\?/);
    assert.match(schema, /afterJson\s+Json\?/);
    assert.match(schema, /metadataJson\s+Json\?/);
    assert.match(schema, /justification\s+String\?/);
    assert.match(schema, /requestId\s+String\?/);
    assert.match(schema, /sessionId\s+String\?/);
    const auditMigration = join(
      repoRoot,
      "prisma/migrations/20260806120000_treasury_audit_log/migration.sql"
    );
    assert.ok(existsSync(auditMigration), auditMigration);
    const sql = readFileSync(auditMigration, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryAuditLog"/);
    assert.match(sql, /treasury_audit_log_immutable_trg/);
  });

  it("schema e migration de promessas de pagamento existem", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model TreasuryPaymentPromise \{/);
    assert.match(schema, /enum TreasuryPaymentPromiseStatus/);
    assert.match(schema, /promisedAmount\s+Decimal/);
    assert.match(schema, /fulfilledAmount\s+Decimal/);
    assert.match(schema, /TreasuryPaymentPromiseCreatedBy/);
    const promiseMigration = join(
      repoRoot,
      "prisma/migrations/20260808120000_treasury_payment_promise/migration.sql"
    );
    assert.ok(existsSync(promiseMigration), promiseMigration);
    const sql = readFileSync(promiseMigration, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryPaymentPromise"/);
    assert.match(sql, /PARTIALLY_FULFILLED/);
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
  });

  it("schema e migration do complemento operacional de títulos existem", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model TreasuryTitleOperationalComplement \{/);
    assert.match(schema, /enum TreasuryOfficialTitleKind/);
    assert.match(schema, /@@unique\(\[titleType, officialTitleId\]\)/);
    const migration = join(
      repoRoot,
      "prisma/migrations/20260807120000_treasury_title_operational_complement/migration.sql"
    );
    assert.ok(existsSync(migration), migration);
    const sql = readFileSync(migration, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryTitleOperationalComplement"/);
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
  });

  it("schema e migration de ações de cobrança e contestações existem", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model TreasuryCollectionAction \{/);
    assert.match(schema, /enum TreasuryCollectionActionType/);
    assert.match(schema, /COMMERCIAL_CONTACT/);
    assert.match(schema, /INTERNAL_ANALYSIS/);
    assert.match(schema, /model TreasuryDispute \{/);
    assert.match(schema, /enum TreasuryDisputeStatus/);
    assert.match(schema, /amountDisputed\s+Decimal/);
    assert.match(schema, /involvedArea\s+String\?/);
    const migration = join(
      repoRoot,
      "prisma/migrations/20260809120000_treasury_collection_action_and_dispute/migration.sql"
    );
    assert.ok(existsSync(migration), migration);
    const sql = readFileSync(migration, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryCollectionAction"/);
    assert.match(sql, /CREATE TABLE "TreasuryDispute"/);
    assert.doesNotMatch(sql, /DROP TABLE "(?!Treasury)/);
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
  });

  it("schema e migration de execução de projeção existem", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model TreasuryProjectionRun \{/);
    assert.match(schema, /model TreasuryProjectionDayLine \{/);
    assert.match(schema, /model TreasuryProjectionCompositionItem \{/);
    assert.match(schema, /enum TreasuryProjectionScenario/);
    assert.match(schema, /enum TreasuryProjectionRunStatus/);
    assert.match(schema, /sourceVersion\s+String/);
    assert.match(schema, /algorithmVersion\s+String/);
    assert.match(schema, /failureCode\s+String\?/);
    assert.match(schema, /failureMessage\s+String\?/);
    assert.match(schema, /failureDetail\s+Json\?/);
    assert.match(schema, /openingBalance\s+Decimal/);
    assert.match(schema, /uncertainReceivables\s+Decimal/);
    assert.match(schema, /minimumBalance\s+Decimal/);
    assert.match(schema, /riskAmount\s+Decimal/);
    assert.match(schema, /riskCode\s+TreasuryProjectionRiskCode/);
    assert.match(schema, /itemCount\s+Int/);
    assert.match(schema, /@@unique\(\[runId, accountId, civilDate\]\)/);
    assert.match(schema, /TreasuryProjectionRunCreatedBy/);
    const migration = join(
      repoRoot,
      "prisma/migrations/20260810120000_treasury_projection_run_and_day_lines/migration.sql"
    );
    assert.ok(existsSync(migration), migration);
    const sql = readFileSync(migration, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryProjectionRun"/);
    assert.match(sql, /CREATE TABLE "TreasuryProjectionDayLine"/);
    assert.match(sql, /CREATE TABLE "TreasuryProjectionCompositionItem"/);
    assert.match(sql, /'MANUAL'/);
    assert.match(sql, /'CONTRACTUAL'/);
    assert.match(sql, /REFERENCES "AppUser"/);
    assert.match(sql, /REFERENCES "TreasuryFinancialAccount"/);
    assert.doesNotMatch(sql, /DROP TABLE "(?!Treasury)/);
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
    assert.doesNotMatch(sql, /ALTER TABLE "AppUser"/);
  });

  it("schema e migration de exceções operacionais existem", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model TreasuryException \{/);
    assert.match(schema, /enum TreasuryExceptionType/);
    assert.match(schema, /enum TreasuryExceptionEntityKind/);
    assert.match(schema, /uniqueKey\s+String\s+@unique/);
    assert.match(schema, /recurrenceCount\s+Int/);
    assert.match(schema, /ignoreJustification\s+String\?/);
    assert.match(schema, /metadataJson\s+Json\?/);
    assert.match(schema, /TreasuryExceptionCreatedBy/);
    const migration = join(
      repoRoot,
      "prisma/migrations/20260813120000_treasury_exception/migration.sql"
    );
    assert.ok(existsSync(migration), migration);
    const sql = readFileSync(migration, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryException"/);
    assert.match(sql, /CREATE TYPE "TreasuryExceptionType"/);
    assert.match(sql, /"uniqueKey" TEXT NOT NULL/);
    assert.match(sql, /"recurrenceCount"/);
    assert.doesNotMatch(sql, /DROP TABLE "(?!Treasury)/);
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
  });

  it("schema e migration de status da Central de Exceções existem", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /IN_ANALYSIS/);
    assert.match(schema, /WAITING_THIRD_PARTY/);
    assert.match(schema, /\bIGNORED\b/);
    const migration = join(
      repoRoot,
      "prisma/migrations/20260815120000_treasury_exception_center_statuses/migration.sql"
    );
    assert.ok(existsSync(migration), migration);
    const sql = readFileSync(migration, "utf8");
    assert.match(sql, /ADD VALUE 'IN_ANALYSIS'/);
    assert.match(sql, /ADD VALUE 'WAITING_THIRD_PARTY'/);
    assert.match(sql, /ADD VALUE 'IGNORED'/);
  });

  it("schema e migration de tipos do motor de exceções existem", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /EXPECTED_RECEIPT_NOT_RECEIVED/);
    assert.match(schema, /FINANCIAL_CHANGE_AFTER_CLOSING/);
    assert.match(schema, /SUSPECTED_DUPLICATE/);
    const migration = join(
      repoRoot,
      "prisma/migrations/20260814120000_treasury_exception_engine_types/migration.sql"
    );
    assert.ok(existsSync(migration), migration);
    const sql = readFileSync(migration, "utf8");
    assert.match(sql, /ALTER TYPE "TreasuryExceptionType" ADD VALUE 'EXPECTED_RECEIPT_NOT_RECEIVED'/);
    assert.match(sql, /ALTER TYPE "TreasuryExceptionType" ADD VALUE 'SUSPECTED_DUPLICATE'/);
    assert.match(sql, /ALTER TYPE "TreasuryExceptionType" ADD VALUE 'FINANCIAL_CHANGE_AFTER_CLOSING'/);
    assert.doesNotMatch(sql, /DROP TABLE/);
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
  });

  it("schema e migration de transferências internas existem", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model TreasuryTransfer \{/);
    assert.match(schema, /enum TreasuryTransferStatus/);
    assert.match(schema, /transferGroupId\s+String/);
    assert.match(schema, /fromAccountId\s+String/);
    assert.match(schema, /toAccountId\s+String/);
    assert.match(schema, /TreasuryTransferFromAccount/);
    assert.match(schema, /TreasuryTransferCreatedBy/);
    assert.match(schema, /\bFORECAST\b/);
    assert.match(schema, /\bSCHEDULED\b/);
    assert.match(schema, /\bSENT\b/);
    assert.match(schema, /\bRECEIVED\b/);
    assert.match(schema, /\bRECONCILED\b/);
    const migration = join(
      repoRoot,
      "prisma/migrations/20260812120000_treasury_transfer/migration.sql"
    );
    assert.ok(existsSync(migration), migration);
    const sql = readFileSync(migration, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryTransfer"/);
    assert.match(sql, /CREATE TYPE "TreasuryTransferStatus"/);
    assert.match(sql, /'SENT'/);
    assert.match(sql, /REFERENCES "TreasuryFinancialAccount"/);
    assert.doesNotMatch(sql, /DROP TABLE "(?!Treasury)/);
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
  });

  it("schema e migration da fila de recálculo de projeção existem", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model TreasuryProjectionRecalcJob \{/);
    assert.match(schema, /enum TreasuryProjectionRecalcJobStatus/);
    assert.match(schema, /enum TreasuryProjectionRecalcEventType/);
    assert.match(schema, /deduplicationKey\s+String/);
    assert.match(schema, /availableAt\s+DateTime/);
    assert.match(schema, /lockedAt\s+DateTime\?/);
    assert.match(schema, /lockedBy\s+String\?/);
    assert.match(schema, /lockToken\s+String\?/);
    assert.match(schema, /attempts\s+Int/);
    assert.match(schema, /maxAttempts\s+Int/);
    assert.match(schema, /lastErrorCode\s+String\?/);
    assert.match(schema, /lastErrorMessage\s+String\?/);
    assert.match(schema, /completedAt\s+DateTime\?/);
    assert.match(schema, /\bAR_SYNC\b/);
    assert.match(schema, /\bREOPENING\b/);
    const migration = join(
      repoRoot,
      "prisma/migrations/20260811120000_treasury_projection_recalc_queue/migration.sql"
    );
    assert.ok(existsSync(migration), migration);
    const sql = readFileSync(migration, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryProjectionRecalcJob"/);
    assert.match(sql, /TreasuryProjectionRecalcJob_active_dedupe_uidx/);
    assert.match(sql, /FOR UPDATE SKIP LOCKED|availableAt/);
    assert.match(sql, /'SETTLEMENT'/);
    assert.match(sql, /'PROGRAMMING'/);
    assert.doesNotMatch(sql, /DROP TABLE "(?!Treasury)/);
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
    assert.match(sql, /Sem broker externo no MVP/);
  });
});
