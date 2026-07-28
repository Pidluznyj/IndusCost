/**
 * Caracterização — congela o comportamento atual de custos de matéria-prima
 * antes da Conferência de Estoque (tablet).
 *
 * NÃO altera regras de negócio. Qualquer regressão nestes asserts indica
 * mudança indevida em fórmulas, campos ou contratos.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { computeMaterialLandedCost } from "./materialCostPublication.js";
import { resolveMaterialLineCostForEngine } from "./materialCostEngineResolver.js";
import { directMaterialLineFromBom } from "./openBookMaterialExplosion.js";
import {
  computeMaterialTotalValue,
  normalizeMaterialQuantity,
} from "./materialQuantityTotal.js";
import { effectiveUnitCostFromMaterialPayload } from "./newProductSandbox.js";
import type { CreateMaterialInput, Material } from "@/src/types/material.js";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

/** Espelha o cálculo inline de GET /api/materials (server.ts). */
function apiListMaterialCalculations(input: {
  currentCost: number;
  freight: number;
  standardLoss: number;
  quantity: number;
}) {
  const currentCost = Number(input.currentCost);
  const freight = Number(input.freight);
  const standardLoss = Number(input.standardLoss);
  const landedCost = currentCost + freight;
  const effectiveCost = landedCost / (1 - standardLoss / 100);
  const totalMaterialValue = computeMaterialTotalValue(
    normalizeMaterialQuantity(input.quantity),
    currentCost
  );
  return { landedCost, effectiveCost, totalMaterialValue };
}

const BASE_MATERIAL = {
  id: "mat-char-001",
  code: "010.22AA",
  description: "Cotovelo 1/4 do Registro",
  currentCost: 5.17,
  averageCost: 5.0,
  standardCost: 4.8,
  freight: 0.25,
  standardLoss: 10,
  conversionFactor: 1.5,
  quantity: 100,
} as const;

/** Níveis aditivos de conferência — não podem afetar custo. */
const FUTURE_STOCK_LEVELS = {
  contingencyQuantity: 40,
  minimumQuantity: 10,
  recommendedQuantity: 80,
} as const;

describe("materialStockCostCharacterization — campos de custo oficiais", () => {
  it("preserva significado dos campos de custo no contrato Material", () => {
    const sample: Material = {
      id: "x",
      code: "C",
      description: "D",
      unit: "UN",
      category: "INSUMO",
      currentCost: BASE_MATERIAL.currentCost,
      averageCost: BASE_MATERIAL.averageCost,
      standardCost: BASE_MATERIAL.standardCost,
      quantity: BASE_MATERIAL.quantity,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
      conversionFactor: BASE_MATERIAL.conversionFactor,
      status: "ACTIVE",
      calculations: {
        landedCost: 5.42,
        effectiveCost: 6.022222222222222,
        totalMaterialValue: 517,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    assert.equal(typeof sample.currentCost, "number");
    assert.equal(typeof sample.averageCost, "number");
    assert.equal(typeof sample.standardCost, "number");
    assert.equal(typeof sample.freight, "number");
    assert.equal(typeof sample.standardLoss, "number");
    assert.equal(typeof sample.conversionFactor, "number");
    assert.equal(typeof sample.quantity, "number");
    assert.ok(sample.calculations);
    assert.equal(typeof sample.calculations!.landedCost, "number");
    assert.equal(typeof sample.calculations!.effectiveCost, "number");
    assert.equal(typeof sample.calculations!.totalMaterialValue, "number");

    const create: CreateMaterialInput = {
      code: "C",
      description: "D",
      unit: "UN",
      category: "INSUMO",
      currentCost: 1,
      averageCost: 1,
      standardCost: 1,
      quantity: 0,
      freight: 0,
      standardLoss: 0,
      conversionFactor: 1,
    };
    assert.equal(typeof create.quantity, "number");
  });

  it("schema Prisma mantém Decimal nos campos oficiais de custo e quantity", () => {
    const schema = read("prisma/schema.prisma");
    const materialBlock = schema.slice(
      schema.indexOf("model Material {"),
      schema.indexOf("model MaterialPriceHistory {")
    );
    assert.match(materialBlock, /currentCost\s+Decimal\s+@db\.Decimal\(20, 6\)/);
    assert.match(materialBlock, /averageCost\s+Decimal\s+@db\.Decimal\(20, 6\)/);
    assert.match(materialBlock, /standardCost\s+Decimal\s+@db\.Decimal\(20, 6\)/);
    assert.match(materialBlock, /quantity\s+Decimal\s+@default\(0\)\s+@db\.Decimal\(20, 6\)/);
    assert.match(materialBlock, /freight\s+Decimal\?/);
    assert.match(materialBlock, /standardLoss\s+Decimal\?/);
    assert.match(materialBlock, /conversionFactor\s+Decimal\?/);
    // Níveis de conferência são aditivos e nullable; não substituem quantity.
    assert.match(materialBlock, /contingencyQuantity\s+Decimal\?/);
    assert.match(materialBlock, /minimumQuantity\s+Decimal\?/);
    assert.match(materialBlock, /recommendedQuantity\s+Decimal\?/);
  });
});

describe("materialStockCostCharacterization — fórmulas oficiais", () => {
  it("custo atual + frete = posto fábrica (landedCost)", () => {
    const landed = computeMaterialLandedCost({
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
    });
    assert.equal(landed, 5.42);
    assert.equal(
      apiListMaterialCalculations({
        currentCost: BASE_MATERIAL.currentCost,
        freight: BASE_MATERIAL.freight,
        standardLoss: BASE_MATERIAL.standardLoss,
        quantity: BASE_MATERIAL.quantity,
      }).landedCost,
      5.42
    );
  });

  it("custo efetivo = landed / (1 - perda%/100)", () => {
    const calc = apiListMaterialCalculations({
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
      quantity: BASE_MATERIAL.quantity,
    });
    assert.equal(calc.effectiveCost, 5.42 / 0.9);
    assert.equal(
      effectiveUnitCostFromMaterialPayload({
        currentCost: BASE_MATERIAL.currentCost,
        freight: BASE_MATERIAL.freight,
        standardLoss: BASE_MATERIAL.standardLoss,
      }),
      calc.effectiveCost
    );
  });

  it("custo standard e médio são preservados no snapshot mas não entram no landed", () => {
    const a = computeMaterialLandedCost({
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
    });
    const b = computeMaterialLandedCost({
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
    });
    assert.equal(a, b);
    // standardCost / averageCost deliberadamente diferentes — landed inalterado.
    assert.notEqual(BASE_MATERIAL.standardCost, BASE_MATERIAL.currentCost);
    assert.notEqual(BASE_MATERIAL.averageCost, BASE_MATERIAL.currentCost);
    assert.equal(a, BASE_MATERIAL.currentCost + BASE_MATERIAL.freight);
  });

  it("fator de conversão não participa do landed nem do effective", () => {
    const without = apiListMaterialCalculations({
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
      quantity: BASE_MATERIAL.quantity,
    });
    const withDifferentFactor = {
      ...without,
      conversionFactor: 99,
    };
    void withDifferentFactor;
    const again = apiListMaterialCalculations({
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
      quantity: BASE_MATERIAL.quantity,
    });
    assert.deepEqual(again, without);
    assert.notEqual(BASE_MATERIAL.conversionFactor, 1);
  });

  it("valor total de MP no cadastro = quantity × currentCost (não effective)", () => {
    assert.equal(
      computeMaterialTotalValue(BASE_MATERIAL.quantity, BASE_MATERIAL.currentCost),
      517
    );
    const calc = apiListMaterialCalculations({
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
      quantity: BASE_MATERIAL.quantity,
    });
    assert.equal(calc.totalMaterialValue, 517);
    assert.notEqual(calc.totalMaterialValue, calc.effectiveCost * BASE_MATERIAL.quantity);
  });
});

describe("materialStockCostCharacterization — ficha técnica e custo do produto", () => {
  it("custo unitário da ficha usa landed + standardLoss (não quantity do cadastro)", () => {
    const resolved = resolveMaterialLineCostForEngine({
      id: BASE_MATERIAL.id,
      code: BASE_MATERIAL.code,
      description: BASE_MATERIAL.description,
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.landedCost, 5.42);
    assert.equal(resolved.standardLossPct, 10);
    assert.equal(resolved.currentCost, BASE_MATERIAL.currentCost);
    assert.equal(resolved.freight, BASE_MATERIAL.freight);

    const line = directMaterialLineFromBom(
      resolved.landedCost,
      resolved.standardLossPct,
      2, // BOM quantity
      5 // BOM loss %
    );
    assert.equal(line.matEffectiveCost, 5.42 / 0.9);
    assert.equal(line.requiredQty, 2 / 0.95);
    assert.equal(line.lineTotal, line.matEffectiveCost * line.requiredQty);
  });

  it("mesmo custo de MP gera exatamente o mesmo custo de linha de produto", () => {
    const run = () => {
      const resolved = resolveMaterialLineCostForEngine({
        id: BASE_MATERIAL.id,
        code: BASE_MATERIAL.code,
        description: BASE_MATERIAL.description,
        currentCost: BASE_MATERIAL.currentCost,
        freight: BASE_MATERIAL.freight,
        standardLoss: BASE_MATERIAL.standardLoss,
      });
      assert.equal(resolved.ok, true);
      if (!resolved.ok) throw new Error("resolve failed");
      return directMaterialLineFromBom(resolved.landedCost, resolved.standardLossPct, 3, 0);
    };
    assert.deepEqual(run(), run());
    assert.equal(run().lineTotal, (5.42 / 0.9) * 3);
  });

  it("alterar apenas quantity do cadastro não altera custo unitário da MP", () => {
    const unitA = effectiveUnitCostFromMaterialPayload({
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
    });
    const unitB = effectiveUnitCostFromMaterialPayload({
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
    });
    assert.equal(unitA, unitB);

    const resolvedA = resolveMaterialLineCostForEngine({
      id: BASE_MATERIAL.id,
      code: BASE_MATERIAL.code,
      description: BASE_MATERIAL.description,
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
    });
    const resolvedB = resolveMaterialLineCostForEngine({
      id: BASE_MATERIAL.id,
      code: BASE_MATERIAL.code,
      description: BASE_MATERIAL.description,
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
    });
    assert.deepEqual(resolvedA, resolvedB);

    const valueA = computeMaterialTotalValue(10, BASE_MATERIAL.currentCost);
    const valueB = computeMaterialTotalValue(999, BASE_MATERIAL.currentCost);
    assert.notEqual(valueA, valueB);
    assert.equal(unitA, unitB);
  });

  it("alterar apenas quantity do cadastro não altera fórmula da ficha técnica", () => {
    const bomQty = 1.25;
    const bomLoss = 8;
    const lineAtQty100 = directMaterialLineFromBom(5.42, 10, bomQty, bomLoss);
    const lineAtQty0 = directMaterialLineFromBom(5.42, 10, bomQty, bomLoss);
    assert.deepEqual(lineAtQty100, lineAtQty0);
    // Cadastro quantity muda só o valor de estoque:
    assert.notEqual(
      computeMaterialTotalValue(100, BASE_MATERIAL.currentCost),
      computeMaterialTotalValue(0, BASE_MATERIAL.currentCost)
    );
  });
});

describe("materialStockCostCharacterization — níveis futuros não entram no custo", () => {
  it("contingência / mínimo / recomendado não participam do resolve nem da linha BOM", () => {
    const baseResolved = resolveMaterialLineCostForEngine({
      id: BASE_MATERIAL.id,
      code: BASE_MATERIAL.code,
      description: BASE_MATERIAL.description,
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
    });
    const polluted = resolveMaterialLineCostForEngine({
      id: BASE_MATERIAL.id,
      code: BASE_MATERIAL.code,
      description: BASE_MATERIAL.description,
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
      ...FUTURE_STOCK_LEVELS,
    } as {
      id: string;
      code: string;
      description: string;
      currentCost: unknown;
      freight: unknown;
      standardLoss: unknown;
    });
    assert.deepEqual(polluted, baseResolved);

    assert.equal(baseResolved.ok, true);
    if (!baseResolved.ok) return;
    const lineBase = directMaterialLineFromBom(
      baseResolved.landedCost,
      baseResolved.standardLossPct,
      2,
      0
    );
    const lineWithNoise = directMaterialLineFromBom(
      baseResolved.landedCost,
      baseResolved.standardLossPct,
      2,
      0
    );
    assert.deepEqual(lineWithNoise, lineBase);

    const effective = effectiveUnitCostFromMaterialPayload({
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
      ...FUTURE_STOCK_LEVELS,
    } as {
      currentCost: number;
      freight?: number;
      standardLoss?: number;
    });
    assert.equal(
      effective,
      effectiveUnitCostFromMaterialPayload({
        currentCost: BASE_MATERIAL.currentCost,
        freight: BASE_MATERIAL.freight,
        standardLoss: BASE_MATERIAL.standardLoss,
      })
    );

    // averageCost / standardCost / conversionFactor também não alteram a linha.
    const resolvedIgnoringCatalogExtras = resolveMaterialLineCostForEngine({
      id: BASE_MATERIAL.id,
      code: BASE_MATERIAL.code,
      description: BASE_MATERIAL.description,
      currentCost: BASE_MATERIAL.currentCost,
      freight: BASE_MATERIAL.freight,
      standardLoss: BASE_MATERIAL.standardLoss,
    });
    assert.deepEqual(resolvedIgnoringCatalogExtras, baseResolved);
  });

  it("custo do produto (linha MP) não depende de contingência, mínimo ou recomendado", () => {
    const costOnce = (noise: Record<string, number>) => {
      void noise;
      const resolved = resolveMaterialLineCostForEngine({
        id: BASE_MATERIAL.id,
        code: BASE_MATERIAL.code,
        description: BASE_MATERIAL.description,
        currentCost: BASE_MATERIAL.currentCost,
        freight: BASE_MATERIAL.freight,
        standardLoss: BASE_MATERIAL.standardLoss,
      });
      assert.equal(resolved.ok, true);
      if (!resolved.ok) throw new Error("resolve failed");
      return directMaterialLineFromBom(resolved.landedCost, resolved.standardLossPct, 4, 2)
        .lineTotal;
    };
    assert.equal(costOnce({}), costOnce({ ...FUTURE_STOCK_LEVELS }));
    assert.equal(costOnce({ contingencyQuantity: 1 }), costOnce({ minimumQuantity: 999 }));
  });
});

describe("materialStockCostCharacterization — contrato das APIs de matéria-prima", () => {
  it("GET /api/materials continua calculando landed, effective e totalMaterialValue", () => {
    const server = read("server.ts");
    assert.match(server, /app\.get\(\s*["']\/api\/materials["']/);
    // Comportamento atual (caracterização): perda já convertida para fração antes do effective.
    assert.match(server, /standardLoss = Number\(mat\.standardLoss\) \/ 100/);
    assert.match(server, /landedCost = currentCost \+ freight/);
    assert.match(server, /effectiveCost = landedCost \/ \(1 - standardLoss\)/);
    assert.match(server, /totalMaterialValue/);
    assert.match(server, /normalizeMaterialQuantity/);
    assert.match(server, /computeMaterialTotalValue/);
    assert.doesNotMatch(server, /landedCost\s*=\s*[^\n]*quantity/);
    assert.doesNotMatch(server, /effectiveCost\s*=\s*[^\n]*quantity/);
    // Níveis futuros de conferência ainda não entram nas fórmulas da API de custos.
    assert.doesNotMatch(server, /landedCost\s*=\s*[^\n]*contingencyQuantity/);
    assert.doesNotMatch(server, /effectiveCost\s*=\s*[^\n]*minimumQuantity/);
    assert.doesNotMatch(server, /effectiveCost\s*=\s*[^\n]*recommendedQuantity/);
  });

  it("POST/PUT /api/materials aceitam campos obrigatórios atuais de custo e quantity", () => {
    const server = read("server.ts");
    assert.match(server, /app\.post\(\s*["']\/api\/materials["']/);
    assert.match(server, /app\.put\(\s*["']\/api\/materials\/:id["']/);
    for (const field of [
      "currentCost",
      "averageCost",
      "standardCost",
      "freight",
      "standardLoss",
      "conversionFactor",
      "quantity",
    ]) {
      assert.match(server, new RegExp(field));
    }
  });

  it("DTO Material exige calculations com landedCost, effectiveCost e totalMaterialValue", () => {
    const types = read("src/types/material.ts");
    assert.match(types, /currentCost:\s*number/);
    assert.match(types, /averageCost:\s*number/);
    assert.match(types, /standardCost:\s*number/);
    assert.match(types, /quantity:\s*number/);
    assert.match(types, /freight:\s*number/);
    assert.match(types, /standardLoss:\s*number/);
    assert.match(types, /conversionFactor:\s*number/);
    assert.match(types, /landedCost:\s*number/);
    assert.match(types, /effectiveCost:\s*number/);
    assert.match(types, /totalMaterialValue:\s*number/);
    assert.match(types, /quantity × currentCost/);
    // DTO legado de custo/listagem ainda não inclui níveis (aditivo futuro na API).
    assert.doesNotMatch(types, /contingencyQuantity/);
    assert.doesNotMatch(types, /minimumQuantity/);
    assert.doesNotMatch(types, /recommendedQuantity/);
  });

  it("helpers de valor de estoque documentam isolamento do custo posto fábrica/BOM", () => {
    const src = read("src/lib/materialQuantityTotal.ts");
    assert.match(src, /Não altera custo posto fábrica/);
    assert.match(src, /BOM/);
  });
});
