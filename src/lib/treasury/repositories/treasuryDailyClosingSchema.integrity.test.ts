/**
 * Integridade do schema/migration de fechamento diário Tesouraria.
 * Garante models, índices, imutabilidade e versionamento sem I/O de banco.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TREASURY_CLOSING_STATUSES } from "../contracts/treasuryEnums.js";
import { TREASURY_DAILY_CLOSING_IMMUTABLE_PAYLOAD_FIELDS } from "../domain/treasuryDailyClosingRules.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");
const schemaPath = join(repoRoot, "prisma/schema.prisma");
const migrationPath = join(
  repoRoot,
  "prisma/migrations/20260817120000_treasury_daily_closing/migration.sql"
);

const CLOSING_HEADER_FIELDS = [
  "companyCode",
  "civilDate",
  "version",
  "status",
  "sourceHash",
  "contentHash",
  "openingBalance",
  "realizedInflows",
  "realizedOutflows",
  "pendenciesAmount",
  "closingBalance",
  "observedBalance",
  "reconciledBalance",
  "differenceAmount",
  "exceptionsCount",
  "exceptionsAmount",
  "caveatsCount",
  "previousClosingId",
  "supersededByClosingId",
] as const;

const ACCOUNT_POSITION_FIELDS = [
  "accountId",
  "openingBalance",
  "realizedInflows",
  "realizedOutflows",
  "pendenciesAmount",
  "closingBalance",
  "observedBalance",
  "reconciledBalance",
  "differenceAmount",
] as const;

describe("treasuryDailyClosingSchema — integridade", () => {
  it("status OPEN/CLOSED/REOPENED no contrato, schema e migration", () => {
    assert.deepEqual([...TREASURY_CLOSING_STATUSES], [
      "OPEN",
      "CLOSED",
      "REOPENED",
    ]);
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /enum TreasuryDailyClosingStatus/);
    for (const status of TREASURY_CLOSING_STATUSES) {
      assert.match(schema, new RegExp(`\\b${status}\\b`));
    }
    assert.ok(existsSync(migrationPath), migrationPath);
    const sql = readFileSync(migrationPath, "utf8");
    for (const status of TREASURY_CLOSING_STATUSES) {
      assert.match(sql, new RegExp(`'${status}'`));
    }
  });

  it("fechamento cobre versão, status, hash da fonte e saldos exigidos", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const block = schema.slice(
      schema.indexOf("model TreasuryDailyClosing {"),
      schema.indexOf("model TreasuryDailyClosingAccountPosition")
    );
    for (const field of CLOSING_HEADER_FIELDS) {
      assert.match(block, new RegExp(`${field}\\s+`));
    }
    assert.match(block, /@@unique\(\[companyCode, civilDate, version\]\)/);
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryDailyClosing"/);
    assert.match(sql, /"sourceHash" TEXT NOT NULL/);
    assert.match(sql, /"openingBalance" DECIMAL\(20,2\) NOT NULL/);
    assert.match(sql, /"realizedInflows" DECIMAL\(20,2\)/);
    assert.match(sql, /"realizedOutflows" DECIMAL\(20,2\)/);
    assert.match(sql, /"pendenciesAmount" DECIMAL\(20,2\)/);
    assert.match(sql, /"closingBalance" DECIMAL\(20,2\) NOT NULL/);
    assert.match(sql, /"observedBalance" DECIMAL\(20,2\) NOT NULL/);
    assert.match(sql, /"reconciledBalance" DECIMAL\(20,2\) NOT NULL/);
    assert.match(sql, /"differenceAmount" DECIMAL\(20,2\)/);
    assert.match(
      sql,
      /UNIQUE INDEX "TreasuryDailyClosing_companyCode_civilDate_version_key"/
    );
    assert.match(
      sql,
      /TreasuryDailyClosing_companyCode_civilDate_current_uidx/
    );
    assert.match(sql, /WHERE "status" IN \('OPEN', 'CLOSED'\)/);
  });

  it("posição por conta, pendências, exceções, ressalvas e reabertura existem", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model TreasuryDailyClosingAccountPosition \{/);
    assert.match(schema, /model TreasuryDailyClosingFrozenPendency \{/);
    assert.match(schema, /model TreasuryDailyClosingFrozenException \{/);
    assert.match(schema, /model TreasuryDailyClosingCaveat \{/);
    assert.match(schema, /model TreasuryDailyClosingReopening \{/);

    const positionBlock = schema.slice(
      schema.indexOf("model TreasuryDailyClosingAccountPosition"),
      schema.indexOf("model TreasuryDailyClosingFrozenPendency")
    );
    for (const field of ACCOUNT_POSITION_FIELDS) {
      assert.match(positionBlock, new RegExp(`${field}\\s+`));
    }
    assert.match(positionBlock, /@@unique\(\[closingId, accountId\]\)/);

    const reopenBlock = schema.slice(
      schema.indexOf("model TreasuryDailyClosingReopening"),
      schema.indexOf("model TreasuryDailyClosingReopening") + 1200
    );
    assert.match(reopenBlock, /fromClosingId\s+String/);
    assert.match(reopenBlock, /toClosingId\s+String/);
    assert.match(reopenBlock, /reason\s+String/);

    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryDailyClosingAccountPosition"/);
    assert.match(sql, /CREATE TABLE "TreasuryDailyClosingFrozenPendency"/);
    assert.match(sql, /CREATE TABLE "TreasuryDailyClosingFrozenException"/);
    assert.match(sql, /CREATE TABLE "TreasuryDailyClosingCaveat"/);
    assert.match(sql, /CREATE TABLE "TreasuryDailyClosingReopening"/);
    assert.match(
      sql,
      /UNIQUE INDEX "TreasuryDailyClosingAccountPosition_closingId_accountId_key"/
    );
    assert.match(
      sql,
      /UNIQUE INDEX "TreasuryDailyClosingReopening_fromClosingId_key"/
    );
    assert.match(
      sql,
      /UNIQUE INDEX "TreasuryDailyClosingReopening_toClosingId_key"/
    );
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
    assert.doesNotMatch(sql, /DROP TABLE "(?!Treasury)/);
    assert.doesNotMatch(sql, /ALTER TABLE "AppUser"/);
  });

  it("triggers garantem imutabilidade do fechamento e filhos append-only", () => {
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /treasury_daily_closing_reject_mutation/);
    assert.match(sql, /treasury_daily_closing_immutable_trg/);
    assert.match(sql, /treasury_daily_closing_child_reject_mutation/);
    assert.match(
      sql,
      /treasury_daily_closing_account_position_immutable_trg/
    );
    assert.match(sql, /treasury_daily_closing_frozen_pendency_immutable_trg/);
    assert.match(sql, /treasury_daily_closing_frozen_exception_immutable_trg/);
    assert.match(sql, /treasury_daily_closing_caveat_immutable_trg/);
    assert.match(sql, /treasury_daily_closing_reopening_immutable_trg/);
    assert.match(sql, /CLOSED payload is immutable/);
    assert.match(sql, /reopen creates a new version/);
    assert.match(sql, /append-only and cannot be updated or deleted/);
    for (const field of TREASURY_DAILY_CLOSING_IMMUTABLE_PAYLOAD_FIELDS) {
      if (field === "createdByUserId" || field === "closedByUserId") continue;
      assert.match(sql, new RegExp(`NEW\\.${field}`));
    }
  });
});
