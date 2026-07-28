import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computeAvailableAboveContingency,
  computeReplenishmentSuggestion,
  computeTotalPhysicalStock,
  evaluateMaterialStockLevels,
  resolveMaterialStockStatus,
  validateStockLevelHierarchy,
} from "./materialStockLevelRules.js";

const root = process.cwd();

describe("materialStockLevelRules — estoque total e derivados", () => {
  it("estoque total = estoque atual (nunca soma níveis)", () => {
    assert.equal(computeTotalPhysicalStock(10), 10);
    assert.equal(computeTotalPhysicalStock("12.5"), 12.5);
    assert.equal(
      computeTotalPhysicalStock(10),
      evaluateMaterialStockLevels({
        currentQuantity: 10,
        contingencyQuantity: 2,
        minimumQuantity: 5,
        recommendedQuantity: 20,
      }).totalPhysicalStock
    );
    assert.notEqual(
      computeTotalPhysicalStock(10),
      10 + 2 + 5 + 20
    );
  });

  it("disponível acima da contingência = max(atual - contingência, 0)", () => {
    assert.equal(computeAvailableAboveContingency(10, 3), 7);
    assert.equal(computeAvailableAboveContingency(2, 5), 0);
    assert.equal(computeAvailableAboveContingency(5, 5), 0);
    assert.equal(computeAvailableAboveContingency(10.25, 0.25), 10);
    assert.equal(computeAvailableAboveContingency(10, null), null);
  });

  it("sugestão de reposição = max(recomendado - atual, 0)", () => {
    assert.equal(computeReplenishmentSuggestion(8, 20), 12);
    assert.equal(computeReplenishmentSuggestion(20, 20), 0);
    assert.equal(computeReplenishmentSuggestion(25, 20), 0);
    assert.equal(computeReplenishmentSuggestion(1.5, 2.75), 1.25);
    assert.equal(computeReplenishmentSuggestion(10, null), null);
  });
});

describe("materialStockLevelRules — hierarquia", () => {
  it("aceita contingência <= mínimo <= recomendado", () => {
    const ok = validateStockLevelHierarchy({
      contingencyQuantity: 2,
      minimumQuantity: 5,
      recommendedQuantity: 10,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.deepEqual(
        { contingency: ok.contingency, minimum: ok.minimum, recommended: ok.recommended },
        { contingency: 2, minimum: 5, recommended: 10 }
      );
    }
  });

  it("rejeita hierarquia inválida", () => {
    assert.equal(
      validateStockLevelHierarchy({
        contingencyQuantity: 10,
        minimumQuantity: 5,
        recommendedQuantity: 20,
      }).ok,
      false
    );
    assert.equal(
      validateStockLevelHierarchy({
        contingencyQuantity: 1,
        minimumQuantity: 10,
        recommendedQuantity: 5,
      }).ok,
      false
    );
  });

  it("parâmetros nulos = não configurado", () => {
    assert.equal(
      validateStockLevelHierarchy({
        contingencyQuantity: null,
        minimumQuantity: 5,
        recommendedQuantity: 10,
      }).ok,
      false
    );
    assert.equal(
      resolveMaterialStockStatus({
        currentQuantity: 100,
        contingencyQuantity: null,
        minimumQuantity: 5,
        recommendedQuantity: 10,
      }),
      "NAO_CONFIGURADO"
    );
  });
});

describe("materialStockLevelRules — status com prioridade exclusiva", () => {
  const levels = {
    contingencyQuantity: 5,
    minimumQuantity: 10,
    recommendedQuantity: 20,
  };

  it("SEM_ESTOQUE quando atual === 0 (mesmo com níveis)", () => {
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 0, ...levels }),
      "SEM_ESTOQUE"
    );
  });

  it("EMERGÊNCIA quando atual < contingência", () => {
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 4.999, ...levels }),
      "EMERGENCIA"
    );
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: -1, ...levels }),
      "EMERGENCIA"
    );
  });

  it("CRÍTICO no intervalo [contingência, mínimo)", () => {
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 5, ...levels }),
      "CRITICO"
    );
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 9.999, ...levels }),
      "CRITICO"
    );
  });

  it("ATENÇÃO no intervalo [mínimo, recomendado)", () => {
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 10, ...levels }),
      "ATENCAO"
    );
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 19.999, ...levels }),
      "ATENCAO"
    );
  });

  it("SAUDÁVEL quando atual >= recomendado", () => {
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 20, ...levels }),
      "SAUDAVEL"
    );
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 100, ...levels }),
      "SAUDAVEL"
    );
  });

  it("igualdade exata nos limites não gera conflito", () => {
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 5, ...levels }),
      "CRITICO"
    );
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 10, ...levels }),
      "ATENCAO"
    );
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 20, ...levels }),
      "SAUDAVEL"
    );
  });

  it("hierarquia inválida força NÃO_CONFIGURADO", () => {
    assert.equal(
      resolveMaterialStockStatus({
        currentQuantity: 0,
        contingencyQuantity: 20,
        minimumQuantity: 10,
        recommendedQuantity: 5,
      }),
      "NAO_CONFIGURADO"
    );
  });

  it("contingência zero configurada é válida", () => {
    const cfg = {
      contingencyQuantity: 0,
      minimumQuantity: 5,
      recommendedQuantity: 10,
    };
    assert.equal(validateStockLevelHierarchy(cfg).ok, true);
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 0, ...cfg }),
      "SEM_ESTOQUE"
    );
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: -0.01, ...cfg }),
      "EMERGENCIA"
    );
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 3, ...cfg }),
      "CRITICO"
    );
  });

  it("recomendado zero configurado é válido", () => {
    const cfg = {
      contingencyQuantity: 0,
      minimumQuantity: 0,
      recommendedQuantity: 0,
    };
    assert.equal(validateStockLevelHierarchy(cfg).ok, true);
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 0, ...cfg }),
      "SEM_ESTOQUE"
    );
    assert.equal(
      resolveMaterialStockStatus({ currentQuantity: 1, ...cfg }),
      "SAUDAVEL"
    );
  });
});

describe("materialStockLevelRules — isolamento de unidade e custo", () => {
  it("unidade não influencia o cálculo", () => {
    const a = evaluateMaterialStockLevels({
      currentQuantity: 12,
      contingencyQuantity: 2,
      minimumQuantity: 5,
      recommendedQuantity: 15,
      unit: "KG",
    });
    const b = evaluateMaterialStockLevels({
      currentQuantity: 12,
      contingencyQuantity: 2,
      minimumQuantity: 5,
      recommendedQuantity: 15,
      unit: "UN",
    });
    assert.deepEqual(a, b);
  });

  it("nenhum valor de custo participa das funções", () => {
    const base = {
      currentQuantity: 12,
      contingencyQuantity: 2,
      minimumQuantity: 5,
      recommendedQuantity: 15,
    };
    const polluted = {
      ...base,
      currentCost: 999,
      standardCost: 888,
      averageCost: 777,
      freight: 50,
      standardLoss: 20,
    };
    const withCosts = evaluateMaterialStockLevels(polluted);
    assert.deepEqual(withCosts, evaluateMaterialStockLevels(base));
    assert.equal(withCosts.status, "ATENCAO");
    assert.equal(withCosts.totalPhysicalStock, 12);
  });

  it("módulo de regras não importa Prisma, React nem motores de custo", () => {
    const src = readFileSync(join(root, "src/lib/materialStockLevelRules.ts"), "utf8");
    assert.doesNotMatch(src, /from ["']@prisma\/client["']/);
    assert.doesNotMatch(src, /from ["']react["']/);
    assert.doesNotMatch(src, /materialCostPublication|productCostAnalysisEngine|computeMaterialLandedCost/);
    assert.doesNotMatch(src, /prisma\./);
  });
});
