import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { roundPricingMoney, roundPricingPercent } from "@/src/lib/pricingCalculations.js";
import { resolveSalesOrderItemCommercialValues } from "@/src/lib/salesOrderItemCommercialValues.js";
import {
  buildSalesOrderCommercialDiscountCsv,
  buildSalesOrderCommercialDiscountXlsxBuffer,
} from "./salesOrderCommercialDiscountReportExport.js";
import {
  weightedDiscountRate,
  applyCommercialDiscountPeriodOverride,
  buildCommercialDiscountReportSearchParams,
  createDefaultCommercialDiscountYearMonth,
  type CommercialDiscountReportPayload,
} from "./salesOrderCommercialDiscountReport.js";
import {
  buildCommercialDiscountViews,
  computeCommercialDiscountKpis,
  itemMatchesPresence,
  type DiscountReportItemInput,
} from "./salesOrderCommercialDiscountReportMath.js";
import {
  canExportSalesOrderCommercialDiscountReport,
  canViewSalesOrderCommercialDiscountReport,
  canViewSalesOrderCommercialDiscountReportMargin,
} from "../salesOrderCommercialDiscountReportPermissions.js";
import { extractInformedDiscountFromNomusRaw } from "./salesOrderCommercialDiscountReportService.server.js";

/** Fixtures equivalentes ao PD 02820 (Nomus UI). */
const PD02820 = {
  item10: {
    orderedQuantity: 400,
    canceledQuantity: 0,
    grossUnitPrice: 4.32,
    netTotalValue: 1641.6,
  },
  item20: {
    orderedQuantity: 100,
    canceledQuantity: 0,
    grossUnitPrice: 5.97,
    netTotalValue: 567.15,
  },
  item30: {
    orderedQuantity: 100,
    canceledQuantity: 0,
    grossUnitPrice: 5.97,
    netTotalValue: 567.15,
  },
} as const;

function toItem(
  partial: Partial<DiscountReportItemInput> &
    Pick<
      DiscountReportItemInput,
      | "itemId"
      | "grossActiveValue"
      | "discountValue"
      | "discountRate"
      | "netActiveValue"
    >
): DiscountReportItemInput {
  return {
    salesOrderId: partial.salesOrderId ?? "pd-02820",
    orderCode: partial.orderCode ?? "PD 02820",
    issueDate: partial.issueDate ?? "2026-03-15T12:00:00.000Z",
    customerId: partial.customerId ?? "cust-1",
    customerName: partial.customerName ?? "Cliente PD",
    sellerName: partial.sellerName ?? "Vendedor A",
    hasInvoice: partial.hasInvoice ?? false,
    itemId: partial.itemId,
    itemSequence: partial.itemSequence ?? null,
    productId: partial.productId ?? `prod-${partial.itemId}`,
    sku: partial.sku ?? `SKU-${partial.itemId}`,
    productName: partial.productName ?? `Produto ${partial.itemId}`,
    familyName: partial.familyName ?? "Família X",
    activeQuantity: partial.activeQuantity ?? 1,
    grossUnitPrice: partial.grossUnitPrice ?? 0,
    grossActiveValue: partial.grossActiveValue,
    discountValue: partial.discountValue,
    discountRate: partial.discountRate,
    netUnitPrice: partial.netUnitPrice ?? null,
    netActiveValue: partial.netActiveValue,
    commercialAdditionValue: partial.commercialAdditionValue ?? 0,
    discountStatus: partial.discountStatus ?? "DISCOUNT",
    commercialMarginValue: partial.commercialMarginValue ?? null,
    commercialMarginPercent: partial.commercialMarginPercent ?? null,
    marginCalculated: partial.marginCalculated ?? false,
    hasDiscountDivergence: partial.hasDiscountDivergence ?? false,
    divergenceLabel: partial.divergenceLabel ?? null,
  };
}

describe("salesOrderCommercialDiscountReport — ponderação e PD 02820", () => {
  it("desconto total ponderado (nunca média simples) no PD 02820", () => {
    const rows = [PD02820.item10, PD02820.item20, PD02820.item30].map((i, idx) => {
      const c = resolveSalesOrderItemCommercialValues(i);
      return toItem({
        itemId: `i${idx}`,
        activeQuantity: c.activeQuantity,
        grossUnitPrice: c.grossUnitPrice,
        grossActiveValue: c.grossActiveValue,
        discountValue: c.effectiveDiscountValue,
        discountRate: c.effectiveDiscountRate,
        netActiveValue: c.netActiveValue,
        netUnitPrice: c.effectiveNetUnitPrice,
        discountStatus: c.discountStatus,
      });
    });

    const kpis = computeCommercialDiscountKpis(rows);
    assert.equal(kpis.grossActiveTotalValue, 2922);
    assert.equal(kpis.discountTotalValue, 146.1);
    assert.equal(kpis.netActiveTotalValue, 2775.9);
    assert.equal(roundPricingPercent((kpis.discountTotalRate ?? 0) * 100), 5);

    // Média simples dos % seria também 5% neste caso; força desigualdade:
    const mixed = [
      toItem({
        itemId: "a",
        grossActiveValue: 1000,
        discountValue: 100,
        discountRate: 0.1,
        netActiveValue: 900,
        discountStatus: "DISCOUNT",
        activeQuantity: 10,
      }),
      toItem({
        itemId: "b",
        grossActiveValue: 100,
        discountValue: 50,
        discountRate: 0.5,
        netActiveValue: 50,
        discountStatus: "DISCOUNT",
        activeQuantity: 1,
      }),
    ];
    const mixedKpis = computeCommercialDiscountKpis(mixed);
    const simpleAvg = (0.1 + 0.5) / 2;
    const weighted = weightedDiscountRate(150, 1100);
    assert.equal(mixedKpis.discountTotalRate, weighted);
    assert.notEqual(mixedKpis.discountTotalRate, simpleAvg);
    assert.equal(roundPricingPercent((weighted ?? 0) * 100), roundPricingPercent((150 / 1100) * 100));
  });

  it("sem desconto, acréscimo e cancelados excluídos", () => {
    const noDisc = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 10,
      grossUnitPrice: 12.5,
      netTotalValue: 125,
    });
    const addition = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 10,
      grossUnitPrice: 10,
      netTotalValue: 110,
    });
    const canceled = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 5,
      canceledQuantity: 5,
      isFullyCanceled: true,
      grossUnitPrice: 10,
      netTotalValue: 50,
    });

    assert.equal(noDisc.discountStatus, "NO_DISCOUNT");
    assert.equal(addition.discountStatus, "ADDITION");
    assert.equal(canceled.activeQuantity, 0);

    const items = [
      toItem({
        itemId: "nd",
        discountStatus: "NO_DISCOUNT",
        grossActiveValue: noDisc.grossActiveValue,
        discountValue: 0,
        discountRate: 0,
        netActiveValue: noDisc.netActiveValue,
        activeQuantity: noDisc.activeQuantity,
      }),
      toItem({
        itemId: "ad",
        discountStatus: "ADDITION",
        grossActiveValue: addition.grossActiveValue,
        discountValue: 0,
        discountRate: 0,
        commercialAdditionValue: addition.commercialAdditionValue,
        netActiveValue: addition.netActiveValue,
        activeQuantity: addition.activeQuantity,
      }),
      toItem({
        itemId: "ca",
        discountStatus: "NO_ACTIVE_VALUE",
        grossActiveValue: 0,
        discountValue: 0,
        discountRate: 0,
        netActiveValue: 0,
        activeQuantity: 0,
      }),
    ];

    const kpis = computeCommercialDiscountKpis(items);
    assert.equal(kpis.itemsActive, 2);
    assert.equal(kpis.itemsWithDiscount, 0);
    assert.equal(kpis.itemsWithAddition, 1);
    assert.equal(kpis.commercialAdditionTotalValue, addition.commercialAdditionValue);
    assert.ok(itemMatchesPresence(items[1]!, "with_addition"));
    assert.ok(!itemMatchesPresence(items[0]!, "with_discount"));
  });

  it("margem parcial: cobertura e % ponderada", () => {
    const items = [
      toItem({
        itemId: "ok",
        grossActiveValue: 200,
        discountValue: 10,
        discountRate: 0.05,
        netActiveValue: 190,
        commercialMarginValue: 40,
        commercialMarginPercent: 21.052631,
        marginCalculated: true,
        discountStatus: "DISCOUNT",
        activeQuantity: 2,
      }),
      toItem({
        itemId: "miss",
        grossActiveValue: 100,
        discountValue: 5,
        discountRate: 0.05,
        netActiveValue: 95,
        marginCalculated: false,
        discountStatus: "DISCOUNT",
        activeQuantity: 1,
      }),
    ];
    const kpis = computeCommercialDiscountKpis(items);
    assert.equal(kpis.commercialMarginTotalValue, 40);
    assert.equal(kpis.itemsMarginUnavailable, 1);
    assert.ok((kpis.commercialMarginCoveragePercent ?? 0) < 100);
    assert.equal(
      kpis.commercialMarginTotalPercent,
      roundPricingPercent((40 / 190) * 100)
    );
  });

  it("visões agregam desconto por vendedor/cliente e divergência", () => {
    const items = [
      toItem({
        itemId: "1",
        sellerName: "Ana",
        customerName: "Cliente A",
        customerId: "cA",
        grossActiveValue: 1000,
        discountValue: 100,
        discountRate: 0.1,
        netActiveValue: 900,
        discountStatus: "DISCOUNT",
        activeQuantity: 10,
        hasDiscountDivergence: true,
        divergenceLabel: "DISCOUNT_RATE_MISMATCH",
        familyName: "Tubos",
      }),
      toItem({
        itemId: "2",
        sellerName: "Ana",
        customerName: "Cliente B",
        customerId: "cB",
        grossActiveValue: 500,
        discountValue: 25,
        discountRate: 0.05,
        netActiveValue: 475,
        discountStatus: "DISCOUNT",
        activeQuantity: 5,
        familyName: "Tubos",
      }),
    ];
    const views = buildCommercialDiscountViews(items, items);
    assert.equal(views.bySeller[0]?.label, "Ana");
    assert.equal(views.bySeller[0]?.discountValue, 125);
    assert.equal(views.divergenceItemCount, 1);
    assert.equal(views.byFamily[0]?.label, "Tubos");
    assert.ok((views.topOrdersByDiscountValue[0]?.discountValue ?? 0) > 0);
  });
});

describe("salesOrderCommercialDiscountReport — permissões e export", () => {
  it("permissões: margem exige chave específica", () => {
    const viewer = { hasPermission: (k: string) => k === "sales_orders.view" };
    assert.equal(canViewSalesOrderCommercialDiscountReport(viewer), true);
    assert.equal(canExportSalesOrderCommercialDiscountReport(viewer), true);
    assert.equal(canViewSalesOrderCommercialDiscountReportMargin(viewer), false);

    const marginUser = {
      hasPermission: (k: string) => k === "sales_orders.flow.values.view",
    };
    assert.equal(canViewSalesOrderCommercialDiscountReportMargin(marginUser), true);
  });

  it("export CSV/XLSX espelha KPIs e não inclui custo", () => {
    const payload: CommercialDiscountReportPayload = {
      title: "Relatório de descontos comerciais",
      subtitle: "teste",
      generatedAt: "2026-07-28T12:00:00.000Z",
      emitterName: "Tester",
      filters: {
        startDate: null,
        endDate: null,
        year: null,
        month: null,
        customerId: null,
        customerName: null,
        sellerKey: null,
        sellerLabel: null,
        productId: null,
        productQuery: null,
        family: null,
        discountRateMin: null,
        discountRateMax: null,
        marginPercentMin: null,
        marginPercentMax: null,
        presence: "all",
        billing: "all",
        page: 1,
        pageSize: 50,
        sortBy: "discountValue",
        sortDir: "desc",
      },
      filterLabels: [],
      kpis: {
        grossActiveTotalValue: 2922,
        discountTotalValue: 146.1,
        discountTotalRate: 0.05,
        netActiveTotalValue: 2775.9,
        commercialAdditionTotalValue: 0,
        commercialMarginTotalValue: 500,
        commercialMarginTotalPercent: 18,
        commercialMarginCoveragePercent: 100,
        ordersInScope: 1,
        ordersWithDiscount: 1,
        itemsActive: 3,
        itemsWithDiscount: 3,
        itemsWithAddition: 0,
        itemsMarginUnavailable: 0,
        itemsWithDiscountDivergence: 0,
      },
      views: {
        monthlyEvolution: [],
        bySeller: [],
        byCustomer: [],
        byProduct: [],
        byFamily: [],
        topOrdersByDiscountValue: [],
        topOrdersByDiscountRate: [],
        highDiscountLowMarginProducts: [],
        kpisBeforeBandFilters: {
          grossActiveTotalValue: 2922,
          discountTotalValue: 146.1,
          discountTotalRate: 0.05,
          netActiveTotalValue: 2775.9,
          commercialAdditionTotalValue: 0,
          commercialMarginTotalValue: 500,
          commercialMarginTotalPercent: 18,
          commercialMarginCoveragePercent: 100,
          ordersInScope: 1,
          ordersWithDiscount: 1,
          itemsActive: 3,
          itemsWithDiscount: 3,
          itemsWithAddition: 0,
          itemsMarginUnavailable: 0,
          itemsWithDiscountDivergence: 0,
        },
        divergenceItemCount: 0,
      },
      rows: [
        {
          salesOrderId: "pd-02820",
          orderCode: "PD 02820",
          issueDate: "2026-03-15T12:00:00.000Z",
          customerId: "c1",
          customerName: "Cliente",
          sellerName: "Vendedor",
          hasInvoice: false,
          itemId: "i1",
          itemSequence: "00010",
          productId: "p1",
          sku: "SKU",
          productName: "Produto",
          familyName: "Família",
          activeQuantity: 400,
          grossUnitPrice: 4.32,
          grossActiveValue: 1728,
          discountValue: 86.4,
          discountRate: 0.05,
          netUnitPrice: 4.104,
          netActiveValue: 1641.6,
          commercialMarginValue: 200,
          commercialMarginPercent: 12.18,
          marginStatus: "CALCULATED",
          marginStatusLabel: "Calculada",
          discountStatus: "DISCOUNT",
          discountStatusLabel: "Com desconto",
          hasDiscountDivergence: false,
          divergenceLabel: null,
        },
      ],
      pagination: { page: 1, pageSize: 50, totalRows: 1, totalPages: 1 },
      meta: {
        ordersLoaded: 1,
        ordersTakeLimit: 5000,
        truncated: false,
        includeMargin: true,
        queryBudgetOrders: 5000,
      },
    };

    const csv = buildSalesOrderCommercialDiscountCsv(payload);
    assert.match(csv, /PD 02820/);
    assert.match(csv, /Valor concedido em descontos/);
    assert.match(csv, /Margem comercial/);
    assert.doesNotMatch(csv.toLowerCase(), /custo unitário|unit cost|comiss[aã]o/);

    const xlsx = buildSalesOrderCommercialDiscountXlsxBuffer(payload);
    assert.ok(xlsx.byteLength > 100);
  });

  it("extrai desconto informado do raw Nomus", () => {
    const extracted = extractInformedDiscountFromNomusRaw({
      percentualDesconto: 5,
      valorDesconto: 86.4,
    });
    assert.equal(extracted.informedDiscountRate, 0.05);
    assert.equal(extracted.informedDiscountValue, 86.4);
  });

  it("performance: agregação linear em lote sintético", () => {
    const items: DiscountReportItemInput[] = [];
    for (let i = 0; i < 2000; i += 1) {
      items.push(
        toItem({
          itemId: `x${i}`,
          salesOrderId: `o${i % 200}`,
          orderCode: `PD ${i}`,
          grossActiveValue: 100,
          discountValue: i % 3 === 0 ? 10 : 0,
          discountRate: i % 3 === 0 ? 0.1 : 0,
          netActiveValue: i % 3 === 0 ? 90 : 100,
          discountStatus: i % 3 === 0 ? "DISCOUNT" : "NO_DISCOUNT",
          activeQuantity: 1,
          marginCalculated: i % 4 !== 0,
          commercialMarginValue: i % 4 !== 0 ? 20 : null,
          commercialMarginPercent: i % 4 !== 0 ? 22 : null,
        })
      );
    }
    const started = Date.now();
    const kpis = computeCommercialDiscountKpis(items);
    const views = buildCommercialDiscountViews(items, items);
    const elapsed = Date.now() - started;
    assert.equal(kpis.itemsActive, 2000);
    assert.ok(views.bySeller.length >= 1);
    assert.ok(elapsed < 500, `agregação demorou ${elapsed}ms`);
  });
});

describe("commercial discount year/month + period override", () => {
  it("default carrega ano corrente sem mês", () => {
    const defaults = createDefaultCommercialDiscountYearMonth(
      new Date(2026, 6, 30)
    );
    assert.equal(defaults.year, "2026");
    assert.equal(defaults.month, "");
  });

  it("query default envia year e não envia startDate", () => {
    const params = buildCommercialDiscountReportSearchParams({
      year: "2026",
      month: "",
      startDate: "",
      endDate: "",
    });
    assert.equal(params.get("year"), "2026");
    assert.equal(params.get("month"), null);
    assert.equal(params.get("startDate"), null);
  });

  it("período sobrescreve year/month na query", () => {
    const params = buildCommercialDiscountReportSearchParams({
      year: "2026",
      month: "7",
      startDate: "2026-01-15",
      endDate: "2026-02-20",
    });
    assert.equal(params.get("startDate"), "2026-01-15");
    assert.equal(params.get("endDate"), "2026-02-20");
    assert.equal(params.get("year"), null);
    assert.equal(params.get("month"), null);
  });

  it("applyCommercialDiscountPeriodOverride limpa year/month no server", () => {
    const overridden = applyCommercialDiscountPeriodOverride({
      year: "2026",
      month: "7",
      startDate: "2026-03-01",
      endDate: "",
      customerId: "c1",
    });
    assert.equal(overridden.year, undefined);
    assert.equal(overridden.month, undefined);
    assert.equal(overridden.startDate, "2026-03-01");
    assert.equal(overridden.customerId, "c1");
  });
});
