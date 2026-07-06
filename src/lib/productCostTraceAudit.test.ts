import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductionCostBomLineAudit } from "./productionCostCalculationSnapshotAudit.js";
import {
  buildEmptyProductCostTraceReport,
  buildProductCostTraceAlerts,
  buildProductCostTraceCsv,
  computeCostSharePercent,
  mapBomLineToCostLine,
  rankCostLinesByTotal,
} from "./productCostTraceAudit.js";

function bomLine(partial: Partial<ProductionCostBomLineAudit>): ProductionCostBomLineAudit {
  return {
    bomLineId: null,
    lineType: "MATERIAL",
    materialId: null,
    childProductId: null,
    sku: null,
    name: null,
    quantity: null,
    lossPercentage: null,
    requiredQty: null,
    unit: null,
    unitCostUsed: null,
    lineTotalCost: 0,
    excludedFromCost: false,
    errorCode: null,
    message: null,
    ...partial,
  };
}

describe("productCostTraceAudit", () => {
  it("SKU inexistente retorna FAIL com mensagem clara", () => {
    const report = buildEmptyProductCostTraceReport("2026-07-06", "Produto não encontrado para identificador: X");
    assert.equal(report.status, "FAIL");
    assert.match(report.errorMessage ?? "", /não encontrado/i);
  });

  it("produto sem custo oficial gera alerta MISSING_OFFICIAL_COST", () => {
    const alerts = buildProductCostTraceAlerts({
      bomLines: [],
      warning: null,
      hasOfficialCost: false,
      engineeringCost: 0.912785,
      officialCost: null,
      commercialPrices: [],
      engineWarnings: [],
    });
    assert.ok(alerts.some((a) => a.code === "MISSING_OFFICIAL_COST"));
  });

  it("componente sem custo gera alerta COMPONENT_WITHOUT_COST", () => {
    const alerts = buildProductCostTraceAlerts({
      bomLines: [
        bomLine({
          lineType: "COMPONENT",
          sku: "420.01",
          name: "Componente X",
          unitCostUsed: null,
        }),
      ],
      warning: null,
      hasOfficialCost: true,
      engineeringCost: 1,
      officialCost: 1,
      commercialPrices: [],
      engineWarnings: [],
    });
    assert.ok(alerts.some((a) => a.code === "COMPONENT_WITHOUT_COST"));
  });

  it("ranking de maiores custos ordena por totalCost desc", () => {
    const lines = [
      mapBomLineToCostLine(
        bomLine({ sku: "A", lineTotalCost: 0.1, unitCostUsed: 0.1, requiredQty: 1 }),
        1
      ),
      mapBomLineToCostLine(
        bomLine({ sku: "B", lineTotalCost: 0.5, unitCostUsed: 0.5, requiredQty: 1 }),
        1
      ),
      mapBomLineToCostLine(
        bomLine({ sku: "C", lineTotalCost: 0.3, unitCostUsed: 0.3, requiredQty: 1 }),
        1
      ),
    ];
    const ranked = rankCostLinesByTotal(lines);
    assert.deepEqual(ranked.map((r) => r.sku), ["B", "C", "A"]);
    assert.equal(ranked[0]?.rank, 1);
    assert.equal(ranked[1]?.rank, 2);
  });

  it("share percent calcula participação no custo total", () => {
    assert.equal(computeCostSharePercent(0.25, 1), 25);
    assert.equal(computeCostSharePercent(0.25, 0), null);
  });

  it("CSV inclui seções product, cost e alert", () => {
    const report = buildEmptyProductCostTraceReport("2026-07-06", "erro");
    report.alerts.push({ code: "TEST", severity: "warning", message: "msg" });
    const csv = buildProductCostTraceCsv(report);
    assert.match(csv, /^section,field,value/m);
    assert.match(csv, /alert,TEST,warning,msg/);
  });

  it("618.08AA — custo igual não gera DIVERGENT_COST", () => {
    const official = 0.912785;
    const alerts = buildProductCostTraceAlerts({
      bomLines: [],
      warning: {
        officialCost: official,
        calculatedCost: official,
        difference: 0,
        hasCostImpact: false,
        hasTechnicalSnapshotPending: true,
        warningStatus: "TECHNICAL_SNAPSHOT_PENDING_NO_COST_IMPACT",
        warningSeverity: "info",
        message: "Snapshot técnico pendente sem impacto de custo",
      },
      hasOfficialCost: true,
      engineeringCost: official,
      officialCost: official,
      commercialPrices: [],
      engineWarnings: [],
    });
    assert.ok(!alerts.some((a) => a.code === "DIVERGENT_COST"));
  });
});
