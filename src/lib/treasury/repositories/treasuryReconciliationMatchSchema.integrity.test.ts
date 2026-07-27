/**
 * Integridade do schema/migration de conciliação bancária (match + allocations).
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TREASURY_RECONCILIATION_ALLOCATION_KINDS,
  TREASURY_RECONCILIATION_MATCH_STATUSES,
} from "../contracts/treasuryEnums.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");
const schemaPath = join(repoRoot, "prisma/schema.prisma");
const migrationPath = join(
  repoRoot,
  "prisma/migrations/20260819120000_treasury_reconciliation_match_and_allocations/migration.sql"
);

describe("treasuryReconciliationMatchSchema — integridade", () => {
  it("enums de status/allocation no contrato, schema e migration", () => {
    assert.deepEqual([...TREASURY_RECONCILIATION_MATCH_STATUSES], [
      "PENDING",
      "MATCHED",
      "UNMATCHED",
      "IGNORED",
    ]);
    assert.ok(
      TREASURY_RECONCILIATION_ALLOCATION_KINDS.includes("TITLE") &&
        TREASURY_RECONCILIATION_ALLOCATION_KINDS.includes("FEE") &&
        TREASURY_RECONCILIATION_ALLOCATION_KINDS.includes("UNIDENTIFIED")
    );

    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /enum TreasuryReconciliationMatchStatus/);
    assert.match(schema, /enum TreasuryReconciliationAllocationKind/);
    assert.match(schema, /model TreasuryReconciliationMatch \{/);
    assert.match(schema, /model TreasuryReconciliationMatchMovement \{/);
    assert.match(schema, /model TreasuryReconciliationAllocation \{/);

    assert.ok(existsSync(migrationPath), migrationPath);
    const sql = readFileSync(migrationPath, "utf8");
    for (const status of TREASURY_RECONCILIATION_MATCH_STATUSES) {
      assert.match(sql, new RegExp(`'${status}'`));
    }
    for (const kind of TREASURY_RECONCILIATION_ALLOCATION_KINDS) {
      assert.match(sql, new RegExp(`'${kind}'`));
    }
    assert.match(sql, /CREATE TABLE "TreasuryReconciliationMatch"/);
    assert.match(sql, /CREATE TABLE "TreasuryReconciliationMatchMovement"/);
    assert.match(sql, /CREATE TABLE "TreasuryReconciliationAllocation"/);
    assert.match(sql, /REFERENCES "TreasuryBankMovement"/);
    assert.doesNotMatch(sql, /DROP TABLE/);
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
    assert.match(sql, /Não muta Nomus/);
  });

  it("match cobre movimentos N:N e allocations tipadas sem raw OFX", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const start = schema.indexOf("model TreasuryReconciliationMatch {");
    assert.ok(start >= 0);
    const block = schema.slice(start, start + 4500);
    assert.match(block, /matchedAmount\s+Decimal/);
    assert.match(block, /bankMovementId\s+String/);
    assert.match(block, /officialTitleId\s+String\?/);
    assert.match(block, /transferId\s+String\?/);
    assert.match(block, /ledgerEntryId\s+String\?/);
    assert.doesNotMatch(block, /rawOfx|ofxPayload/);
  });
});
