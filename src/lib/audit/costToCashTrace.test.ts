import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  assembleCostToCashTrace,
  buildCostToCashTraceCsv,
  buildEmptyCostToCashTrace,
  buildCostToCashChain,
  collectCostToCashDiagnostics,
  formatCostToCashTraceText,
  resolveCostToCashCalculationMode,
  resolveCostToCashStatus,
} from "./costToCashTrace.js";
import { createTraceDiagnostic } from "./traceDiagnostic.js";
import { buildEmptyProductCostTraceReport } from "./productCostTrace.js";
import { buildEmptySalesOrderTraceReport } from "./salesOrderTrace.js";
import { buildEmptyCommissionTraceReport } from "./commissionTrace.js";

describe("costToCashTrace services", () => {
  it("service retorna dados para SKU via ProductCostTrace", () => {
    const product = buildEmptyProductCostTraceReport("2026-07-06", "Produto não encontrado");
    const trace = assembleCostToCashTrace({ product, publishedPrice: null, salesOrder: null, commission: null });
    assert.equal(trace.product?.status, "FAIL");
    assert.equal(trace.chain.length, 1);
    assert.equal(trace.chain[0]?.stage, "PRODUCT_COST");
  });

  it("service retorna dados para preço publicado", () => {
    const publishedPrice = {
      product: {
        productId: "p1",
        sku: "618.08AA",
        name: "Produto",
        type: "FINISHED",
        status: "AVAILABLE" as const,
      },
      commercialPrice: {
        tableId: "t1",
        tableName: "Tabela",
        tableCode: "ATACADO",
        versionId: "v1",
        versionNumber: 1,
        priceItemId: "pi1",
        salePrice: 10,
        publishedAt: null,
        effectiveFrom: null,
        effectiveTo: null,
        versionStatus: "PUBLISHED",
        status: "AVAILABLE" as const,
      },
      costSource: {
        productionCostTableVersionId: "pcv1",
        productionCostTableCode: "CUSTO-1",
        productionCostTableName: "Custo",
        productionCostRevision: 1,
        productionCostEffectiveFrom: null,
        productionCostItemId: null,
        industrialCost: 5,
        factoryCost: null,
        managerialCost: null,
        materialCostInPrice: null,
        laborCostInPrice: null,
        machineCostInPrice: null,
        status: "AVAILABLE" as const,
        newerPublishedVersionWarning: null,
      },
      materialSource: {
        materialCostTableVersionId: null,
        materialCostTableCode: null,
        materialCostTableName: null,
        materialCostRevision: null,
        materialCostEffectiveFrom: null,
        materialCostAmount: null,
        status: "NOT_AVAILABLE" as const,
      },
      taxSource: {
        taxRuleId: null,
        taxRuleName: null,
        taxPercent: null,
        taxAmount: null,
        status: "NOT_AVAILABLE" as const,
      },
      marginSource: {
        marginRuleId: null,
        marginName: null,
        targetMarginPercent: null,
        publishedMarginPercent: null,
        markup: null,
        status: "NOT_AVAILABLE" as const,
      },
      commissionSource: {
        commissionPercent: null,
        commissionAmount: null,
        source: null,
        status: "NOT_AVAILABLE" as const,
      },
      deductions: {
        freightAmount: null,
        otherVariablesAmount: null,
        roundingAmount: null,
        frozenOtherCostTotal: null,
        status: "NOT_AVAILABLE" as const,
      },
      availability: { hasFullSnapshot: true, missingFields: [] },
    };
    const trace = assembleCostToCashTrace({
      product: null,
      publishedPrice,
      salesOrder: null,
      commission: null,
    });
    assert.equal(trace.publishedPrice?.commercialPrice.salePrice, 10);
    assert.ok(trace.chain.some((link) => link.stage === "PUBLISHED_PRICE"));
  });

  it("service retorna dados para pedido", () => {
    const salesOrder = buildEmptySalesOrderTraceReport("Pedido não encontrado");
    const trace = assembleCostToCashTrace({
      product: null,
      publishedPrice: null,
      salesOrder,
      commission: null,
    });
    assert.equal(trace.salesOrder?.status, "FAIL");
    assert.equal(trace.chain[0]?.stage, "SALES_ORDER");
  });

  it("service retorna dados para comissão", () => {
    const commission = buildEmptyCommissionTraceReport("Sem schedule");
    const trace = assembleCostToCashTrace({
      product: null,
      publishedPrice: null,
      salesOrder: null,
      commission,
    });
    assert.equal(trace.commission?.status, "FAIL");
    assert.equal(trace.chain[0]?.stage, "COMMISSION");
  });

  it("modo PUBLISHED quando há snapshot materializado", () => {
    const mode = resolveCostToCashCalculationMode({
      hasPublishedPrice: false,
      hasMaterializedCommission: true,
      hasLiveProductRecalc: true,
    });
    assert.equal(mode, "PUBLISHED");
  });

  it("modo DIAGNOSTIC quando só há recálculo ao vivo", () => {
    const mode = resolveCostToCashCalculationMode({
      hasPublishedPrice: false,
      hasMaterializedCommission: false,
      hasLiveProductRecalc: true,
    });
    assert.equal(mode, "DIAGNOSTIC");
  });

  it("diagnósticos agregam alertas das etapas", () => {
    const product = buildEmptyProductCostTraceReport("2026-07-06", "x");
    product.status = "PASS";
    product.alerts = [{ code: "TEST", severity: "warning", message: "Alerta produto" }];
    const diagnostics = collectCostToCashDiagnostics({
      product,
      publishedPrice: null,
      salesOrder: null,
      commission: null,
    });
    assert.ok(diagnostics.some((d) => d.source === "PRODUCT_COST" && d.code === "TEST"));
  });

  it("CSV inclui cadeia e diagnósticos", () => {
    const trace = assembleCostToCashTrace({
      product: null,
      publishedPrice: null,
      salesOrder: buildEmptySalesOrderTraceReport("ok"),
      commission: null,
    });
    trace.diagnostics.push(
      createTraceDiagnostic({
        code: "NO_SCHEDULE",
        severity: "warning",
        message: "Sem schedule",
        source: "COMMISSION",
      })
    );
    const csv = buildCostToCashTraceCsv(trace);
    assert.match(csv, /chain/);
    assert.match(csv, /NO_SCHEDULE/);
  });

  it("texto formatado inclui cadeia", () => {
    const trace = buildEmptyCostToCashTrace("Informe parâmetros");
    const text = formatCostToCashTraceText(trace);
    assert.match(text, /Cost-to-Cash Trace/);
    assert.match(text, /Informe parâmetros/);
  });

  it("status FAIL quando cadeia vazia", () => {
    assert.equal(resolveCostToCashStatus([]), "FAIL");
    const chain = buildCostToCashChain({
      product: null,
      publishedPrice: null,
      salesOrder: buildEmptySalesOrderTraceReport("x"),
      commission: null,
    });
    assert.equal(chain[0]?.status, "FAIL");
  });
});

describe("costToCashTrace script wiring", () => {
  it("scripts de auditoria importam services do motor audit", () => {
    const productScript = readFileSync("scripts/audit-product-cost-trace.ts", "utf8");
    const priceScript = readFileSync("scripts/audit-published-price-trace.ts", "utf8");
    const salesScript = readFileSync("scripts/audit-sales-order-trace.ts", "utf8");
    const commissionScript = readFileSync("scripts/audit-commission-trace.ts", "utf8");
    assert.match(productScript, /src\/lib\/audit\/productCostTrace/);
    assert.match(productScript, /src\/lib\/audit\/costToCashTrace\.server/);
    assert.match(priceScript, /src\/lib\/audit\/publishedPriceTrace/);
    assert.match(priceScript, /src\/lib\/audit\/costToCashTrace\.server/);
    assert.match(salesScript, /src\/lib\/audit\/salesOrderTrace/);
    assert.match(salesScript, /src\/lib\/audit\/costToCashTrace\.server/);
    assert.match(commissionScript, /src\/lib\/audit\/commissionTrace/);
    assert.match(commissionScript, /src\/lib\/audit\/costToCashTrace\.server/);
  });
});
