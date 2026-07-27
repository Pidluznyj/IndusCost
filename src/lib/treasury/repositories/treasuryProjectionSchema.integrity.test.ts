/**
 * Integridade do schema/migration de projeção Tesouraria.
 * Garante cobertura de cenários, campos de linha e índices sem I/O de banco.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  TREASURY_PROJECTION_ITEM_KINDS,
  TREASURY_PROJECTION_LAYERS,
  TREASURY_PROJECTION_RISK_CODES,
  TREASURY_PROJECTION_RUN_STATUSES,
} from "../contracts/treasuryEnums.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");
const schemaPath = join(repoRoot, "prisma/schema.prisma");
const migrationPath = join(
  repoRoot,
  "prisma/migrations/20260810120000_treasury_projection_run_and_day_lines/migration.sql"
);

const DAY_LINE_FIELDS = [
  "accountId",
  "civilDate",
  "openingBalance",
  "inflows",
  "outflows",
  "transfers",
  "realized",
  "closingBalance",
  "uncertainReceivables",
  "minimumBalance",
  "riskAmount",
  "riskCode",
  "itemCount",
] as const;

const RUN_FIELDS = [
  "scenario",
  "status",
  "periodFrom",
  "periodTo",
  "sourceVersion",
  "algorithmVersion",
  "failureCode",
  "failureMessage",
  "failureDetail",
] as const;

describe("treasuryProjectionSchema — integridade", () => {
  it("cenários CONTRACTUAL/PROBABLE/CONFIRMED/MANUAL estão no contrato e no schema", () => {
    assert.deepEqual([...TREASURY_PROJECTION_LAYERS], [
      "CONTRACTUAL",
      "PROBABLE",
      "CONFIRMED",
      "MANUAL",
    ]);
    const schema = readFileSync(schemaPath, "utf8");
    for (const scenario of TREASURY_PROJECTION_LAYERS) {
      assert.match(schema, new RegExp(`\\b${scenario}\\b`));
    }
    assert.ok(existsSync(migrationPath), migrationPath);
    const sql = readFileSync(migrationPath, "utf8");
    for (const scenario of TREASURY_PROJECTION_LAYERS) {
      assert.match(sql, new RegExp(`'${scenario}'`));
    }
  });

  it("run cobre versão fonte/algoritmo, período, status e falhas", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const runBlock = schema.slice(
      schema.indexOf("model TreasuryProjectionRun"),
      schema.indexOf("model TreasuryProjectionDayLine")
    );
    for (const field of RUN_FIELDS) {
      assert.match(runBlock, new RegExp(`${field}\\s+`));
    }
    for (const status of TREASURY_PROJECTION_RUN_STATUSES) {
      assert.match(schema, new RegExp(`\\b${status}\\b`));
    }
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /"sourceVersion" TEXT NOT NULL/);
    assert.match(sql, /"algorithmVersion" TEXT NOT NULL/);
    assert.match(sql, /"failureDetail" JSONB/);
    assert.match(
      sql,
      /CREATE INDEX "TreasuryProjectionRun_sourceVersion_algorithmVersion_idx"/
    );
    assert.match(
      sql,
      /CREATE INDEX "TreasuryProjectionRun_scenario_periodFrom_periodTo_idx"/
    );
  });

  it("linha diária cobre todos os campos obrigatórios + unicidade run/conta/data", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const lineBlock = schema.slice(
      schema.indexOf("model TreasuryProjectionDayLine"),
      schema.indexOf("model TreasuryProjectionCompositionItem")
    );
    for (const field of DAY_LINE_FIELDS) {
      assert.match(lineBlock, new RegExp(`${field}\\s+`));
    }
    for (const risk of TREASURY_PROJECTION_RISK_CODES) {
      assert.match(schema, new RegExp(`\\b${risk}\\b`));
    }
    assert.match(lineBlock, /@@unique\(\[runId, accountId, civilDate\]\)/);
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(
      sql,
      /UNIQUE INDEX "TreasuryProjectionDayLine_runId_accountId_civilDate_key"/
    );
    assert.match(sql, /"uncertainReceivables" DECIMAL\(20,2\)/);
    assert.match(sql, /"openingBalance" DECIMAL\(20,2\) NOT NULL/);
    assert.match(sql, /"closingBalance" DECIMAL\(20,2\) NOT NULL/);
  });

  it("composição existe para rastreabilidade com kinds e índices", () => {
    const schema = readFileSync(schemaPath, "utf8");
    assert.match(schema, /model TreasuryProjectionCompositionItem \{/);
    for (const kind of TREASURY_PROJECTION_ITEM_KINDS) {
      assert.match(schema, new RegExp(`\\b${kind}\\b`));
    }
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /CREATE TABLE "TreasuryProjectionCompositionItem"/);
    assert.match(
      sql,
      /CREATE INDEX "TreasuryProjectionCompositionItem_dayLineId_sortOrder_idx"/
    );
    assert.match(
      sql,
      /CREATE INDEX "TreasuryProjectionCompositionItem_officialTitleId_idx"/
    );
    assert.doesNotMatch(sql, /ALTER TABLE "NomusAccounts/);
    assert.doesNotMatch(sql, /DROP TABLE "(?!Treasury)/);
  });
});
