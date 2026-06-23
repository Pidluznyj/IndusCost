import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  BI_LOGISTIC_STATUS_CARDS,
  buildSalesOrderBiLogisticStatus,
} from "./salesOrderLogisticStatus.js";
import { buildSalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import {
  aggregateSalesOrderMetrics,
  buildSalesOrderEnrichedMetricsBatch,
  isSalesOrderDemandEligible,
} from "./salesOrderMetricsEngine.js";
import {
  INVOICE_FILTER_OPTIONS,
  CUT_FILTER_OPTIONS,
  FULFILLMENT_FILTER_OPTIONS,
} from "./salesOrderManagementUi.js";

const REF = new Date(2026, 5, 20);

function read(rel: string) {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function linkedCtx(total: number, nfeVal: number, due: Date) {
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
        nomusNfeId: "n1",
        rawPayload: { valor: nfeVal },
      },
    ],
    nomusNfesByExternalId: new Map([
      [
        1,
        {
          id: "n1",
          externalId: 1,
          numero: "1001",
          chave: null,
          status: 100,
          tipoOperacao: 1,
          dataProcessamento: new Date(2026, 5, 15),
          xmlDhEmi: null,
          valorLiquido: nfeVal,
          xmlVNF: nfeVal,
        },
      ],
    ]),
    totalNetValue: total,
    issueDate: new Date(2026, 5, 1),
    expectedDeliveryDate: due,
    referenceDate: REF,
  });
}

const orderBase = {
  id: "so-val",
  orderCode: "PD-VAL",
  status: "SENT_TO_NOMUS",
  customerId: "c1",
  issueDate: new Date(2026, 5, 1),
  expectedDeliveryDate: new Date(2026, 5, 25),
  totalNetValue: 1000,
  responsible: "Vendedor",
  nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 10 }] },
  companyIssuer: "Empresa",
  Customer: { companyName: "Cliente", tradeName: null, taxId: null },
  items: [
    {
      id: "i1",
      externalProductId: 1,
      skuSnapshot: "SKU",
      productNameSnapshot: "Produto",
      quantity: 10,
    },
  ],
};

describe("salesOrderFinalValidation — pré-requisitos", () => {
  it("documentos e scripts de auditoria existem", () => {
    assert.ok(existsSync("docs/audits/sales-order-consumers-audit.md"));
    assert.ok(existsSync("docs/audits/sales-order-final-validation.md"));
    assert.ok(existsSync("scripts/audit-sales-order-final-validation.ts"));
    assert.ok(existsSync("scripts/audit-sales-order-consumers-after-migration.ts"));
    assert.ok(existsSync("scripts/backfill-sales-order-nfe-links.ts"));
    assert.ok(existsSync("src/lib/salesOrderMetricsEngine.ts"));
    assert.ok(existsSync("prisma/migrations/20260626120000_sales_order_nfe_link/migration.sql"));
  });

  it("migration SalesOrderNfeLink versionada", () => {
    const sql = read("prisma/migrations/20260626120000_sales_order_nfe_link/migration.sql");
    assert.match(sql, /SalesOrderNfeLink/);
    assert.match(sql, /salesOrderId_nfeExternalId_key/);
  });
});

describe("salesOrderFinalValidation — motor e NF", () => {
  it("pedido com uma NF", () => {
    const ctx = linkedCtx(1000, 1000, new Date(2026, 5, 25));
    const m = buildSalesOrderEnrichedMetricsBatch([orderBase], REF, new Map([["so-val", ctx]]))[0]!;
    assert.equal(m.nfeCount, 1);
    assert.equal(m.hasNfe, true);
  });

  it("pedido com múltiplas NF-es — 1 pedido nos KPIs", () => {
    const ctx = buildSalesOrderLinkedNfeContext({
      links: [
        {
          id: "l1",
          nfeExternalId: 1,
          nfeNumber: "1",
          nfeKey: null,
          nfeStatus: 100,
          tipoOperacao: 1,
          dataProcessamento: new Date(2026, 5, 10),
          presentInLastPayload: true,
          nomusNfeId: "n1",
          rawPayload: { valor: 400 },
        },
        {
          id: "l2",
          nfeExternalId: 2,
          nfeNumber: "2",
          nfeKey: null,
          nfeStatus: 100,
          tipoOperacao: 1,
          dataProcessamento: new Date(2026, 5, 12),
          presentInLastPayload: true,
          nomusNfeId: "n2",
          rawPayload: { valor: 600 },
        },
      ],
      totalNetValue: 1000,
      issueDate: new Date(2026, 5, 1),
      expectedDeliveryDate: new Date(2026, 5, 25),
      referenceDate: REF,
    });
    const metrics = buildSalesOrderEnrichedMetricsBatch([orderBase], REF, new Map([["so-val", ctx]]));
    const agg = aggregateSalesOrderMetrics(metrics);
    assert.equal(metrics.length, 1);
    assert.equal(agg.totalOrders, 1);
    assert.equal(agg.totalSoldValue, 1000);
    assert.equal(agg.totalInvoicedValue, 1000);
  });

  it("pedido sem NF", () => {
    const m = buildSalesOrderEnrichedMetricsBatch([orderBase], REF)[0]!;
    assert.equal(m.hasNfe, false);
    assert.equal(m.isPendingInvoice, true);
  });

  it("cancelado não é demanda MP", () => {
    const m = buildSalesOrderEnrichedMetricsBatch(
      [{ ...orderBase, id: "so-c", status: "CANCELLED" }],
      REF
    )[0]!;
    assert.equal(isSalesOrderDemandEligible(m), false);
  });

  it("5 itens e 2 NF-es — antiduplicidade pedido/valor vendido", () => {
    const multiItem = {
      ...orderBase,
      totalNetValue: 5000,
      items: Array.from({ length: 5 }, (_, i) => ({
        id: `i${i}`,
        externalProductId: i + 1,
        skuSnapshot: `SKU-${i}`,
        productNameSnapshot: `P${i}`,
        quantity: 2,
      })),
    };
    const ctx = linkedCtx(5000, 5000, new Date(2026, 5, 30));
    const metrics = buildSalesOrderEnrichedMetricsBatch([multiItem], REF, new Map([["so-val", ctx]]));
    const agg = aggregateSalesOrderMetrics(metrics);
    assert.equal(agg.totalOrders, 1);
    assert.equal(agg.totalSoldValue, 5000);
  });
});

describe("salesOrderFinalValidation — status logístico", () => {
  it("labels BI com hints de prazo/NF/SLA", () => {
    const labels = BI_LOGISTIC_STATUS_CARDS.map((c) => c.label);
    assert.ok(labels.includes("Entregue no Prazo"));
    assert.ok(labels.includes("Entregue com Atraso"));
    assert.ok(labels.includes("No Prazo (Pendente)"));
    assert.ok(labels.includes("Atrasado (Pendente)"));
    assert.ok(labels.includes("Revisar dados"));
    for (const card of BI_LOGISTIC_STATUS_CARDS) {
      assert.ok(card.hint.length > 10, `hint ausente: ${card.label}`);
    }
  });

  it("pendente atrasado sem NF", () => {
    const r = buildSalesOrderBiLogisticStatus({
      nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 1 }] },
      expectedDeliveryDate: new Date(2026, 5, 1),
      referenceDate: REF,
    });
    assert.equal(r.label, "Atrasado (Pendente)");
  });
});

describe("salesOrderFinalValidation — UX labels", () => {
  it("filtros Com NF / Sem NF / corte / parcial", () => {
    assert.ok(INVOICE_FILTER_OPTIONS.some((o) => o.label === "Com NF"));
    assert.ok(INVOICE_FILTER_OPTIONS.some((o) => o.label === "Sem NF"));
    assert.ok(CUT_FILTER_OPTIONS.some((o) => o.label === "Com corte"));
    assert.ok(CUT_FILTER_OPTIONS.some((o) => o.label === "Sem corte"));
    assert.ok(FULFILLMENT_FILTER_OPTIONS.some((o) => o.label === "Parcial"));
  });

  it("Dashboard e Gestão usam motor único", () => {
    assert.match(read("src/lib/salesFunnelDashboardMetrics.ts"), /salesOrderMetricsEngine/);
    assert.match(read("src/lib/salesOrdersDashboardMetrics.ts"), /salesOrderMetricsEngine/);
    assert.match(read("src/lib/salesOrderManagement.ts"), /buildManagementRowsFromOrders/);
    assert.match(read("src/components/dashboard/SalesFunnelPanel.tsx"), /Funil Operacional de Vendas/);
  });
});

describe("salesOrderFinalValidation — performance", () => {
  it("Gestão de Pedidos expõe paginação na rota", () => {
    assert.match(read("src/lib/salesOrderIntelligenceRoutes.ts"), /page|limit|take/);
  });

  it("índices NF-e link na migration", () => {
    const sql = read("prisma/migrations/20260626120000_sales_order_nfe_link/migration.sql");
    assert.match(sql, /SalesOrderNfeLink_salesOrderId_idx/);
    assert.match(sql, /dataProcessamento_idx/);
  });
});
