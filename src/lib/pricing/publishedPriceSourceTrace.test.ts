import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  computePublishedMarkup,
  deriveFreightPercentAmount,
  deriveOtherVariablesAmount,
  readCostSnapshotFields,
  readFormulaSnapshotFields,
} from "./publishedPriceSourceTrace.js";
import { parsePublishedPriceSourceTraceQuery, buildPublishedPriceSourceTraceUrl } from "./publishedPriceSourceTraceApi.js";

describe("publishedPriceSourceTrace parsers", () => {
  it("lê costSnapshotJson publicado na geração", () => {
    const fields = readCostSnapshotFields({
      productionCostTableVersionId: "pcv-1",
      productionCostTableVersionCode: "CUSTO_IND",
      revision: 3,
      effectiveDate: "2026-01-01",
      productionCostTableItemId: "pci-1",
      unitProductionCost: 50,
      breakdown: { materialCost: 30, laborCost: 10, machineCost: 10 },
    });
    assert.equal(fields.productionCostTableVersionId, "pcv-1");
    assert.equal(fields.revision, 3);
    assert.equal(fields.unitProductionCost, 50);
  });

  it("lê formulaSnapshotJson com taxas publicadas", () => {
    const fields = readFormulaSnapshotFields({
      taxRuleId: "tax-1",
      marginPct: 20,
      freight: 1.5,
      rates: { taxRate: 0.1, commissionRate: 0.02, otherRate: 0.01 },
      productionCostTableVersionId: "pcv-1",
      productionCostRevision: 3,
    });
    assert.equal(fields.taxRuleId, "tax-1");
    assert.equal(fields.taxPercent, 10);
    assert.equal(fields.commissionPercent, 2);
    assert.equal(fields.freight, 1.5);
    assert.equal(fields.marginPct, 20);
  });

  it("lê frete percentual do snapshot comercial moderno", () => {
    const fields = readFormulaSnapshotFields({
      freight: 0,
      freightPercent: 3,
      rates: { taxRate: 0.2875, commissionRate: 0.02, otherRate: 0, freightRate: 0.03 },
      outputs: { totalFreightPercent: 0.102696 },
    });
    assert.equal(fields.freightPercent, 3);
    assert.equal(fields.freightRate, 0.03);
    assert.equal(fields.totalFreightPercentFromOutputs, 0.102696);
  });

  it("markup derivado de preço e custo publicados sem recálculo de preço", () => {
    assert.equal(computePublishedMarkup(100, 50), 2);
    assert.equal(computePublishedMarkup(100, 0), null);
  });

  it("deduções derivadas de valores congelados excluem comissão e fretes", () => {
    const freightPercentAmount = deriveFreightPercentAmount({
      salePrice: 3.423215,
      freightPercent: 3,
      totalFreightPercentFromOutputs: 0.10269645,
    });
    assert.equal(freightPercentAmount, 0.102696);

    const other = deriveOtherVariablesAmount({
      frozenOtherCost: 0.171161,
      freight: 0,
      freightPercentAmount,
      commissionValue: 0.068464,
      salePrice: 3.423215,
      otherRate: 0,
    });
    assert.equal(other, 0);

    const residualLegacy = deriveOtherVariablesAmount({
      frozenOtherCost: 8,
      freight: 1,
      commissionValue: 2,
      salePrice: 100,
      otherRate: null,
    });
    assert.equal(residualLegacy, 5);
  });
});

describe("publishedPriceSourceTraceApi", () => {
  it("parseia query obrigatória", () => {
    const query = parsePublishedPriceSourceTraceQuery({
      priceItemId: "item-1",
      tableId: "tbl-1",
      versionId: "ver-1",
      productId: "prod-1",
    });
    assert.equal(query.priceItemId, "item-1");
    assert.equal(query.tableId, "tbl-1");
  });

  it("monta URL do endpoint read-only", () => {
    const url = buildPublishedPriceSourceTraceUrl({
      priceItemId: "item-1",
      tableId: "tbl-1",
      productId: "prod-1",
    });
    assert.match(url, /\/api\/pricing\/published-price-source-trace\?/);
    assert.match(url, /priceItemId=item-1/);
  });
});

describe("publishedPriceSourceTrace integration static", () => {
  const serverSrc = () => readFileSync(join(process.cwd(), "server.ts"), "utf8");
  const moduleSrc = () => readFileSync(join(process.cwd(), "src/components/PricingModule.tsx"), "utf8");
  const serverTraceSrc = () =>
    readFileSync(join(process.cwd(), "src/lib/pricing/publishedPriceSourceTrace.server.ts"), "utf8");

  it("endpoint registrado antes de rotas paramétricas de pricing", () => {
    const src = serverSrc();
    const traceIdx = src.indexOf('"/api/pricing/published-price-source-trace"');
    const paramIdx = src.indexOf('"/api/pricing/:productId/:taxRuleId/calculate"');
    assert.ok(traceIdx > 0);
    assert.ok(paramIdx > traceIdx);
    assert.match(src, /buildPublishedPriceSourceTrace/);
  });

  it("service não recalcula preço com motor vivo", () => {
    const src = serverTraceSrc();
    assert.doesNotMatch(src, /getProductCostAnalysis/);
    assert.doesNotMatch(src, /calculatePriceTableItemFromFrozenCost/);
  });

  it("modal publicado abre aba Fonte do Preço ao clicar na célula", () => {
    const src = moduleSrc();
    assert.match(src, /Fonte do Preço/);
    assert.match(src, /PublishedPriceSourceTraceTab/);
    assert.match(src, /preferredTableId != null && preferredTableId\.trim\(\) !== "" \? "source" : "summary"/);
    assert.match(src, /buildPublishedPriceSourceTraceUrl/);
  });
});
