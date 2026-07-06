import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildManagementRowsFromOrders,
  parseSalesOrderManagementFilters,
} from "./salesOrderManagement.js";
import { mapLifecycleToManagementRow } from "./salesOrderIntelligence.js";
import { buildSalesOrderLifecycleSummary } from "./salesOrderLifecycleStatus.js";
import { buildSalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import {
  buildFulfillmentAudit,
  buildFulfillmentKpis,
  countRawNfesInPayload,
  matchesFulfillmentExtendedFilters,
} from "./salesOrderManagementFulfillment.js";
import type { SalesOrderManagementRow } from "./salesOrderManagementTypes.js";

const REF = new Date(2026, 5, 20);

function linkedContext(input: {
  links: Array<{
    id: string;
    nfeExternalId: number;
    nfeNumber?: string;
    dataProcessamento: Date;
    value: number;
  }>;
  totalNetValue: number;
  expectedDeliveryDate: Date;
}) {
  return buildSalesOrderLinkedNfeContext({
    links: input.links.map((link) => ({
      id: link.id,
      nfeExternalId: link.nfeExternalId,
      nfeNumber: link.nfeNumber ?? String(link.nfeExternalId),
      nfeKey: null,
      nfeStatus: 100,
      tipoOperacao: 1,
      dataProcessamento: link.dataProcessamento,
      presentInLastPayload: true,
      nomusNfeId: `nomus-${link.nfeExternalId}`,
      rawPayload: { valor: link.value },
    })),
    nomusNfesByExternalId: new Map(
      input.links.map((link) => [
        link.nfeExternalId,
        {
          id: `nomus-${link.nfeExternalId}`,
          externalId: link.nfeExternalId,
          numero: link.nfeNumber ?? String(link.nfeExternalId),
          chave: null,
          status: 100,
          tipoOperacao: 1,
          dataProcessamento: link.dataProcessamento,
          xmlDhEmi: null,
          valorLiquido: link.value,
          xmlVNF: link.value,
        },
      ])
    ),
    totalNetValue: input.totalNetValue,
    issueDate: new Date(2026, 5, 1),
    expectedDeliveryDate: input.expectedDeliveryDate,
    referenceDate: REF,
  });
}

function buildRows(
  orders: Parameters<typeof buildManagementRowsFromOrders>[0],
  filters: ReturnType<typeof parseSalesOrderManagementFilters>,
  linkedMap?: Map<string, ReturnType<typeof linkedContext>>
) {
  return buildManagementRowsFromOrders(orders, filters, REF, linkedMap);
}

const baseOrder = {
  id: "so-1",
  orderCode: "PD-100",
  status: "SENT_TO_NOMUS",
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

describe("salesOrderManagementFulfillment", () => {
  it("endpoint retorna campos enriquecidos de NF", () => {
    const ctx = linkedContext({
      links: [
        { id: "l1", nfeExternalId: 1, nfeNumber: "1001", dataProcessamento: new Date(2026, 5, 20), value: 1000 },
      ],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const map = new Map([["so-1", ctx]]);
    const { rows } = buildRows([baseOrder], parseSalesOrderManagementFilters({ year: "2026" }), map);
    const row = rows[0];
    assert.equal(row.hasInvoice, true);
    assert.equal(row.invoicedValue, 1000);
    assert.deepEqual(row.invoiceNumbers, ["1001"]);
    assert.ok(row.lastInvoiceDate);
    assert.equal(row.invoiceCoveragePercent, 100);
    assert.equal(row.slaDays, 19);
  });

  it("filtro Com NF funciona", () => {
    const withNfe = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 20), value: 500 }],
      totalNetValue: 500,
      expectedDeliveryDate: new Date(2026, 6, 1),
    });
    const without = linkedContext({ links: [], totalNetValue: 500, expectedDeliveryDate: new Date(2026, 6, 1) });
    const map = new Map([
      ["so-1", withNfe],
      ["so-2", without],
    ]);
    const orders = [
      baseOrder,
      { ...baseOrder, id: "so-2", orderCode: "PD-101" },
    ];
    const filters = parseSalesOrderManagementFilters({ year: "2026", hasInvoice: "true" });
    const { rows } = buildRows(orders, filters, map);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "so-1");
  });

  it("filtro Sem NF funciona", () => {
    const withNfe = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 20), value: 500 }],
      totalNetValue: 500,
      expectedDeliveryDate: new Date(2026, 6, 1),
    });
    const without = linkedContext({ links: [], totalNetValue: 500, expectedDeliveryDate: new Date(2026, 6, 1) });
    const map = new Map([
      ["so-1", withNfe],
      ["so-2", without],
    ]);
    const orders = [
      baseOrder,
      { ...baseOrder, id: "so-2", orderCode: "PD-101" },
    ];
    const filters = parseSalesOrderManagementFilters({ year: "2026", hasInvoice: "false" });
    const { rows } = buildRows(orders, filters, map);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "so-2");
  });

  it("filtro Entregue/Faturado no prazo funciona", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 24), value: 1000 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const map = new Map([["so-1", ctx]]);
    const filters = parseSalesOrderManagementFilters({ year: "2026", prazoFilter: "on_time" });
    const { rows } = buildRows([baseOrder], filters, map);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].logisticStatusCardId, "deliveredOnTime");
  });

  it("filtro Entregue/Faturado com atraso funciona", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 28), value: 1000 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const map = new Map([["so-1", ctx]]);
    const filters = parseSalesOrderManagementFilters({ year: "2026", prazoFilter: "late" });
    const { rows } = buildRows([baseOrder], filters, map);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].logisticStatusCardId, "deliveredLate");
  });

  it("filtro Pendente atrasado funciona", () => {
    const ctx = linkedContext({
      links: [],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 10),
    });
    const map = new Map([["so-1", ctx]]);
    const order = { ...baseOrder, expectedDeliveryDate: new Date(2026, 5, 10) };
    const filters = parseSalesOrderManagementFilters({ year: "2026", prazoFilter: "late" });
    const { rows } = buildRows([order], filters, map);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].logisticStatusCardId, "overduePending");
  });

  it("filtro Parcial funciona", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 20), value: 400 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 6, 1),
    });
    const map = new Map([["so-1", ctx]]);
    const filters = parseSalesOrderManagementFilters({ year: "2026", fulfillmentFilter: "partial" });
    const { rows } = buildRows([baseOrder], filters, map);
    assert.equal(rows.length, 1);
    assert.ok(rowHasPartial(rows[0]));
  });

  it("KPI total de pedidos não duplica com múltiplas NF-es", () => {
    const ctx = linkedContext({
      links: [
        { id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 18), value: 600 },
        { id: "l2", nfeExternalId: 2, dataProcessamento: new Date(2026, 5, 20), value: 400 },
      ],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const map = new Map([["so-1", ctx]]);
    const { rows, fulfillmentKpis } = buildRows([baseOrder], parseSalesOrderManagementFilters({ year: "2026" }), map);
    assert.equal(rows.length, 1);
    assert.equal(fulfillmentKpis.totalOrders, 1);
  });

  it("valor vendido não duplica com múltiplas NF-es", () => {
    const ctx = linkedContext({
      links: [
        { id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 18), value: 600 },
        { id: "l2", nfeExternalId: 2, dataProcessamento: new Date(2026, 5, 20), value: 400 },
      ],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const map = new Map([["so-1", ctx]]);
    const { fulfillmentKpis } = buildRows([baseOrder], parseSalesOrderManagementFilters({ year: "2026" }), map);
    assert.equal(fulfillmentKpis.totalSoldValue, 1000);
  });

  it("valor faturado soma NF vinculada corretamente", () => {
    const ctx = linkedContext({
      links: [
        { id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 18), value: 600 },
        { id: "l2", nfeExternalId: 2, dataProcessamento: new Date(2026, 5, 20), value: 400 },
      ],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const map = new Map([["so-1", ctx]]);
    const { fulfillmentKpis } = buildRows([baseOrder], parseSalesOrderManagementFilters({ year: "2026" }), map);
    assert.equal(fulfillmentKpis.totalInvoicedValue, 1000);
  });

  it("SLA médio é calculado corretamente", () => {
    const ctx1 = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 11), value: 500 }],
      totalNetValue: 500,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const ctx2 = linkedContext({
      links: [{ id: "l2", nfeExternalId: 2, dataProcessamento: new Date(2026, 5, 21), value: 500 }],
      totalNetValue: 500,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const map = new Map([
      ["so-1", ctx1],
      ["so-2", ctx2],
    ]);
    const orders = [baseOrder, { ...baseOrder, id: "so-2", orderCode: "PD-102" }];
    const { fulfillmentKpis } = buildRows(orders, parseSalesOrderManagementFilters({ year: "2026" }), map);
    assert.equal(fulfillmentKpis.averageSlaDays, 15);
  });

  it("detalhe mostra NF-es vinculadas via mapLifecycle", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 99, nfeNumber: "999", dataProcessamento: new Date(2026, 5, 20), value: 1000 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const { lifecycle } = buildSalesOrderLifecycleSummary({
      salesOrderId: baseOrder.id,
      salesOrderNumber: baseOrder.orderCode,
      originalStatus: baseOrder.status,
      issueDate: baseOrder.issueDate,
      expectedDeliveryDate: baseOrder.expectedDeliveryDate,
      totalNetValue: baseOrder.totalNetValue,
      nomusRawResponse: baseOrder.nomusRawResponse,
      linkedNfeContext: ctx,
      items: baseOrder.items,
      referenceDate: REF,
    });
    const row = mapLifecycleToManagementRow(
      {
        id: baseOrder.id,
        orderCode: baseOrder.orderCode,
        issueDate: baseOrder.issueDate.toISOString(),
        expectedDeliveryDate: baseOrder.expectedDeliveryDate.toISOString(),
        totalNetValue: baseOrder.totalNetValue,
        responsible: baseOrder.responsible,
        itemsCount: 1,
        Customer: baseOrder.Customer,
      },
      lifecycle,
      { linkedNfeContext: ctx, referenceDate: REF }
    );
    assert.deepEqual(row.invoiceNumbers, ["999"]);
    assert.equal(row.invoicedValue, 1000);
  });

  it("detalhe mostra explicação do status via lifecycle SLA", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 24), value: 1000 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const { lifecycle } = buildSalesOrderLifecycleSummary({
      salesOrderId: baseOrder.id,
      salesOrderNumber: baseOrder.orderCode,
      originalStatus: baseOrder.status,
      issueDate: baseOrder.issueDate,
      expectedDeliveryDate: baseOrder.expectedDeliveryDate,
      totalNetValue: baseOrder.totalNetValue,
      linkedNfeContext: ctx,
      items: baseOrder.items,
      referenceDate: REF,
    });
    assert.equal(lifecycle.slaStatus, "on_time");
    assert.ok(lifecycle.slaDays != null);
  });

  it("auditoria identifica rawPayload.nfes sem link", () => {
    const row: SalesOrderManagementRow = {
      id: "so-x",
      number: "PD-X",
      orderCode: "PD-X",
      customerName: "Cliente",
      issueDate: "2026-06-01",
      expectedDeliveryDate: "2026-06-25",
      totalNetValue: 100,
      responsible: null,
      executiveStatusLabel: "Pendente",
      logisticStatusCardId: "onTimePending",
      logisticStatusLabel: "No Prazo (Pendente)",
      operationalStatus: "released",
      billingStatus: "not_invoiced",
      deadlineStatus: "on_time",
      completionStatus: "partial",
      daysOverdue: null,
      hasInvoice: false,
      invoiceNumbers: [],
      invoicedPercent: null,
      invoicedValue: 0,
      invoiceCoveragePercent: null,
      nfeCount: 0,
      slaStatus: "pending",
      slaDays: null,
      needsDataReview: false,
      reviewReasons: [],
      hasCut: false,
      hasLinkedProductionOrder: false,
      productionOrderLate: false,
      fulfilledPercent: 50,
      itemsCount: 1,
      riskCount: 0,
      highRiskCount: 0,
      riskFlags: [],
    };
    const audit = buildFulfillmentAudit({
      rows: [row],
      linkCountsByOrderId: new Map([["so-x", 0]]),
      rawNfeCountsByOrderId: new Map([["so-x", 2]]),
      unmatchedLinkCountsByOrderId: new Map(),
    });
    assert.equal(audit.ordersWithRawNfesWithoutLink, 1);
    assert.equal(countRawNfesInPayload({ nfes: [{ id: 1 }, { id: 2 }] }), 2);
  });

  it("matchesFulfillmentExtendedFilters por número NF", () => {
    const row = {
      invoiceNumbers: ["12345", "67890"],
    } as SalesOrderManagementRow;
    assert.equal(matchesFulfillmentExtendedFilters(row, { invoiceNumber: "123" }), true);
    assert.equal(matchesFulfillmentExtendedFilters(row, { invoiceNumber: "000" }), false);
  });
});

function rowHasPartial(row: SalesOrderManagementRow): boolean {
  return (
    row.completionStatus === "partial" ||
    row.completionStatus === "with_cut" ||
    (row.invoiceCoveragePercent != null && row.invoiceCoveragePercent > 0 && row.invoiceCoveragePercent < 99.99)
  );
}
