import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { PublishedPriceTrace } from "../audit/publishedPriceTrace.js";
import {
  REQUIRED_BUNDLE_ROOT_FILES,
  type DiagnosticFinding,
} from "./chatgptDiagnosticTypes.js";
import {
  assertRequiredBundleStructure,
  buildChatGptDiagnosticBundle,
} from "./diagnosticBundleBuilder.server.js";
import {
  buildPublishedPriceBusinessRulesMarkdown,
  buildPublishedPriceCalculationTrace,
  buildPublishedPriceCostComparison,
  buildPublishedPriceDatabaseEvidence,
  buildPublishedPriceExecutiveSummaryMarkdown,
  buildPublishedPriceFindings,
  evaluatePublishedPriceAutoDiagnostics,
  parsePublishedPriceDiagnosticRequest,
} from "./pricingDiagnostic.server.js";

function sampleTrace618Varejo2(): PublishedPriceTrace {
  return {
    product: {
      productId: "prod-618",
      sku: "618.08AA",
      name: "Produto 618.08AA",
      type: "PRODUCT",
      status: "AVAILABLE",
    },
    commercialPrice: {
      tableId: "table-varejo2",
      tableName: "Varejo 2",
      tableCode: "VAREJO_2",
      versionId: "ver-price-1",
      versionNumber: 5,
      priceItemId: "price-item-618",
      salePrice: 1.85,
      publishedAt: "2026-03-01T10:00:00.000Z",
      effectiveFrom: "2026-03-01",
      effectiveTo: null,
      versionStatus: "PUBLISHED",
      status: "AVAILABLE",
    },
    costSource: {
      productionCostTableVersionId: "pc-ver-1",
      productionCostTableCode: "CUSTO_PROD_2026",
      productionCostTableName: "Custo Produção 2026",
      productionCostRevision: 3,
      productionCostEffectiveFrom: "2026-01-01",
      productionCostItemId: "pc-item-618",
      industrialCost: 0.912785,
      factoryCost: 0.912785,
      managerialCost: null,
      materialCostInPrice: 0.5,
      laborCostInPrice: 0.2,
      machineCostInPrice: 0.15,
      status: "AVAILABLE",
      newerPublishedVersionWarning: null,
    },
    materialSource: {
      materialCostTableVersionId: "mp-ver-1",
      materialCostTableCode: "MP_2026",
      materialCostTableName: "MP 2026",
      materialCostRevision: 2,
      materialCostEffectiveFrom: "2026-01-01",
      materialCostAmount: 0.5,
      status: "AVAILABLE",
    },
    taxSource: {
      taxRuleId: "tax-1",
      taxRuleName: "ICMS Padrão",
      taxPercent: 12,
      taxAmount: 0.22,
      status: "AVAILABLE",
    },
    marginSource: {
      marginRuleId: null,
      marginName: null,
      targetMarginPercent: 35,
      publishedMarginPercent: 35,
      markup: 2.026,
      status: "AVAILABLE",
    },
    commissionSource: {
      commissionPercent: 3,
      commissionAmount: 0.055,
      source: "PRICE_TABLE_ITEM",
      status: "AVAILABLE",
    },
    deductions: {
      freightAmount: 0.02,
      otherVariablesAmount: 0.01,
      roundingAmount: null,
      frozenOtherCostTotal: 0.085,
      status: "AVAILABLE",
    },
    availability: {
      hasFullSnapshot: true,
      missingFields: [],
    },
  };
}

describe("pricingDiagnostic", () => {
  it("parseia request PUBLISHED_PRICE com sku e tableCode", () => {
    const parsed = parsePublishedPriceDiagnosticRequest({
      scope: "PUBLISHED_PRICE",
      context: { sku: "618.08AA", tableCode: "VAREJO_2" },
    });
    assert.equal(parsed.scope, "PUBLISHED_PRICE");
    assert.equal(parsed.context.sku, "618.08AA");
    assert.equal(parsed.context.tableCode, "VAREJO_2");
  });

  it("rejeita request sem identificador de preço", () => {
    assert.throws(
      () =>
        parsePublishedPriceDiagnosticRequest({
          scope: "PUBLISHED_PRICE",
          context: { tableCode: "VAREJO_2" },
        }),
      /priceItemId ou context.sku/
    );
  });

  it("618.08AA VAREJO_2 — OK_PRICE_USES_PUBLISHED_COST com custo 0.912785", () => {
    const trace = sampleTrace618Varejo2();
    const comparison = buildPublishedPriceCostComparison(trace, {
      unitProductionCost: 0.912785,
      versionId: "pc-ver-1",
      versionCode: "CUSTO_PROD_2026",
      revision: 3,
    });
    const diagnostics = evaluatePublishedPriceAutoDiagnostics(trace, comparison);
    assert.equal(trace.costSource.industrialCost, 0.912785);
    assert.ok(diagnostics.some((d) => d.code === "OK_PRICE_USES_PUBLISHED_COST"));
    assert.equal(comparison.priceUsesLatestOfficial, true);
  });

  it("detecta WARNING_NEWER_COST_EXISTS", () => {
    const trace = sampleTrace618Varejo2();
    trace.costSource.newerPublishedVersionWarning = "Existe versão de custo mais recente.";
    const comparison = buildPublishedPriceCostComparison(trace, {
      unitProductionCost: 0.95,
      versionId: "pc-ver-2",
      versionCode: "CUSTO_PROD_2026",
      revision: 4,
    });
    const diagnostics = evaluatePublishedPriceAutoDiagnostics(trace, comparison);
    assert.ok(diagnostics.some((d) => d.code === "WARNING_NEWER_COST_EXISTS"));
  });

  it("detecta LEGACY_PRICE_WITH_INCOMPLETE_SNAPSHOT", () => {
    const trace = sampleTrace618Varejo2();
    trace.availability = { hasFullSnapshot: false, missingFields: ["formulaSnapshotJson"] };
    const comparison = buildPublishedPriceCostComparison(trace, {
      unitProductionCost: 0.912785,
      versionId: "pc-ver-1",
      versionCode: "CUSTO_PROD_2026",
      revision: 3,
    });
    const diagnostics = evaluatePublishedPriceAutoDiagnostics(trace, comparison);
    assert.ok(diagnostics.some((d) => d.code === "LEGACY_PRICE_WITH_INCOMPLETE_SNAPSHOT"));
  });

  it("gera findings com sourceRefs", () => {
    const trace = sampleTrace618Varejo2();
    const comparison = buildPublishedPriceCostComparison(trace, {
      unitProductionCost: 0.912785,
      versionId: "pc-ver-1",
      versionCode: "CUSTO_PROD_2026",
      revision: 3,
    });
    const findings = buildPublishedPriceFindings(
      trace,
      evaluatePublishedPriceAutoDiagnostics(trace, comparison)
    );
    assert.ok(findings.length >= 1);
    for (const f of findings) {
      assert.ok(f.sourceRefs.length >= 1);
      assert.ok(f.evidenceRefs.includes("evidence/published-price-trace.json"));
    }
  });

  it("executive summary responde 7 perguntas", () => {
    const trace = sampleTrace618Varejo2();
    const comparison = buildPublishedPriceCostComparison(trace, {
      unitProductionCost: 0.912785,
      versionId: "pc-ver-1",
      versionCode: "CUSTO_PROD_2026",
      revision: 3,
    });
    const md = buildPublishedPriceExecutiveSummaryMarkdown(
      trace,
      comparison,
      evaluatePublishedPriceAutoDiagnostics(trace, comparison)
    );
    assert.match(md, /618\.08AA/);
    assert.match(md, /VAREJO_2/);
    assert.match(md, /0\.912785/);
    assert.match(md, /## 1\. Qual preço foi analisado/);
    assert.match(md, /## 6\. O preço está coerente/);
    assert.match(md, /sem recálculo/i);
  });

  it("calculation trace marca read-only e diagnosticOnly", () => {
    const trace = sampleTrace618Varejo2();
    const calc = buildPublishedPriceCalculationTrace(
      trace,
      buildPublishedPriceCostComparison(trace, {
        unitProductionCost: 0.912785,
        versionId: "pc-ver-1",
        versionCode: "CUSTO_PROD_2026",
        revision: 3,
      })
    );
    assert.equal(calc.recalculatedInFrontend, false);
    assert.equal(calc.publishedPriceRecalculated, false);
    assert.ok(calc.diagnosticOnly);
    assert.match(String(calc.note), /snapshot/i);
  });

  it("monta bundle PUBLISHED_PRICE sem segredos", () => {
    const trace = sampleTrace618Varejo2();
    const comparison = buildPublishedPriceCostComparison(trace, {
      unitProductionCost: 0.912785,
      versionId: "pc-ver-1",
      versionCode: "CUSTO_PROD_2026",
      revision: 3,
    });
    const autoDiagnostics = evaluatePublishedPriceAutoDiagnostics(trace, comparison);
    const bundle = buildChatGptDiagnosticBundle({
      scope: "PUBLISHED_PRICE",
      context: {
        scope: "PUBLISHED_PRICE",
        filters: { sku: "618.08AA", tableCode: "VAREJO_2" },
      },
      findings: buildPublishedPriceFindings(trace, autoDiagnostics),
      executiveSummaryMarkdown: buildPublishedPriceExecutiveSummaryMarkdown(
        trace,
        comparison,
        autoDiagnostics
      ),
      businessRulesMarkdown: buildPublishedPriceBusinessRulesMarkdown(trace),
      databaseEvidence: buildPublishedPriceDatabaseEvidence(trace, comparison),
      calculationTrace: buildPublishedPriceCalculationTrace(trace, comparison),
      evidence: [
        {
          id: "evidence_published_price_trace",
          scope: "PUBLISHED_PRICE",
          label: "Published price trace",
          bundlePath: "evidence/published-price-trace.json",
          payload: { trace, price: trace.commercialPrice },
        },
      ],
      rawLimitedEvidence: { sku: "618.08AA", tableCode: "VAREJO_2" },
    });

    assertRequiredBundleStructure(bundle);
    for (const path of REQUIRED_BUNDLE_ROOT_FILES) {
      assert.ok(bundle.entries[path], `ausente: ${path}`);
    }

    const evidence = JSON.parse(bundle.entries["evidence/published-price-trace.json"]);
    assert.equal(evidence.trace.costSource.industrialCost, 0.912785);
    assert.equal(evidence.trace.commercialPrice.tableCode, "VAREJO_2");

    const calc = JSON.parse(bundle.entries["10_CALCULATION_TRACE.json"]);
    assert.equal(calc.publishedPriceRecalculated, false);

    const combined = Object.values(bundle.entries).join("\n");
    assert.doesNotMatch(combined, /Bearer /);
    assert.doesNotMatch(combined, /DATABASE_URL=/);

    assert.ok(bundle.entries["evidence/raw-limited/published-price-summary.json"]);
  });

  it("database evidence inclui sourceRefs", () => {
    const trace = sampleTrace618Varejo2();
    const evidence = buildPublishedPriceDatabaseEvidence(
      trace,
      buildPublishedPriceCostComparison(trace, {
        unitProductionCost: 0.912785,
        versionId: "pc-ver-1",
        versionCode: "CUSTO_PROD_2026",
        revision: 3,
      })
    );
    const priceItem = evidence.priceItem as Record<string, unknown>;
    const salePrice = priceItem.salePrice as { value: number; source: unknown };
    assert.equal(salePrice.value, 1.85);
    assert.ok(salePrice.source);
  });

  it("rotas suportam PUBLISHED_PRICE", () => {
    const src = readFileSync("src/lib/diagnostics/diagnosticBundleRoutes.server.ts", "utf8");
    assert.match(src, /PUBLISHED_PRICE/);
    assert.match(src, /parsePublishedPriceDiagnosticRequest/);
  });
});
