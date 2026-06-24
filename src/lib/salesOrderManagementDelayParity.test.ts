import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildManagementRowsFromOrders } from "./salesOrderManagement.js";
import { buildSalesOrderLinkedNfeContext } from "./salesOrderLinkedNfe.js";

/** Hoje após os prazos planejados — expõe o bug antigo (Hoje - DataPlanejada). */
const REF = new Date(2026, 5, 24); // 24/06/2026

function makeOrder(input: {
  id: string;
  orderCode: string;
  issueDate: Date;
  expectedDeliveryDate: Date;
  totalNetValue: number;
}) {
  return {
    id: input.id,
    orderCode: input.orderCode,
    status: "SENT_TO_NOMUS",
    issueDate: input.issueDate,
    expectedDeliveryDate: input.expectedDeliveryDate,
    totalNetValue: input.totalNetValue,
    responsible: "Vendedor",
    // item status 4 = atendido totalmente (não pendente); NF é a fonte de verdade.
    nomusRawResponse: { itensPedido: [{ status: 4, quantidade: 1 }] },
    companyIssuer: "Empresa",
    Customer: { companyName: "Cliente", tradeName: null, taxId: null },
    items: [
      {
        id: `${input.id}-item`,
        externalProductId: 1,
        skuSnapshot: "SKU-1",
        productNameSnapshot: "Produto",
        quantity: 1,
      },
    ],
  };
}

function linkedNfe(input: {
  totalNetValue: number;
  expectedDeliveryDate: Date;
  issueDate: Date;
  dataProcessamento: Date | null;
  value: number;
}) {
  return buildSalesOrderLinkedNfeContext({
    links: [
      {
        id: "link-1",
        nfeExternalId: 1,
        nfeNumber: "1001",
        nfeKey: null,
        nfeStatus: 100,
        tipoOperacao: 1,
        dataProcessamento: input.dataProcessamento,
        presentInLastPayload: true,
        nomusNfeId: "nomus-1",
        rawPayload: { valor: input.value },
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
          dataProcessamento: input.dataProcessamento,
          xmlDhEmi: null,
          valorLiquido: input.value,
          xmlVNF: input.value,
        },
      ],
    ]),
    totalNetValue: input.totalNetValue,
    issueDate: input.issueDate,
    expectedDeliveryDate: input.expectedDeliveryDate,
    referenceDate: REF,
  });
}

function buildRow(
  order: ReturnType<typeof makeOrder>,
  ctx: ReturnType<typeof buildSalesOrderLinkedNfeContext>
) {
  const { rows } = buildManagementRowsFromOrders([order], {}, REF, new Map([[order.id, ctx]]));
  return rows[0];
}

describe("Gestão de Pedidos — paridade de atraso (DataReal vs Hoje)", () => {
  it("PD 02682: NF na data planejada (passada) NÃO é atraso", () => {
    const order = makeOrder({
      id: "pd-02682",
      orderCode: "02682",
      issueDate: new Date(2026, 5, 22),
      expectedDeliveryDate: new Date(2026, 5, 23),
      totalNetValue: 1000,
    });
    const ctx = linkedNfe({
      totalNetValue: 1000,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      dataProcessamento: new Date(2026, 5, 23),
      value: 1000,
    });
    const row = buildRow(order, ctx);
    assert.equal(row.daysOverdue, null, "atraso 0");
    assert.equal(row.nfeProcessingDisplay, "23/06/2026");
    assert.equal(row.logisticStatusLabel, "Entregue no Prazo");
    assert.equal(row.deadlineStatus, "invoiced_on_time");
  });

  it("PD 02612: NF um dia após o prazo → atraso 1, Entregue com Atraso", () => {
    const order = makeOrder({
      id: "pd-02612",
      orderCode: "02612",
      issueDate: new Date(2026, 5, 8),
      expectedDeliveryDate: new Date(2026, 5, 10),
      totalNetValue: 1000,
    });
    const ctx = linkedNfe({
      totalNetValue: 1000,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      dataProcessamento: new Date(2026, 5, 11),
      value: 1000,
    });
    const row = buildRow(order, ctx);
    assert.equal(row.daysOverdue, 1);
    assert.equal(row.nfeProcessingDisplay, "11/06/2026");
    assert.equal(row.logisticStatusLabel, "Entregue com Atraso");
    assert.equal(row.deadlineStatus, "invoiced_late");
  });

  it("PD 02614: NF no prazo com valor faturado 0 → atraso 0 e revisão de dados", () => {
    const order = makeOrder({
      id: "pd-02614",
      orderCode: "02614",
      issueDate: new Date(2026, 5, 8),
      expectedDeliveryDate: new Date(2026, 5, 9),
      totalNetValue: 1000,
    });
    const ctx = linkedNfe({
      totalNetValue: 1000,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      dataProcessamento: new Date(2026, 5, 9),
      value: 0,
    });
    const row = buildRow(order, ctx);
    assert.equal(row.daysOverdue, null, "atraso 0 quanto ao prazo");
    assert.equal(row.nfeProcessingDisplay, "09/06/2026");
    assert.notEqual(row.deadlineStatus, "invoiced_late");
    assert.equal(row.needsDataReview, true);
    assert.ok(
      row.reviewReasons.some((r) => r.includes("sem valor fiscal")),
      "deve alertar NF vinculada sem valor fiscal"
    );
  });

  it("NF sem processamento → Data NF = 'Não Processada' e DataReal nula", () => {
    const order = makeOrder({
      id: "pd-no-proc",
      orderCode: "02700",
      issueDate: new Date(2026, 5, 8),
      expectedDeliveryDate: new Date(2026, 5, 30),
      totalNetValue: 1000,
    });
    const ctx = linkedNfe({
      totalNetValue: 1000,
      issueDate: order.issueDate,
      expectedDeliveryDate: order.expectedDeliveryDate,
      dataProcessamento: null,
      value: 1000,
    });
    const row = buildRow(order, ctx);
    assert.equal(row.nfeProcessingDisplay, "Não Processada");
    assert.equal(row.hasInvoice, false, "NF sem processamento não é DataReal");
    assert.equal(row.daysOverdue, null, "prazo futuro → sem atraso");
  });
});
