import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";
import {
  buildManagementRowsFromOrders,
} from "./salesOrderManagement.js";
import { buildFulfillmentKpis } from "./salesOrderManagementFulfillment.js";
import { summarizeSalesOrderListRows } from "./salesOrdersListSummary.js";
import {
  auditSalesOrderRules,
  buildSalesOrderRulesResult,
  classifySalesOrderInvoiceStatus,
  classifySalesOrderLogisticStatus,
  explainSalesOrderMetric,
  filterSalesOrderListRows,
  getSalesOrderDate,
  getSalesOrderValue,
  listSalesOrderMetricDefinitions,
  normalizeSalesOrderRecord,
} from "./salesOrderRulesEngine.js";
import type { SalesOrderRulesOrderInput } from "./salesOrderRulesEngine.types.js";
import { toCivilDateKey } from "./financeCivilDate.js";

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

const baseOrder: SalesOrderRulesOrderInput = {
  id: "so-1",
  orderCode: "PD-100",
  status: "SENT_TO_NOMUS",
  issueDate: new Date(2026, 5, 1),
  expectedDeliveryDate: new Date(2026, 5, 25),
  totalNetValue: 1000,
  totalGrossValue: 1200,
  totalItems: 10,
  responsible: "Vendedor A",
  nomusRawResponse: {
    itensPedido: [{ status: 2, quantidade: 10 }],
    ordensProducao: [{ id: 1 }],
  },
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

describe("salesOrderRulesEngine", () => {
  it("1–2. total de pedidos e pedidos únicos", () => {
    const orders = [baseOrder, { ...baseOrder, id: "so-2", orderCode: "PD-101", totalNetValue: 500 }];
    const result = buildSalesOrderRulesResult(orders, {
      referenceDate: REF,
      listFilters: { year: 2026 },
      managementFilters: { year: 2026 },
    });
    assert.equal(result.metrics.totalOrders, 2);
    assert.equal(result.metrics.uniqueOrders, 2);
    assert.equal(result.metrics.filteredOrders, 2);
  });

  it("3–4. valor vendido e valor líquido (header totalNetValue)", () => {
    const orders = [baseOrder, { ...baseOrder, id: "so-2", totalNetValue: 500 }];
    const result = buildSalesOrderRulesResult(orders, {
      referenceDate: REF,
      listFilters: { year: 2026 },
      managementFilters: { year: 2026 },
    });
    assert.equal(result.metrics.soldAmount, 1500);
    assert.equal(result.metrics.netAmount, 1500);
    assert.equal(result.metrics.soldAmount, result.listSummary.totalNetAmount);
  });

  it("5–6. valor faturado vinculado e gap vendido × faturado", () => {
    const ctx = linkedContext({
      links: [
        { id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 15), value: 600 },
      ],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const map = new Map([["so-1", ctx]]);
    const result = buildSalesOrderRulesResult([baseOrder], {
      referenceDate: REF,
      managementFilters: { year: 2026 },
      linkedNfeContextMap: map,
    });
    assert.equal(result.metrics.invoicedAmount, 600);
    assert.equal(result.metrics.soldInvoicedGap, 400);
    assert.equal(result.fulfillmentKpis.soldInvoicedGap, 400);
  });

  it("7–8. com NF / sem NF", () => {
    const withNfe = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 15), value: 1000 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const without = linkedContext({ links: [], totalNetValue: 500, expectedDeliveryDate: new Date(2026, 6, 1) });
    const map = new Map([
      ["so-1", withNfe],
      ["so-2", without],
    ]);
    const orders = [baseOrder, { ...baseOrder, id: "so-2", orderCode: "PD-101", totalNetValue: 500 }];
    const result = buildSalesOrderRulesResult(orders, {
      referenceDate: REF,
      managementFilters: { year: 2026 },
      linkedNfeContextMap: map,
    });
    assert.equal(result.metrics.withNfeCount, 1);
    assert.equal(result.metrics.withoutNfeCount, 1);
  });

  it("9–10. com OP / sem OP", () => {
    const withOp = {
      ...baseOrder,
      nomusRawResponse: { itensPedido: [{ status: 2 }], ordensProducao: [{ id: 99 }] },
    };
    const withoutOp = {
      ...baseOrder,
      id: "so-2",
      nomusRawResponse: { itensPedido: [{ status: 2 }] },
    };
    const result = buildSalesOrderRulesResult([withOp, withoutOp], {
      referenceDate: REF,
      managementFilters: { year: 2026 },
    });
    assert.equal(result.metrics.withProductionOrderCount, 1);
    assert.equal(result.metrics.withoutProductionOrderCount, 1);
  });

  it("11. entregue no prazo", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 20), value: 1000 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const status = classifySalesOrderLogisticStatus(baseOrder, ctx, { referenceDate: REF });
    assert.equal(status.cardId, "deliveredOnTime");
    const result = buildSalesOrderRulesResult([baseOrder], {
      referenceDate: REF,
      managementFilters: { year: 2026 },
      linkedNfeContextMap: new Map([["so-1", ctx]]),
    });
    assert.equal(result.metrics.deliveredOnTimeCount, 1);
  });

  it("12. entregue com atraso", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 28), value: 1000 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const status = classifySalesOrderLogisticStatus(baseOrder, ctx, { referenceDate: REF });
    assert.equal(status.cardId, "deliveredLate");
    const result = buildSalesOrderRulesResult([baseOrder], {
      referenceDate: REF,
      managementFilters: { year: 2026 },
      linkedNfeContextMap: new Map([["so-1", ctx]]),
    });
    assert.equal(result.metrics.deliveredLateCount, 1);
  });

  it("13. atrasado pendente", () => {
    const order = {
      ...baseOrder,
      expectedDeliveryDate: new Date(2026, 5, 10),
      nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 10 }] },
    };
    const status = classifySalesOrderLogisticStatus(order, null, { referenceDate: REF });
    assert.equal(status.cardId, "overduePending");
    const result = buildSalesOrderRulesResult([order], {
      referenceDate: REF,
      managementFilters: { year: 2026 },
    });
    assert.equal(result.metrics.pendingLateCount, 1);
  });

  it("14. no prazo pendente", () => {
    const order = {
      ...baseOrder,
      expectedDeliveryDate: new Date(2026, 6, 15),
      nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 10 }] },
    };
    const status = classifySalesOrderLogisticStatus(order, null, { referenceDate: REF });
    assert.equal(status.cardId, "onTimePending");
    const result = buildSalesOrderRulesResult([order], {
      referenceDate: REF,
      managementFilters: { year: 2026 },
    });
    assert.equal(result.metrics.pendingOnTimeCount, 1);
  });

  it("15. parcial", () => {
    const order = {
      ...baseOrder,
      nomusRawResponse: {
        itensPedido: [
          {
            idProduto: 1,
            status: "Atendido parcialmente",
            quantidade: 10,
            quantidadeAtendida: 4,
          },
        ],
      },
    };
    const result = buildSalesOrderRulesResult([order], {
      referenceDate: REF,
      managementFilters: { year: 2026 },
    });
    assert.ok(result.metrics.partialCount >= 1);
    assert.equal(result.gridRows[0]?.completionStatus, "partial");
  });

  it("16. com corte", () => {
    const order = {
      ...baseOrder,
      nomusRawResponse: {
        itensPedido: [
          {
            idProduto: 1,
            status: "Atendido com corte",
            quantidade: 10,
            quantidadeAtendida: 8,
          },
        ],
      },
    };
    const result = buildSalesOrderRulesResult([order], {
      referenceDate: REF,
      managementFilters: { year: 2026 },
    });
    assert.ok(result.metrics.withCutCount >= 1);
    assert.equal(result.gridRows[0]?.hasCut, true);
  });

  it("17. revisar dados", () => {
    const order = {
      ...baseOrder,
      expectedDeliveryDate: null,
      nomusRawResponse: { itensPedido: [] },
    };
    const status = classifySalesOrderLogisticStatus(order, null, { referenceDate: REF });
    assert.equal(status.cardId, "reviewData");
  });

  it("18. ticket médio", () => {
    const orders = [baseOrder, { ...baseOrder, id: "so-2", totalNetValue: 500 }];
    const result = buildSalesOrderRulesResult(orders, {
      referenceDate: REF,
      listFilters: { year: 2026 },
      managementFilters: { year: 2026 },
    });
    assert.equal(result.metrics.averageTicket, 750);
    assert.equal(result.listSummary.averageTicket, 750);
  });

  it("19–20. pedidos mês e YTD (exclui cancelados)", () => {
    const orders = [
      baseOrder,
      { ...baseOrder, id: "so-2", issueDate: new Date(2026, 0, 15), totalNetValue: 200 },
      { ...baseOrder, id: "so-3", status: "CANCELLED", totalNetValue: 9999 },
    ];
    const result = buildSalesOrderRulesResult(orders, {
      referenceDate: REF,
      year: 2026,
      month: 6,
      managementFilters: { year: 2026 },
    });
    assert.equal(result.metrics.ordersMonth, 1);
    assert.equal(result.metrics.ordersYtd, 2);
    assert.equal(result.metrics.soldAmountYtd, 1200);
  });

  it("21. cancelados tratados conforme regra oficial", () => {
    const cancelled = { ...baseOrder, id: "so-c", status: "CANCELLED" };
    const normalized = normalizeSalesOrderRecord(cancelled, null, null, REF);
    assert.equal(normalized.isCancelled, true);
    const result = buildSalesOrderRulesResult([cancelled, baseOrder], {
      referenceDate: REF,
      listFilters: { year: 2026 },
      managementFilters: { year: 2026 },
    });
    assert.equal(result.metrics.ordersYtd, 1);
    assert.equal(result.listSummary.totalOrders, 2);
  });

  it("22. itens cancelados — status item 6 não entra como pendente logístico", () => {
    const order = {
      ...baseOrder,
      nomusRawResponse: { itensPedido: [{ status: 6, quantidade: 10 }] },
    };
    const status = classifySalesOrderLogisticStatus(order, null, { referenceDate: REF });
    assert.equal(status.cardId, "finishedOrCancelled");
  });

  it("23. data civil não desloca emissão", () => {
    const utc = new Date("2026-07-20T00:00:00.000Z");
    const order = { ...baseOrder, issueDate: utc };
    assert.equal(toCivilDateKey(utc), "2026-07-20");
    const date = getSalesOrderDate(order, "issueDate");
    assert.equal(date?.getFullYear(), 2026);
    assert.equal(date?.getMonth(), 6);
    assert.equal(date?.getDate(), 20);
  });

  it("24. valores null/undefined não geram NaN", () => {
    const order = {
      ...baseOrder,
      totalNetValue: undefined,
      totalGrossValue: null,
      totalItems: Number.NaN as unknown as number,
    };
    const result = buildSalesOrderRulesResult([order], {
      referenceDate: REF,
      managementFilters: { year: 2026 },
    });
    assert.ok(result.audit.isFinite);
    const val = getSalesOrderValue(order, null, "soldAmount", result.context);
    assert.ok(Number.isFinite(val));
  });

  it("25. métricas explicáveis retornam definição", () => {
    const defs = listSalesOrderMetricDefinitions();
    assert.ok(defs.length >= 8);
    const sold = explainSalesOrderMetric("soldAmount");
    assert.ok(sold);
    assert.match(sold!.description, /totalNetValue/);
  });

  it("26. compatibilidade com lista e gestão oficiais", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 15), value: 1000 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const map = new Map([["so-1", ctx]]);
    const orders = [baseOrder];
    const listFiltered = filterSalesOrderListRows(orders, { year: 2026 });
    const officialList = summarizeSalesOrderListRows(
      listFiltered.map((o) => ({ totalNetValue: o.totalNetValue, totalItems: o.totalItems }))
    );
    const { rows, fulfillmentKpis } = buildManagementRowsFromOrders(
      orders.map((o) => ({
        id: o.id,
        orderCode: o.orderCode,
        status: o.status,
        issueDate: o.issueDate,
        expectedDeliveryDate: o.expectedDeliveryDate ?? null,
        totalNetValue: o.totalNetValue,
        responsible: o.responsible ?? null,
        nomusRawResponse: o.nomusRawResponse ?? null,
        companyIssuer: o.companyIssuer,
        Customer: o.Customer,
        items: o.items,
      })),
      { year: 2026 },
      REF,
      map
    );
    const officialKpis = buildFulfillmentKpis(rows);

    const engine = buildSalesOrderRulesResult(orders, {
      referenceDate: REF,
      listFilters: { year: 2026 },
      managementFilters: { year: 2026 },
      linkedNfeContextMap: map,
    });

    assert.equal(engine.listSummary.totalNetAmount, officialList.totalNetAmount);
    assert.equal(engine.fulfillmentKpis.totalSoldValue, officialKpis.totalSoldValue);
    assert.equal(engine.fulfillmentKpis.totalInvoicedValue, officialKpis.totalInvoicedValue);
    assert.equal(engine.fulfillmentKpis.deliveredOnTime, officialKpis.deliveredOnTime);

    const audit = auditSalesOrderRules(engine);
    assert.equal(audit.listParityOk, true);
    assert.equal(audit.managementParityOk, true);
  });

  it("classifySalesOrderInvoiceStatus distingue parcial", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 15), value: 400 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    assert.equal(classifySalesOrderInvoiceStatus(baseOrder, ctx), "partial");
  });
});
