/**
 * Integridade do modelo aditivo de Conferência de Estoque.
 * Não altera regras de custo — apenas caracteriza schema/migration/helpers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { computeMaterialLandedCost } from "./materialCostPublication.js";
import { resolveMaterialLineCostForEngine } from "./materialCostEngineResolver.js";
import { directMaterialLineFromBom } from "./openBookMaterialExplosion.js";
import { computeMaterialTotalValue } from "./materialQuantityTotal.js";
import {
  computeStockConferenceDifference,
  isStockLevelConfigured,
  roundMaterialStockQuantity,
} from "./materialStockConferenceMath.js";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function materialModelBlock(): string {
  const schema = read("prisma/schema.prisma");
  const start = schema.indexOf("model Material {");
  const end = schema.indexOf("enum MaterialMarketCriticality");
  assert.ok(start >= 0 && end > start);
  return schema.slice(start, end);
}

describe("materialStockConferenceSchema — campos aditivos no Material", () => {
  it("preserva quantity oficial Decimal(20,6) e campos de custo", () => {
    const block = materialModelBlock();
    assert.match(block, /quantity\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(20, 6\)/);
    assert.match(block, /currentCost\s+Decimal\s+@db\.Decimal\(20, 6\)/);
    assert.match(block, /averageCost\s+Decimal\s+@db\.Decimal\(20, 6\)/);
    assert.match(block, /standardCost\s+Decimal\s+@db\.Decimal\(20, 6\)/);
    assert.match(block, /freight\s+Decimal\?/);
    assert.match(block, /standardLoss\s+Decimal\?/);
    assert.match(block, /conversionFactor\s+Decimal\?/);
  });

  it("adiciona parâmetros nullable sem default zero", () => {
    const block = materialModelBlock();
    assert.match(block, /contingencyQuantity\s+Decimal\?\s+@db\.Decimal\(20, 6\)/);
    assert.match(block, /minimumQuantity\s+Decimal\?\s+@db\.Decimal\(20, 6\)/);
    assert.match(block, /recommendedQuantity\s+Decimal\?\s+@db\.Decimal\(20, 6\)/);
    assert.doesNotMatch(block, /contingencyQuantity[^\n]*@default\(0\)/);
    assert.doesNotMatch(block, /minimumQuantity[^\n]*@default\(0\)/);
    assert.doesNotMatch(block, /recommendedQuantity[^\n]*@default\(0\)/);
  });

  it("adiciona metadados de última conferência e versão de concorrência", () => {
    const block = materialModelBlock();
    assert.match(block, /lastStockConferenceAt\s+DateTime\?/);
    assert.match(block, /lastStockConferenceUserId\s+String\?/);
    assert.match(block, /stockConferenceVersion\s+Int\s+@default\(1\)/);
    assert.match(block, /MaterialStockConference\s+MaterialStockConference\[\]/);
  });

  it("materiais antigos continuam válidos com níveis nulos (null = não configurado)", () => {
    assert.equal(isStockLevelConfigured(null), false);
    assert.equal(isStockLevelConfigured(undefined), false);
    assert.equal(isStockLevelConfigured(""), false);
    assert.equal(isStockLevelConfigured(0), true);
    assert.equal(isStockLevelConfigured("12.5"), true);
  });
});

describe("materialStockConferenceSchema — histórico append-only", () => {
  it("model MaterialStockConference contém campos obrigatórios", () => {
    const schema = read("prisma/schema.prisma");
    const start = schema.indexOf("model MaterialStockConference {");
    const end = schema.indexOf("model MaterialPriceHistory {");
    assert.ok(start >= 0 && end > start);
    const block = schema.slice(start, end);
    for (const field of [
      "materialId",
      "previousQuantity",
      "reportedQuantity",
      "difference",
      "unitSnapshot",
      "reason",
      "notes",
      "userId",
      "recordedAt",
      "source",
      "previousVersion",
      "previousUpdatedAt",
      "idempotencyKey",
      "createdAt",
    ]) {
      assert.match(block, new RegExp(`${field}\\s+`));
    }
    assert.match(block, /previousQuantity\s+Decimal\s+@db\.Decimal\(20, 6\)/);
    assert.match(block, /reportedQuantity\s+Decimal\s+@db\.Decimal\(20, 6\)/);
    assert.match(block, /difference\s+Decimal\s+@db\.Decimal\(20, 6\)/);
    assert.match(schema, /enum MaterialStockConferenceSource/);
  });
});

describe("materialStockConferenceSchema — migration aditiva", () => {
  it("migration só adiciona colunas/tabela sem backfill de parâmetros", () => {
    const sql = read(
      "prisma/migrations/20260822120000_material_stock_conference_additive/migration.sql"
    );
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "contingencyQuantity"/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "minimumQuantity"/);
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "recommendedQuantity"/);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS "MaterialStockConference"/);
    assert.doesNotMatch(sql, /DROP COLUMN/i);
    assert.doesNotMatch(sql, /RENAME COLUMN/i);
    assert.doesNotMatch(sql, /ALTER COLUMN "quantity"/i);
    assert.doesNotMatch(sql, /ALTER COLUMN "currentCost"/i);
    assert.doesNotMatch(sql, /UPDATE\s+"Material"/i);
    assert.doesNotMatch(sql, /contingencyQuantity[^\n]*DEFAULT 0/);
    assert.doesNotMatch(sql, /minimumQuantity[^\n]*DEFAULT 0/);
    assert.doesNotMatch(sql, /recommendedQuantity[^\n]*DEFAULT 0/);
  });

  it("migration de idempotência só adiciona coluna/índice únicos", () => {
    const sql = read(
      "prisma/migrations/20260822130000_material_stock_conference_idempotency/migration.sql"
    );
    assert.match(sql, /ADD COLUMN IF NOT EXISTS "idempotencyKey"/);
    assert.match(sql, /MaterialStockConference_idempotencyKey_key/);
    assert.doesNotMatch(sql, /DROP COLUMN/i);
    assert.doesNotMatch(sql, /ALTER COLUMN "quantity"/i);
    assert.doesNotMatch(sql, /currentCost/i);
  });
});

describe("materialStockConferenceSchema — custos e quantity oficiais intactos", () => {
  const base = {
    id: "mat-stock-schema-1",
    code: "MP-1",
    description: "Aço",
    currentCost: 10,
    freight: 1,
    standardLoss: 5,
    quantity: 50,
  };

  it("custo atual / landed permanece igual com níveis configurados ou nulos", () => {
    const landed = computeMaterialLandedCost({
      currentCost: base.currentCost,
      freight: base.freight,
    });
    assert.equal(landed, 11);
    const withLevels = computeMaterialLandedCost({
      currentCost: base.currentCost,
      freight: base.freight,
    });
    assert.equal(withLevels, landed);
    void {
      contingencyQuantity: 5,
      minimumQuantity: 2,
      recommendedQuantity: 20,
    };
  });

  it("custo do produto (linha BOM) permanece igual independentemente dos níveis", () => {
    const resolved = resolveMaterialLineCostForEngine({
      id: base.id,
      code: base.code,
      description: base.description,
      currentCost: base.currentCost,
      freight: base.freight,
      standardLoss: base.standardLoss,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    const line = directMaterialLineFromBom(
      resolved.landedCost,
      resolved.standardLossPct,
      2,
      0
    );
    assert.equal(line.matEffectiveCost, 11 / 0.95);
    assert.equal(line.lineTotal, line.matEffectiveCost * 2);
  });

  it("quantidade atual permanece no campo oficial quantity", () => {
    assert.equal(computeMaterialTotalValue(base.quantity, base.currentCost), 500);
    const schema = materialModelBlock();
    assert.match(
      schema,
      /Fonte oficial do estoque atual|Quantidade de referência no cadastro/
    );
  });
});

describe("materialStockConferenceSchema — precisão Decimal do histórico", () => {
  it("diferença preserva 6 casas a partir de strings decimais", () => {
    assert.equal(computeStockConferenceDifference("10.123456", "12.123456"), 2);
    assert.equal(computeStockConferenceDifference("1.000001", "1.000002"), 0.000001);
    assert.equal(computeStockConferenceDifference("100", "99.5"), -0.5);
    assert.equal(roundMaterialStockQuantity("3.1415926535"), 3.141593);
  });
});
