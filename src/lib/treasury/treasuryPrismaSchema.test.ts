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
});
