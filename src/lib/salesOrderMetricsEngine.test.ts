import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { salesOrderHasInvoicing } from "./customerCommercialSalesOrderView.js";
import { buildSalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import {
  aggregateSalesOrderMetrics,
  buildOperationalFunnelStages,
  buildSalesOrderEnrichedMetricsBatch,
  isSalesOrderDemandEligible,
  matchesMaterialDemandInvoicingScope,
  resolveSalesOrderHasNfe,
  SALES_ORDER_METRICS_ENGINE_VERSION,
} from "./salesOrderMetricsEngine.js";

const REF = new Date(2026, 5, 20);

function linkedContext(totalNetValue: number, nfeValue: number, due: Date) {
  return buildSalesOrderLinkedNfeContext({
    links: [
      {
        id: "l1",
        nfeExternalId: 1,
        nfeNumber: "1001",
        nfeKey: null,
        nfeStatus: 100,
        tipoOperacao: 1,
        dataProcessamento: new Date(2026, 5, 15),
        presentInLastPayload: true,
        nomusNfeId: "nomus-1",
        rawPayload: { valor: nfeValue },
      },
      {
        id: "l2",
        nfeExternalId: 2,
        nfeNumber: "1002",
        nfeKey: null,
        nfeStatus: 100,
        tipoOperacao: 1,
        dataProcessamento: new Date(2026, 5, 18),
        presentInLastPayload: true,
        nomusNfeId: "nomus-2",
        rawPayload: { valor: nfeValue },
      },
    ],
    nomusNfesByExternalId: new Map([
      [
        1,
        {
          id: "nomus-1",
          externalId: 1,
          numero: "1001",
          chave: null,
          status: 100,
          tipoOperacao: 1,
          dataProcessamento: new Date(2026, 5, 15),
          xmlDhEmi: null,
          valorLiquido: nfeValue,
          xmlVNF: nfeValue,
        },
      ],
      [
        2,
        {
          id: "nomus-2",
          externalId: 2,
          numero: "1002",
          chave: null,
          status: 100,
          tipoOperacao: 1,
          dataProcessamento: new Date(2026, 5, 18),
          xmlDhEmi: null,
          valorLiquido: nfeValue,
          xmlVNF: nfeValue,
        },
      ],
    ]),
    totalNetValue,
    issueDate: new Date(2026, 5, 1),
    expectedDeliveryDate: due,
    referenceDate: REF,
  });
}

const baseOrderInput = {
  id: "so-multi",
  orderCode: "PD-MULTI",
  status: "SENT_TO_NOMUS",
  customerId: "cust-1",
  issueDate: new Date(2026, 5, 1),
  expectedDeliveryDate: new Date(2026, 5, 25),
  totalNetValue: 1000,
  responsible: "Vendedor A",
  nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 10 }] },
  companyIssuer: "Empresa",
  Customer: { companyName: "Cliente X", tradeName: null, taxId: null },
  items: [
    {
      id: "item-1",
      externalProductId: 1,
      skuSnapshot: "SKU-1",
      productNameSnapshot: "Produto",
      quantity: 10,
    },
  ],
};

describe("salesOrderMetricsEngine", () => {
  it("expõe versão do motor", () => {
    assert.match(SALES_ORDER_METRICS_ENGINE_VERSION, /^\d+\.\d+\.\d+$/);
  });

  it("pedido com múltiplas NF-es aparece uma vez em KPIs e soma NF corretamente", () => {
    const ctx = linkedContext(1000, 500, new Date(2026, 5, 25));
    const linkedMap = new Map([["so-multi", ctx]]);
    const metrics = buildSalesOrderEnrichedMetricsBatch([baseOrderInput], REF, linkedMap);
    assert.equal(metrics.length, 1);
    const m = metrics[0]!;
    assert.equal(m.nfeCount, 2);
    assert.equal(m.hasNfe, true);
    assert.equal(m.nfeTotalValue, 1000);
    assert.equal(m.totalNetValue, 1000);

    const agg = aggregateSalesOrderMetrics(metrics);
    assert.equal(agg.totalOrders, 1);
    assert.equal(agg.totalSoldValue, 1000);
    assert.equal(agg.totalInvoicedValue, 1000);
    assert.equal(agg.withNfeCount, 1);
  });

  it("resolveSalesOrderHasNfe usa linked context quando disponível", () => {
    const ctx = linkedContext(1000, 1000, new Date(2026, 5, 25));
    assert.equal(
      resolveSalesOrderHasNfe({ nomusRawResponse: { nfes: [] }, linkedNfeContext: ctx }),
      true
    );
    assert.equal(resolveSalesOrderHasNfe({ nomusRawResponse: { nfes: [] } }), false);
  });

  it("salesOrderHasInvoicing delega ao motor (raw fallback)", () => {
    assert.equal(
      salesOrderHasInvoicing({ nfes: [{ dataProcessamento: "15/06/2026" }] }),
      true
    );
    assert.equal(salesOrderHasInvoicing({ nfes: [{ dataProcessamento: "" }] }), false);
  });

  it("buildOperationalFunnelStages cobre jornada operacional", () => {
    const ctx = linkedContext(1000, 1000, new Date(2026, 5, 25));
    const linkedMap = new Map([["so-multi", ctx]]);
    const metrics = buildSalesOrderEnrichedMetricsBatch([baseOrderInput], REF, linkedMap);
    const stages = buildOperationalFunnelStages(metrics);
    const ids = stages.map((s) => s.id);
    assert.ok(ids.includes("sold"));
    assert.ok(ids.includes("withNfe"));
    assert.ok(ids.includes("invoicedOnTime"));
  });

  it("isSalesOrderDemandEligible exclui cancelados", () => {
    const ctx = linkedContext(1000, 1000, new Date(2026, 5, 25));
    const linkedMap = new Map([["so-multi", ctx]]);
    const active = buildSalesOrderEnrichedMetricsBatch([baseOrderInput], REF, linkedMap)[0]!;
    assert.equal(isSalesOrderDemandEligible(active), true);

    const cancelled = buildSalesOrderEnrichedMetricsBatch(
      [{ ...baseOrderInput, id: "so-cancel", status: "CANCELLED" }],
      REF,
      linkedMap
    )[0]!;
    assert.equal(isSalesOrderDemandEligible(cancelled), false);
  });

  it("matchesMaterialDemandInvoicingScope distingue portfolio e faturado", () => {
    const pending = buildSalesOrderEnrichedMetricsBatch(
      [{ ...baseOrderInput, id: "so-pending", nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 10 }] } }],
      REF
    )[0]!;
    assert.equal(matchesMaterialDemandInvoicingScope(pending, "portfolio"), true);
    assert.equal(matchesMaterialDemandInvoicingScope(pending, "invoiced"), false);

    const ctx = linkedContext(1000, 1000, new Date(2026, 5, 25));
    const fullyInvoiced = buildSalesOrderEnrichedMetricsBatch(
      [{ ...baseOrderInput, id: "so-full" }],
      REF,
      new Map([["so-full", ctx]])
    )[0]!;
    assert.equal(matchesMaterialDemandInvoicingScope(fullyInvoiced, "invoiced"), true);
  });

  it("status logístico é consistente entre batch e DTO", () => {
    const ctx = linkedContext(1000, 1000, new Date(2026, 5, 25));
    const m = buildSalesOrderEnrichedMetricsBatch(
      [baseOrderInput],
      REF,
      new Map([["so-multi", ctx]])
    )[0]!;
    assert.equal(m.hasNfe, true);
    assert.ok(["deliveredOnTime", "onTimePending", "deliveredLate"].includes(m.logisticStatusCardId));
    assert.equal(m.isFullyInvoiced, true);
  });

  it("Dashboard e funil importam motor único", () => {
    const dashboard = readFileSync(
      join(process.cwd(), "src/lib/salesOrdersDashboardMetrics.ts"),
      "utf8"
    );
    const funnel = readFileSync(
      join(process.cwd(), "src/lib/salesFunnelDashboardMetrics.ts"),
      "utf8"
    );
    assert.match(dashboard, /salesOrderMetricsEngine/);
    assert.match(funnel, /loadSalesOrderEnrichedMetricsForIssueYear/);
    assert.match(funnel, /buildOperationalFunnelStages/);
  });

  it("Gestão de Pedidos continua no mesmo pipeline do motor", () => {
    const management = readFileSync(join(process.cwd(), "src/lib/salesOrderManagement.ts"), "utf8");
    assert.match(management, /buildManagementRowsFromOrders/);
    assert.match(management, /salesOrderManagementFulfillment/);
  });

  it("materialDemand exclui cancelados do escopo", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/materialDemandPlannedRealized.ts"), "utf8");
    assert.match(src, /isCancelledSalesOrderStatus/);
  });
});
