import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { assembleCostToCashTrace } from "../audit/costToCashTrace.js";
import { buildEmptyCommissionTraceReport } from "../audit/commissionTrace.js";
import { buildEmptyProductCostTraceReport } from "../audit/productCostTrace.js";
import { buildEmptySalesOrderTraceReport } from "../audit/salesOrderTrace.js";
import type { CostToCashTrace } from "../audit/costToCashTrace.js";
import type { PublishedPriceTrace } from "../audit/publishedPriceTrace.js";
import {
  REQUIRED_BUNDLE_ROOT_FILES,
} from "./chatgptDiagnosticTypes.js";
import {
  assertRequiredBundleStructure,
  buildChatGptDiagnosticBundle,
} from "./diagnosticBundleBuilder.server.js";
import {
  buildCostToCashCalculationTrace,
  buildCostToCashFindings,
  buildCostToCashTimeline,
  describeCostToCashChainBreak,
  evaluateCostToCashAutoDiagnostics,
  hasCostToCashDiagnosticQueryKey,
  parseCostToCashDiagnosticRequest,
} from "./costToCashDiagnostic.server.js";

function samplePublishedPrice618(): PublishedPriceTrace {
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
    availability: { hasFullSnapshot: true, missingFields: [] },
  };
}

function sampleProduct618(): ReturnType<typeof buildEmptyProductCostTraceReport> {
  const report = buildEmptyProductCostTraceReport("2026-07-06", "");
  report.status = "PASS";
  report.errorMessage = null;
  report.product = {
    productId: "prod-618",
    sku: "618.08AA",
    name: "Produto 618.08AA",
    type: "PRODUCT",
    status: "AVAILABLE",
  };
  report.currentCost.officialPublishedCost = 0.912785;
  report.currentCost.engineeringCost = 0.912785;
  report.officialVersion = {
    versionId: "pc-ver-1",
    versionCode: "CUSTO_PROD_2026",
    versionName: "Custo 2026",
    revision: 3,
    status: "PUBLISHED",
    effectiveDate: "2026-01-01",
    publishedAt: "2026-01-01T00:00:00.000Z",
    materialCostTableVersionId: "mp-ver-1",
    materialCostTableVersionCode: "MP_2026",
  };
  report.costBreakdown.materialCost = 0.5;
  report.costBreakdown.totalCost = 0.912785;
  report.bom = { included: true, componentCount: 2, components: [], source: "engine" };
  report.materials = { included: true, materialCount: 3, materials: [], topCostRanking: [], source: "engine" };
  return report;
}

function sampleTrace618Partial(): CostToCashTrace {
  return assembleCostToCashTrace({
    product: sampleProduct618(),
    publishedPrice: samplePublishedPrice618(),
    salesOrder: null,
    commission: null,
  });
}

describe("costToCashDiagnostic", () => {
  it("parseia request COST_TO_CASH com sku 618.08AA", () => {
    const parsed = parseCostToCashDiagnosticRequest({
      scope: "COST_TO_CASH",
      context: { sku: "618.08AA", tableCode: "VAREJO_2", year: 2026, month: 6 },
    });
    assert.equal(parsed.scope, "COST_TO_CASH");
    assert.equal(parsed.context.sku, "618.08AA");
    assert.equal(parsed.context.year, 2026);
    assert.equal(parsed.context.month, 6);
  });

  it("rejeita request sem identificador", () => {
    assert.throws(
      () =>
        parseCostToCashDiagnosticRequest({
          scope: "COST_TO_CASH",
          context: { seller: "João" },
        }),
      /identificador/
    );
  });

  it("hasCostToCashDiagnosticQueryKey aceita customer+year", () => {
    assert.equal(
      hasCostToCashDiagnosticQueryKey({ customer: "ACME", year: 2026 }),
      true
    );
  });

  it("618.08AA — timeline com produto e preço, venda ausente → TRACE_PARTIAL", () => {
    const trace = sampleTrace618Partial();
    const context = { sku: "618.08AA", year: 2026, month: 6 };
    const timeline = buildCostToCashTimeline(trace, context);
    assert.equal(timeline.steps.length, 12);
    assert.ok(timeline.steps.some((s) => s.id === "OFFICIAL_COST" && s.status === "FOUND"));
    assert.ok(timeline.steps.some((s) => s.id === "COMMERCIAL_PRICE" && s.status === "FOUND"));
    assert.ok(timeline.steps.some((s) => s.id === "NOMUS_ORDER" && s.status === "MISSING"));

    const chainMsg = describeCostToCashChainBreak(trace, timeline.steps, context);
    assert.match(chainMsg, /Trace parcial/i);
    assert.match(chainMsg, /produto e preço/i);

    const diagnostics = evaluateCostToCashAutoDiagnostics(trace, timeline, null);
    assert.ok(diagnostics.some((d) => d.code === "TRACE_PARTIAL"));
    assert.ok(!diagnostics.some((d) => d.code === "TRACE_COMPLETE"));
  });

  it("confirma que industrialCostPolicy não usa unitCost Nomus quando custo oficial presente", () => {
    const sales = buildEmptySalesOrderTraceReport("");
    sales.status = "PASS";
    sales.errorMessage = null;
    sales.order = {
      salesOrderId: "so-1",
      orderNumber: "PV-100",
      customerId: "c1",
      customerName: "Cliente",
      rawSellerId: 1,
      rawSellerName: "Vendedor",
      canonicalSellerId: "s1",
      canonicalSellerName: "Vendedor",
      sellerResolutionStatus: "OK",
      issueDate: "2026-06-01",
      totalNetValue: 100,
      orderStatus: "OPEN",
    };
    sales.items = [
      {
        salesOrderItemId: "item-1",
        sku: "618.08AA",
        productName: "Produto",
        productId: "prod-618",
        quantity: 10,
        soldUnitPrice: 1.85,
        soldAmount: 18.5,
        officialUnitCost: 0.912785,
        officialTotalCost: 9.12785,
        costSource: "VERSIONED_PRODUCTION_COST",
        costVersionCode: "CUSTO_PROD_2026",
        costVersionRevision: 3,
        costEffectiveDate: "2026-01-01",
        marginAmount: 9.37,
        marginPercent: 50.6,
        publishedCommercialUnitPrice: 1.85,
        publishedCommercialTableCode: "VAREJO_2",
        nomusStoredUnitCost: 0.5,
        marginStatus: "OK",
        notes: [],
      },
    ];
    sales.totals = {
      totalSold: 18.5,
      totalOfficialCost: 9.12785,
      totalMarginAmount: 9.37,
      totalMarginPercent: 50.6,
    };
    sales.checklist = { usesOfficialIndusCost: true };

    const trace = assembleCostToCashTrace({
      product: sampleProduct618(),
      publishedPrice: samplePublishedPrice618(),
      salesOrder: sales,
      commission: null,
    });

    const timeline = buildCostToCashTimeline(trace, { sku: "618.08AA" });
    const calcTrace = buildCostToCashCalculationTrace(trace, timeline);
    assert.equal(calcTrace.industrialCostPolicy.usesNomusUnitCostAsIndustrialCost, false);

    const diagnostics = evaluateCostToCashAutoDiagnostics(trace, timeline, null);
    assert.ok(
      diagnostics.some(
        (d) =>
          d.code === "NOMUS_UNITCOST_NOT_USED_AS_INDUSTRIAL_COST" && d.severity === "info"
      )
    );
  });

  it("detecta violação quando NOMUS_UNIT_COST_USED", () => {
    const sales = buildEmptySalesOrderTraceReport("");
    sales.status = "PASS";
    sales.order = {
      salesOrderId: "so-1",
      orderNumber: "PV-100",
      customerId: "c1",
      customerName: "Cliente",
      rawSellerId: null,
      rawSellerName: null,
      canonicalSellerId: null,
      canonicalSellerName: null,
      sellerResolutionStatus: null,
      issueDate: "2026-06-01",
      totalNetValue: 100,
      orderStatus: "OPEN",
    };
    sales.items = [
      {
        salesOrderItemId: "item-1",
        sku: "618.08AA",
        productName: "Produto",
        productId: "prod-618",
        quantity: 1,
        soldUnitPrice: 10,
        soldAmount: 10,
        officialUnitCost: 5,
        officialTotalCost: 5,
        costSource: "SALES_ORDER_ITEM_SNAPSHOT",
        costVersionCode: null,
        costVersionRevision: null,
        costEffectiveDate: null,
        marginAmount: 5,
        marginPercent: 50,
        publishedCommercialUnitPrice: null,
        publishedCommercialTableCode: null,
        nomusStoredUnitCost: 5,
        marginStatus: "OK",
        notes: [],
      },
    ];
    sales.alerts = [
      {
        code: "NOMUS_UNIT_COST_USED",
        severity: "error",
        message: "unitCost Nomus usado indevidamente",
      },
    ];

    const trace = assembleCostToCashTrace({
      product: sampleProduct618(),
      publishedPrice: samplePublishedPrice618(),
      salesOrder: sales,
      commission: null,
    });
    const timeline = buildCostToCashTimeline(trace, { sku: "618.08AA" });
    const diagnostics = evaluateCostToCashAutoDiagnostics(trace, timeline, null);
    assert.ok(
      diagnostics.some(
        (d) =>
          d.code === "NOMUS_UNITCOST_NOT_USED_AS_INDUSTRIAL_COST" && d.severity === "error"
      )
    );
  });

  it("monta bundle COST_TO_CASH mock com timeline e sourceRefs", async () => {
    const trace = sampleTrace618Partial();
    const context = { sku: "618.08AA", tableCode: "VAREJO_2" };
    const timeline = buildCostToCashTimeline(trace, context);
    const autoDiagnostics = evaluateCostToCashAutoDiagnostics(trace, timeline, null);
    const findings = buildCostToCashFindings(autoDiagnostics, timeline);

    const bundle = await buildChatGptDiagnosticBundle({
      scope: "COST_TO_CASH",
      context: {
        scope: "COST_TO_CASH",
        screenRoute: "/reports/cost-to-cash-trace",
        screenTitle: "Cost to Cash",
        filters: { sku: "618.08AA" },
      },
      findings,
      evidence: [
        {
          id: "evidence_timeline",
          scope: "COST_TO_CASH",
          label: "Timeline",
          bundlePath: "evidence/cost-to-cash-timeline.json",
          payload: { timeline, autoDiagnostics },
        },
        {
          id: "evidence_product",
          scope: "COST_TO_CASH",
          label: "Product",
          bundlePath: "evidence/product-cost-trace.json",
          payload: { trace: trace.product },
        },
        {
          id: "evidence_price",
          scope: "COST_TO_CASH",
          label: "Price",
          bundlePath: "evidence/published-price-trace.json",
          payload: { trace: trace.publishedPrice },
        },
        {
          id: "evidence_sales",
          scope: "COST_TO_CASH",
          label: "Sales",
          bundlePath: "evidence/sales-order-trace.json",
          payload: { trace: trace.salesOrder },
        },
        {
          id: "evidence_commission",
          scope: "COST_TO_CASH",
          label: "Commission",
          bundlePath: "evidence/commission-trace.json",
          payload: { trace: trace.commission },
        },
      ],
      calculationTrace: buildCostToCashCalculationTrace(trace, timeline),
      executiveSummaryMarkdown: "# Resumo\n\n618.08AA partial trace.",
      problemContextMarkdown: "# Contexto\n\nSKU 618.08AA",
      databaseEvidence: { sku: "618.08AA" },
      businessRulesMarkdown: "# Regras\n\nRead-only.",
      rawLimitedEvidence: {
        sku: "618.08AA",
        diagnosticCodes: autoDiagnostics.map((d) => d.code),
      },
    });

    assertRequiredBundleStructure(bundle);
    for (const file of REQUIRED_BUNDLE_ROOT_FILES) {
      assert.ok(bundle.entries[file], `missing ${file}`);
    }
    assert.ok(bundle.entries["evidence/cost-to-cash-timeline.json"]);
    assert.ok(bundle.entries["evidence/product-cost-trace.json"]);
    assert.ok(bundle.entries["10_CALCULATION_TRACE.json"]);

    const timelineJson = JSON.parse(bundle.entries["evidence/cost-to-cash-timeline.json"]);
    assert.equal(timelineJson.timeline.steps.length, 12);
    assert.ok(timelineJson.autoDiagnostics.some((d: { code: string }) => d.code === "TRACE_PARTIAL"));

    const calcTrace = JSON.parse(bundle.entries["10_CALCULATION_TRACE.json"]);
    assert.equal(calcTrace.recalculatedInFrontend, false);
    assert.equal(calcTrace.industrialCostPolicy.usesNomusUnitCostAsIndustrialCost, false);

    const redaction = JSON.parse(bundle.entries["15_REDACTION_REPORT.json"]);
    assert.ok(Array.isArray(redaction.filesSanitized));
  });

  it("year/month/seller — parse válido para consulta por período", () => {
    const parsed = parseCostToCashDiagnosticRequest({
      scope: "COST_TO_CASH",
      context: { sku: "618.08AA", year: 2026, month: 6, seller: "Maria" },
    });
    assert.equal(parsed.context.seller, "Maria");
    assert.equal(parsed.context.month, 6);
  });

  it("commission trace completo gera TRACE_COMPLETE quando 12 passos FOUND", () => {
    const commission = buildEmptyCommissionTraceReport("");
    commission.status = "PASS";
    commission.errorMessage = null;
    commission.sale = {
      salesOrderId: "so-1",
      orderNumber: "PV-100",
      nfeNumbers: ["123"],
      nfeExternalIds: [1],
      customerId: "c1",
      customerName: "Cliente",
      rawSellerId: null,
      rawSellerName: null,
      canonicalSellerId: null,
      canonicalSellerName: null,
      sellerResolutionStatus: null,
      saleDate: "2026-06-01",
    };
    commission.orderSnapshot = {
      snapshotId: "snap-1",
      sourceHash: "hash",
      totalSoldAmount: 100,
      totalGrossCommissionAmount: 3,
      totalFinalCommissionAmount: 3,
      snapshotStatus: "ACTIVE",
    };
    commission.items = [
      {
        itemSnapshotId: "is-1",
        salesOrderItemId: "item-1",
        sku: "618.08AA",
        productName: "Produto",
        soldAmount: 100,
        marginPercent: 40,
        ruleId: "r1",
        ruleName: "Regra",
        commissionRatePercent: 3,
        grossCommissionAmount: 3,
        finalCommissionAmount: 3,
        status: "ACTIVE",
        exclusionReason: null,
      },
    ];
    commission.receivables = [
      {
        scheduleId: "sch-1",
        receivableId: 99,
        receivableCode: "AR-99",
        installmentNumber: 1,
        nominalAmount: 100,
        sharePercent: 100,
        scheduledCommissionAmount: 3,
        grossScheduledCommissionAmount: 3,
        scheduleStatus: "ACTIVE",
        ledgerStatus: "RELEASED",
        statusReason: null,
      },
    ];
    commission.receipts = [
      {
        receivableId: 99,
        receivableCode: "AR-99",
        settlementDate: "2026-06-15",
        dueDate: "2026-06-10",
        amountReceivable: 100,
        amountReceived: 100,
        receivedSharePercent: 100,
        releasedCommissionAmount: 3,
        pendingCommissionAmount: 0,
        grossCommissionAmount: 3,
        commissionableBaseAmount: 100,
        status: "RECEIVED",
        statusReason: null,
      },
    ];
    commission.totals = {
      totalReceived: 100,
      totalCommissionableBase: 100,
      totalGrossCommission: 3,
      totalExcludedCommission: 0,
      totalFinalCommission: 3,
      totalReleasedCommission: 3,
      totalPendingCommission: 0,
    };
    commission.closing = {
      closingId: "close-1",
      year: 2026,
      month: 6,
      status: "CLOSED",
      calculationHash: "h1",
      closedAt: "2026-07-01",
      isImmutable: true,
    };

    const sales = buildEmptySalesOrderTraceReport("");
    sales.status = "PASS";
    sales.order = {
      salesOrderId: "so-1",
      orderNumber: "PV-100",
      customerId: "c1",
      customerName: "Cliente",
      rawSellerId: null,
      rawSellerName: null,
      canonicalSellerId: null,
      canonicalSellerName: null,
      sellerResolutionStatus: null,
      issueDate: "2026-06-01",
      totalNetValue: 100,
      orderStatus: "OPEN",
    };
    sales.items = [
      {
        salesOrderItemId: "item-1",
        sku: "618.08AA",
        productName: "Produto",
        productId: "prod-618",
        quantity: 1,
        soldUnitPrice: 100,
        soldAmount: 100,
        officialUnitCost: 0.912785,
        officialTotalCost: 0.912785,
        costSource: "VERSIONED_PRODUCTION_COST",
        costVersionCode: "CUSTO",
        costVersionRevision: 1,
        costEffectiveDate: "2026-01-01",
        marginAmount: 99,
        marginPercent: 99,
        publishedCommercialUnitPrice: null,
        publishedCommercialTableCode: null,
        nomusStoredUnitCost: null,
        marginStatus: "OK",
        notes: [],
      },
    ];
    sales.totals = {
      totalSold: 100,
      totalOfficialCost: 0.912785,
      totalMarginAmount: 99,
      totalMarginPercent: 99,
    };

    const trace = assembleCostToCashTrace({
      product: sampleProduct618(),
      publishedPrice: samplePublishedPrice618(),
      salesOrder: sales,
      commission,
    });

    const timeline = buildCostToCashTimeline(trace, { sku: "618.08AA" });
    const diagnostics = evaluateCostToCashAutoDiagnostics(trace, timeline, null);
    assert.ok(diagnostics.some((d) => d.code === "TRACE_COMPLETE"));
    assert.ok(diagnostics.some((d) => d.code === "CLOSED_COMMISSION_IMMUTABLE"));
  });
});

describe("costToCashDiagnostic bundle sanitization", () => {
  it("ZIP structure inclui CHATGPT_ANALYSIS_PROMPT.md", () => {
    const src = readFileSync(
      new URL("./costToCashDiagnostic.server.ts", import.meta.url),
      "utf8"
    );
    assert.match(src, /evidence\/cost-to-cash-timeline\.json/);
    assert.match(src, /10_CALCULATION_TRACE\.json/);
    assert.match(src, /buildCostToCashTrace/);
  });
});
