import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildOrderToCashFunnelDetailPayload,
  buildOrderToCashFunnelListPayload,
  canViewOrderToCashFunnel,
  ORDER_TO_CASH_FUNNEL_VIEW_PERMISSIONS,
  OrderToCashFunnelApiParseError,
  parseOrderToCashFunnelFilters,
  type OrderToCashFunnelEnrichedRow,
} from "./salesOrderToCashFunnelApi.js";
import { classifySalesOrderToCashFunnelRow } from "./salesOrderToCashFunnelClassification.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function enriched(
  partial: Partial<OrderToCashFunnelEnrichedRow> & { orderId: string }
): OrderToCashFunnelEnrichedRow {
  const base = classifySalesOrderToCashFunnelRow({
    today: "2026-07-11",
    order: {
      id: partial.orderId,
      orderCode: partial.orderCode ?? partial.orderId,
      totalNetValue: partial.orderValue ?? 100_000,
      issueDate: partial.issueDate ?? "2026-06-01",
      expectedDeliveryDate: partial.expectedDeliveryDate ?? "2026-08-15",
      status: partial.isCanceled ? "CANCELLED" : "OPEN",
      customerId: partial.customerId ?? "c1",
      customerName: partial.customerName ?? "Cliente A",
      sellerId: partial.sellerId ?? "s1",
      sellerName: partial.sellerName ?? "Vendedor A",
    },
    fulfillmentMap: partial.funnelStage
      ? undefined
      : {
          financialStatus: "FIN_SEM_CR",
          fulfillmentSummary: { orderValue: partial.orderValue ?? 100_000 },
        },
    receivables:
      partial.funnelStage === "CR_ABERTO" || partial.hasOpenCr
        ? [{ openValue: partial.orderValue ?? 100_000, receivedValue: 0, totalValue: 100_000 }]
        : partial.funnelStage === "RECEBIDO" || partial.hasReceipt
          ? [{ openValue: 0, receivedValue: partial.orderValue ?? 100_000, totalValue: 100_000 }]
          : [],
  });

  return {
    ...base,
    ...partial,
    orderId: partial.orderId,
    issueDate: partial.issueDate ?? base.daysSinceIssue != null ? "2026-06-01" : "2026-06-01",
    expectedDeliveryDate: partial.expectedDeliveryDate ?? "2026-08-15",
    financialStatus: partial.financialStatus ?? null,
    operationalStatus: partial.operationalStatus ?? null,
    fulfillmentPercent: partial.fulfillmentPercent ?? null,
    forecastDate: partial.forecastDate ?? "2026-08-15",
    forecastValue: partial.forecastValue ?? partial.orderValue ?? base.orderValue,
    lastEvidenceDate: partial.lastEvidenceDate ?? "2026-06-01",
    companyId: partial.companyId ?? null,
    companyName: partial.companyName ?? null,
    productSkus: partial.productSkus ?? ["SKU-1"],
    productNames: partial.productNames ?? ["Produto 1"],
    axisDates: partial.axisDates ?? {
      ORDER_ISSUE_DATE: "2026-06-01",
      EXPECTED_DELIVERY_DATE: "2026-08-15",
      FORECAST_DATE: "2026-08-15",
    },
    updatedAt: partial.updatedAt ?? "2026-07-01",
  };
}

describe("salesOrderToCashFunnelApi", () => {
  it("1. parse de filtros", () => {
    const filters = parseOrderToCashFunnelFilters({
      cliente: "Britânia",
      vendedor: "Ana",
      empresa: "Lazarios",
      pedido: "PD02339",
      produto: "SKU-9",
      estagio: "CR_ABERTO",
      grupo: "FINANCEIRO",
      temperatura: "MORNO",
      confianca: "ALTA",
      alerta: "CR_VENCIDO",
      valorMinimo: "1000",
      valorMaximo: "500000",
      dateAxis: "ORDER_ISSUE_DATE",
      dateFrom: "2026-01-01",
      dateTo: "2026-12-31",
      page: "2",
      pageSize: "25",
    });
    assert.equal(filters.customerName, "Britânia");
    assert.equal(filters.sellerName, "Ana");
    assert.equal(filters.companyName, "Lazarios");
    assert.equal(filters.orderCode, "PD02339");
    assert.equal(filters.productSku, "SKU-9");
    assert.equal(filters.funnelStage, "CR_ABERTO");
    assert.equal(filters.stageGroup, "FINANCEIRO");
    assert.equal(filters.temperature, "MORNO");
    assert.equal(filters.confidenceLabel, "ALTA");
    assert.equal(filters.alert, "CR_VENCIDO");
    assert.equal(filters.minValue, 1000);
    assert.equal(filters.maxValue, 500000);
    assert.equal(filters.dateAxis, "ORDER_ISSUE_DATE");
    assert.equal(filters.page, 2);
    assert.equal(filters.pageSize, 25);

    assert.throws(
      () => parseOrderToCashFunnelFilters({ dateFrom: "2026-01-01" }),
      (err: unknown) =>
        err instanceof OrderToCashFunnelApiParseError &&
        /dateAxis/i.test(err.message)
    );
    assert.throws(
      () => parseOrderToCashFunnelFilters({ dateAxis: "INVALID" }),
      OrderToCashFunnelApiParseError
    );
  });

  it("2. endpoint rejeita sem permissão", () => {
    const routes = read("src/lib/salesOrderToCashFunnelRoutes.ts");
    assert.match(routes, /requireAppAuth/);
    assert.match(
      routes,
      /requireAnyPermission\(\[\.\.\.ORDER_TO_CASH_FUNNEL_VIEW_PERMISSIONS\]\)/
    );
    assert.equal(
      canViewOrderToCashFunnel({
        hasPermission: () => false,
        hasAnyPermission: () => false,
      }),
      false
    );
    assert.equal(
      canViewOrderToCashFunnel({
        hasAnyPermission: (ps) => ps.includes("sales_orders.view"),
      }),
      true
    );
    assert.ok(ORDER_TO_CASH_FUNNEL_VIEW_PERMISSIONS.includes("sales_orders.view"));
    const server = read("server.ts");
    assert.match(server, /registerSalesOrderToCashFunnelRoutes/);
  });

  it("3-5. payload tem summaryCards, funnelStages e rows", () => {
    const filters = parseOrderToCashFunnelFilters({ page: "1", pageSize: "50" });
    const payload = buildOrderToCashFunnelListPayload({
      filters,
      enrichedRows: [
        enriched({
          orderId: "o1",
          orderValue: 50_000,
          expectedDeliveryDate: "2026-09-01",
        }),
        enriched({
          orderId: "o2",
          orderValue: 80_000,
          hasOpenCr: true,
          funnelStage: "CR_ABERTO",
        }),
      ],
      dataFreshness: {
        sourceLabel: "test",
        runId: "run-1",
        runFinishedAt: "2026-07-10",
        isLatestRun: true,
        lastEvidenceDate: "2026-07-01",
        warnings: [],
        laymanNotice: "aviso",
      },
    });

    assert.ok(payload.summaryCards.length >= 10);
    assert.ok(payload.funnelStages.length > 0);
    assert.ok(payload.rows.length >= 1);
    assert.equal(payload.ok, true);
  });

  it("6. rows têm estágio único", () => {
    const filters = parseOrderToCashFunnelFilters({});
    const rows = [
      enriched({ orderId: "a", hasOpenCr: true }),
      enriched({
        orderId: "b",
        hasReceipt: true,
      }),
    ];
    const payload = buildOrderToCashFunnelListPayload({
      filters,
      enrichedRows: rows,
      dataFreshness: {
        sourceLabel: "test",
        runId: null,
        runFinishedAt: null,
        isLatestRun: null,
        lastEvidenceDate: null,
        warnings: [],
        laymanNotice: "",
      },
    });
    const ids = new Set(payload.rows.map((r) => r.salesOrderId));
    assert.equal(ids.size, payload.rows.length);
    for (const row of payload.rows) {
      assert.ok(row.funnelStage);
      assert.equal(
        payload.rows.filter((r) => r.salesOrderId === row.salesOrderId).length,
        1
      );
    }
  });

  it("7. detalhe retorna fulfillmentMap quando disponível", () => {
    const row = enriched({ orderId: "det-1", hasOpenCr: true });
    const detail = buildOrderToCashFunnelDetailPayload({
      salesOrderId: "det-1",
      enrichedRow: row,
      fulfillmentMap: {
        financialStatus: "FIN_CR_ABERTO",
        operationalStatus: "OP_TOTALMENTE_ATENDIDO",
        fulfillmentSummary: { fulfillmentPercent: 100 },
        executiveConclusion: "Pedido com CR aberto.",
      },
      timeline: [{ at: "2026-06-01", kind: "ORDER_ISSUE", label: "Emissão", detail: null }],
      documents: [],
      nfes: [],
      receivables: [{ receivableId: 1, dueDate: "2026-08-01", settlementDate: null, totalValue: 100, receivedValue: 0, openValue: 100 }],
      freshness: {
        sourceLabel: "test",
        runId: "run-1",
        runFinishedAt: "2026-07-10",
        isLatestRun: true,
        lastEvidenceDate: "2026-06-01",
        warnings: [],
        laymanNotice: "",
      },
      executiveConclusion: "Pedido com CR aberto.",
    });
    assert.equal(detail.ok, true);
    assert.ok(detail.fulfillmentMap);
    assert.equal(
      (detail.fulfillmentMap as { financialStatus: string }).financialStatus,
      "FIN_CR_ABERTO"
    );
  });

  it("8. detalhe retorna timeline", () => {
    const row = enriched({ orderId: "det-2" });
    const detail = buildOrderToCashFunnelDetailPayload({
      salesOrderId: "det-2",
      enrichedRow: row,
      fulfillmentMap: null,
      timeline: [
        { at: "2026-06-01", kind: "ORDER_ISSUE", label: "Emissão do pedido", detail: null },
        { at: "2026-07-01", kind: "NFE", label: "NF emitida", detail: null },
      ],
      documents: [],
      nfes: [],
      receivables: [],
      freshness: null,
      executiveConclusion: row.explanation,
    });
    assert.ok(detail.timeline.length >= 2);
    assert.equal(detail.timeline[0]!.kind, "ORDER_ISSUE");
  });

  it("9. erro é amigável", () => {
    const routes = read("src/lib/salesOrderToCashFunnelRoutes.ts");
    assert.match(routes, /financeApiErrorJson/);
    assert.match(routes, /Erro ao carregar o Funil Pedido → Caixa/);
    assert.match(routes, /Falha interna ao montar o funil/);
    assert.doesNotMatch(routes, /stack/);
    try {
      parseOrderToCashFunnelFilters({ estagio: "INVALID_STAGE" });
      assert.fail("esperava parse error");
    } catch (err) {
      assert.ok(err instanceof OrderToCashFunnelApiParseError);
      assert.match(err.message, /estágio inválido/i);
      assert.doesNotMatch(err.message, /Prisma|stack/i);
    }
  });

  it("10. não expõe Prisma", () => {
    const api = read("src/lib/sales/salesOrderToCashFunnelApi.ts");
    const routes = read("src/lib/salesOrderToCashFunnelRoutes.ts");
    assert.doesNotMatch(api, /from\s+["'][^"']*prisma/i);
    assert.doesNotMatch(routes, /prisma\./i);
    assert.doesNotMatch(routes, /PrismaClient/);
  });

  it("11. não usa comissões", () => {
    const api = read("src/lib/sales/salesOrderToCashFunnelApi.ts");
    const server = read("src/lib/sales/salesOrderToCashFunnelApi.server.ts");
    const routes = read("src/lib/salesOrderToCashFunnelRoutes.ts");
    for (const src of [api, server, routes]) {
      assert.doesNotMatch(src, /from\s+["'][^"']*comiss/i);
      assert.doesNotMatch(src, /from\s+["'][^"']*commission/i);
      assert.doesNotMatch(src, /CommissionOrderSnapshot|estimatedCommission/);
    }
  });

  it("12. não usa proposta como fonte oficial", () => {
    const api = read("src/lib/sales/salesOrderToCashFunnelApi.ts");
    const server = read("src/lib/sales/salesOrderToCashFunnelApi.server.ts");
    const routes = read("src/lib/salesOrderToCashFunnelRoutes.ts");
    for (const src of [api, server, routes]) {
      assert.doesNotMatch(src, /from\s+["'][^"']*proposal/i);
      assert.doesNotMatch(src, /salesFunnel\.ts/);
      assert.doesNotMatch(src, /ProposalStatus/);
    }
    assert.match(
      server,
      /Conciliação de Carteira|classifySalesOrderToCashFunnelRow|portfolio/
    );
  });
});
