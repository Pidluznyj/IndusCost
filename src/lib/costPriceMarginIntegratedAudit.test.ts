/**
 * Testes — auditoria integrada custo / preço / margem.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCoverageMetrics,
  classifySoldItemForIntegratedAudit,
  computeCriticalPendingCount,
  isPublishedMaterialCostOk,
  isPublishedProductionCostOk,
  rankTopSoldPendingItems,
} from "./costPriceMarginIntegratedAudit.js";
import { civilDateToLocalDate } from "./financeCivilDate.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("costPriceMarginIntegratedAudit — classificação", () => {
  it("não considera custo zero como OK", () => {
    assert.equal(
      isPublishedProductionCostOk({
        status: "OK",
        productId: "p1",
        unitProductionCost: 0,
        costTableVersionId: "v1",
        costTableItemId: "i1",
        effectiveDate: civilDateToLocalDate("2026-06-01"),
        versionName: "Jun",
        versionCode: "2026-06",
        revision: 1,
        publishedAt: null,
        currency: "BRL",
        breakdown: {
          materialCost: 0,
          processCost: 0,
          laborCost: 0,
          machineCost: 0,
          overheadCost: 0,
          otherCost: 0,
        },
        calculationSnapshot: null,
      }),
      false
    );

    assert.equal(
      isPublishedMaterialCostOk({
        status: "OK",
        materialId: "m1",
        landedCostSnapshot: 0,
        currentCostSnapshot: 0,
        freightSnapshot: 0,
        unitSnapshot: "KG",
        materialCostTableVersionId: "v1",
        materialCostTableItemId: "i1",
        effectiveDate: civilDateToLocalDate("2026-06-01"),
        versionName: "Jun",
        versionCode: "2026-06",
        revision: 1,
        publishedAt: null,
        costSource: "CURRENT_MATERIAL",
        calculationSnapshot: null,
      }),
      false
    );
  });

  it("componente vendido sem custo aparece como SEM_CUSTO", () => {
    assert.equal(
      classifySoldItemForIntegratedAudit({ marginStatus: "SEM_CUSTO", referenceStatus: "OK" }),
      "SEM_CUSTO"
    );
    assert.equal(
      classifySoldItemForIntegratedAudit({ marginStatus: "CUSTO_ZERO", referenceStatus: "OK" }),
      "SEM_CUSTO"
    );
  });

  it("material sem custo publicado não é OK", () => {
    assert.equal(
      isPublishedMaterialCostOk({
        status: "SEM_CUSTO",
        materialId: "m1",
        referenceDate: civilDateToLocalDate("2026-06-01"),
      }),
      false
    );
  });

  it("produto com custo e margem OK classifica MARGIN_OK", () => {
    assert.equal(
      classifySoldItemForIntegratedAudit({ marginStatus: "OK", referenceStatus: "OK" }),
      "MARGIN_OK"
    );
    assert.equal(
      classifySoldItemForIntegratedAudit({ marginStatus: "OK", referenceStatus: "SEM_PRECO_TABELA" }),
      "SEM_PRECO_TABELA"
    );
  });

  it("rankTopSoldPendingItems ordena por receita", () => {
    const ranked = rankTopSoldPendingItems(
      [
        {
          productId: "a",
          sku: "A",
          name: "A",
          productType: "PRODUCT",
          quantitySold: 1,
          revenueSold: 100,
          orderIds: new Set(["o1"]),
          reason: "SEM_CUSTO",
        },
        {
          productId: "b",
          sku: "B",
          name: "B",
          productType: "COMPONENT",
          quantitySold: 2,
          revenueSold: 500,
          orderIds: new Set(["o2"]),
          reason: "SEM_CUSTO",
        },
      ],
      1
    );
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]?.sku, "B");
    assert.equal(ranked[0]?.productType, "COMPONENT");
  });

  it("buildCoverageMetrics calcula percentual", () => {
    const metrics = buildCoverageMetrics(10, 7);
    assert.equal(metrics.withoutCoverage, 3);
    assert.equal(metrics.coveragePercent, 70);
  });

  it("computeCriticalPendingCount soma pendências", () => {
    const count = computeCriticalPendingCount({
      materials: buildCoverageMetrics(10, 8),
      products: {
        activeProducts: buildCoverageMetrics(20, 18),
        activeComponents: buildCoverageMetrics(5, 4),
      },
      salesOrders: {
        ordersTotal: 3,
        itemsSold: 4,
        marginOk: 2,
        semCusto: 1,
        semPrecoTabela: 1,
        precoIndisponivel: 0,
        otherMarginIssues: 0,
      },
    });
    assert.equal(count, 2 + 2 + 1 + 1 + 1 + 0);
  });
});

describe("costPriceMarginIntegratedAudit — wiring", () => {
  it("script integrado existe e usa buildCostPriceMarginIntegratedAudit", () => {
    const script = read("scripts/audit-cost-price-margin-integration.ts");
    assert.match(script, /buildCostPriceMarginIntegratedAudit/);
    assert.match(script, /--year/);
    assert.match(script, /--json/);
    assert.doesNotMatch(script, /unitCost/);
  });

  it("endpoint GET /api/cost-price-margin/audit registrado", () => {
    assert.match(read("server.ts"), /registerCostPriceMarginAuditRoutes/);
    assert.match(read("src/lib/costPriceMarginAuditRoutes.ts"), /\/api\/cost-price-margin\/audit/);
  });

  it("UI de auditoria no módulo de precificação", () => {
    assert.match(read("src/components/PricingModule.tsx"), /CostPriceMarginAuditPanel/);
  });
});
