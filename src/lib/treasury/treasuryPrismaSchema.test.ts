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
});
