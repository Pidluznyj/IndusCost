/**
 * Integridade do schema/migration de importação bancária (lote + movimentos).
 * Garante models, fingerprint, unicidade anti-duplicidade e ausência de raw OFX.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TREASURY_BANK_IMPORT_BATCH_STATUSES,
  TREASURY_BANK_MOVEMENT_DIRECTIONS,
  TREASURY_BANK_MOVEMENT_RECONCILIATION_STATUSES,
  TREASURY_BANK_OFX_FORMATS,
} from "../contracts/treasuryEnums.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");
const schemaPath = join(repoRoot, "prisma/schema.prisma");
const migrationPath = join(
  repoRoot,
  "prisma/migrations/20260818120000_treasury_bank_import_and_movements/migration.sql"
);

const BATCH_FIELDS = [
  "companyCode",
  "accountId",
  "fileSha256",
  "originalFileName",
  "byteLength",
  "format",
  "status",
  "transactionCount",
  "summaryJson",
  "createdByUserId",
] as const;

const MOVEMENT_FIELDS = [
  "batchId",
  "companyCode",
  "accountId",
  "fingerprint",
  "fitId",
  "direction",
  "amount",
  "currency",
  "postedCivilDate",
  "userCivilDate",
  "description",
  "documentNumber",
  "counterpartyName",
  "reconciliationStatus",
  "reconciledAmount",
  "normalizedPayloadJson",
] as const;

describe("treasuryBankImportSchema — integridade", () => {
  it("enums de lote/movimento/direção/conciliação no contrato, schema e migration", () => {
    assert.deepEqual([...TREASURY_BANK_IMPORT_BATCH_STATUSES], [
      "RECEIVED",
      "PROCESSED",
      "FAILED",
      "DISCARDED",
    ]);
    assert.deepEqual([...TREASURY_BANK_OFX_FORMATS], ["OFX1", "OFX2", "UNKNOWN"]);
    assert.deepEqual([...TREASURY_BANK_MOVEMENT_DIRECTIONS], ["DEBIT", "CREDIT"]);
    assert.deepEqual([...TREASURY_BANK_MOVEMENT_RECONCILIATION_STATUSES], [
      "PENDING",
      "PARTIAL",
      "MATCHED",
      "UNMATCHED",
      "IGNORED",
    ]);

    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /enum TreasuryBankImportBatchStatus/);
    assert.match(schema, /enum TreasuryBankOfxFormat/);
    assert.match(schema, /enum TreasuryBankMovementDirection/);
    assert.match(schema, /enum TreasuryBankMovementReconciliationStatus/);

    assert.ok(existsSync(migrationPath), migrationPath);
    const sql = readFileSync(migrationPath, "utf8");
    for (const status of TREASURY_BANK_IMPORT_BATCH_STATUSES) {
      assert.match(sql, new RegExp(`'${status}'`));
    }
    for (const status of TREASURY_BANK_MOVEMENT_RECONCILIATION_STATUSES) {
      assert.match(sql, new RegExp(`'${status}'`));
    }
  });

  it("lote cobre conta, hash do arquivo, status e não armazena OFX bruto", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const batchStart = schema.indexOf("model TreasuryBankImportBatch {");
    const movementStart = schema.indexOf("model TreasuryBankMovement {");
    assert.ok(batchStart >= 0 && movementStart > batchStart);
    const block = schema.slice(batchStart, movementStart);
    for (const field of BATCH_FIELDS) {
      assert.match(block, new RegExp(`${field}\\s+`));
    }
    assert.match(block, /@@unique\(\[accountId, fileSha256\]\)/);
    assert.doesNotMatch(block, /\brawOfx\b/i);
    assert.doesNotMatch(block, /\bfileContent\b/i);
    assert.doesNotMatch(block, /\baccountNumber\b/);

    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryBankImportBatch"/);
    assert.match(
      sql,
      /UNIQUE INDEX "TreasuryBankImportBatch_accountId_fileSha256_key"/
    );
    assert.doesNotMatch(sql, /"rawOfx"/i);
    assert.doesNotMatch(sql, /"fileContent"/i);
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
    assert.doesNotMatch(sql, /DROP TABLE "(?!Treasury)/);
  });

  it("movimento cobre fingerprint, payload normalizado, datas, documento, contraparte e conciliação", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const movementStart = schema.indexOf("model TreasuryBankMovement {");
    assert.ok(movementStart >= 0);
    const block = schema.slice(movementStart);
    for (const field of MOVEMENT_FIELDS) {
      assert.match(block, new RegExp(`${field}\\s+`));
    }
    assert.match(block, /@@unique\(\[accountId, fingerprint\]\)/);
    assert.match(block, /@@unique\(\[accountId, fitId\]\)/);
    assert.doesNotMatch(block, /\brawOfx\b/i);
    assert.doesNotMatch(block, /\baccountNumber\b/);

    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryBankMovement"/);
    assert.match(
      sql,
      /UNIQUE INDEX "TreasuryBankMovement_accountId_fingerprint_key"/
    );
    assert.match(sql, /UNIQUE INDEX "TreasuryBankMovement_accountId_fitId_key"/);
    assert.match(sql, /"fingerprint" TEXT NOT NULL/);
    assert.match(sql, /"normalizedPayloadJson" JSONB/);
    assert.match(sql, /"reconciledAmount" DECIMAL\(20,2\)/);
    assert.match(sql, /"postedCivilDate" DATE NOT NULL/);
    assert.match(sql, /"documentNumber" TEXT/);
    assert.match(sql, /"counterpartyName" TEXT/);
    assert.match(sql, /TreasuryBankMovement_reconciledAmount_range_chk/);
    assert.match(sql, /TreasuryBankMovement_amount_nonneg_chk/);
  });

  it("relações AppUser e conta financeira existem no schema", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /TreasuryBankImportBatchCreatedBy/);
    assert.match(schema, /bankImportBatches\s+TreasuryBankImportBatch\[\]/);
    assert.match(schema, /bankMovements\s+TreasuryBankMovement\[\]/);
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /REFERENCES "TreasuryFinancialAccount"/);
    assert.match(sql, /REFERENCES "AppUser"/);
    assert.match(sql, /REFERENCES "TreasuryBankImportBatch"/);
  });
});
