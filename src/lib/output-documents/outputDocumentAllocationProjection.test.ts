/**
 * DS-03.8 — testes da consolidação de alocações / projeção de itens.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocatedValueForSalesOrder,
  projectOutputDocumentAllocation,
} from "./outputDocumentAllocationProjection.js";

const ORDER_A = "00000000-0000-4000-8000-0000000000a1";
const ORDER_B = "00000000-0000-4000-8000-0000000000b2";
const SOI_A1 = "soi-a1";
const SOI_A2 = "soi-a2";
const SOI_B1 = "soi-b1";
const ITEM_1 = "item-1";
const ITEM_2 = "item-2";

describe("projectOutputDocumentAllocation", () => {
  it("um pedido: total do documento uma vez; alocado só o rateio", () => {
    const projection = projectOutputDocumentAllocation({
      document: {
        id: "doc-1",
        externalId: 8451,
        idNfe: 7208,
        totalValue: "100.00",
        items: [
          {
            id: ITEM_1,
            externalProductId: 100,
            quantity: "10",
            unitValue: "10.00",
            estimatedTotalValue: "100.00",
          },
        ],
      },
      allocationLines: [
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A1,
          orderCode: "PD-A",
          allocatedValueByDocumentPrice: "100.00",
          quantityUsedForOrder: "10",
        },
      ],
      focusSalesOrderId: ORDER_A,
    });

    assert.equal(projection.document.totalValue, 100);
    assert.equal(projection.document.allocatedToAllOrders, 100);
    assert.equal(projection.document.coverageStatus, "completo");
    assert.equal(projection.document.unallocatedBalance, 0);
    assert.equal(projection.document.overAllocation, 0);
    assert.equal(projection.linkedOrders.length, 1);
    assert.equal(projection.linkedOrders[0]!.allocatedValue, 100);
    // Não repete total em orderShares além do alocado.
    assert.equal(projection.orderShares[0]!.allocatedValue, 100);
    assert.equal(projection.items[0]!.linkStatus, "resolved");
  });

  it("vários pedidos: cada um só com seu alocado; soma separada do total", () => {
    const projection = projectOutputDocumentAllocation({
      document: {
        externalId: 8451,
        totalValue: "100.00",
        items: [
          {
            id: ITEM_1,
            externalProductId: 100,
            quantity: "10",
            unitValue: "10.00",
            estimatedTotalValue: "100.00",
          },
        ],
      },
      allocationLines: [
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A1,
          orderCode: "PD-A",
          allocatedValueByDocumentPrice: "60.00",
          quantityUsedForOrder: "6",
        },
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_B,
          salesOrderItemId: SOI_B1,
          orderCode: "PD-B",
          allocatedValueByDocumentPrice: "40.00",
          quantityUsedForOrder: "4",
        },
      ],
    });

    assert.equal(projection.document.totalValue, 100);
    assert.equal(projection.document.allocatedToAllOrders, 100);
    assert.equal(projection.allocationsSum, 100);
    assert.equal(projection.linkedOrders.length, 2);

    const a = allocatedValueForSalesOrder(projection, ORDER_A);
    const b = allocatedValueForSalesOrder(projection, ORDER_B);
    assert.equal(a.allocatedValue, 60);
    assert.equal(b.allocatedValue, 40);
    // Nenhum pedido recebe 100 (total integral).
    assert.ok(projection.linkedOrders.every((o) => o.allocatedValue < 100));
    assert.equal(projection.items[0]!.links.length, 2);
    assert.equal(projection.items[0]!.allocatedValue, 100);
  });

  it("item sem vínculo permanece visível como não resolvido", () => {
    const projection = projectOutputDocumentAllocation({
      document: {
        externalId: 1,
        totalValue: "50.00",
        items: [
          {
            id: ITEM_1,
            externalProductId: 100,
            quantity: "5",
            unitValue: "10.00",
            estimatedTotalValue: "50.00",
          },
          {
            id: ITEM_2,
            externalProductId: 200,
            quantity: "1",
            unitValue: "0",
            estimatedTotalValue: "0",
          },
        ],
      },
      allocationLines: [
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A1,
          allocatedValueByDocumentPrice: "50.00",
          quantityUsedForOrder: "5",
        },
      ],
    });

    assert.equal(projection.items.length, 2);
    const unresolved = projection.items.find((i) => i.stockDocumentItemId === ITEM_2);
    assert.ok(unresolved);
    assert.equal(unresolved!.linkStatus, "unresolved");
    assert.ok(unresolved!.alerts.includes("DOCUMENT_ITEM_UNRESOLVED"));
    assert.equal(unresolved!.links.length, 0);
  });

  it("item com vários candidatos de produto marca conflito auditável e preserva facts", () => {
    const projection = projectOutputDocumentAllocation({
      document: {
        externalId: 2,
        totalValue: "100.00",
        items: [
          {
            id: ITEM_1,
            externalProductId: 100,
            quantity: "10",
            unitValue: "10.00",
            estimatedTotalValue: "100.00",
          },
        ],
      },
      allocationLines: [
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A1,
          allocatedValueByDocumentPrice: "50.00",
          quantityUsedForOrder: "5",
        },
      ],
      orderItemHints: [
        {
          salesOrderItemId: SOI_A1,
          salesOrderId: ORDER_A,
          orderCode: "PD-A",
          externalProductId: 100,
        },
        {
          salesOrderItemId: SOI_A2,
          salesOrderId: ORDER_A,
          orderCode: "PD-A",
          externalProductId: 100,
        },
      ],
    });

    const item = projection.items[0]!;
    assert.equal(item.linkStatus, "conflict");
    assert.equal(item.linkOrigin, "CONFLICT");
    assert.ok(item.alerts.includes("DOCUMENT_ITEM_LINK_CONFLICT"));
    // Preserva o vínculo válido do fact.
    assert.ok(item.links.some((l) => l.salesOrderItemId === SOI_A1 && l.source === "order_to_cash_fact"));
    assert.ok(item.links.some((l) => l.salesOrderItemId === SOI_A2 && l.source === "product_match"));
    assert.equal(item.allocatedValue, 50);
  });

  it("alocação parcial: cobertura parcial e saldo não alocado", () => {
    const projection = projectOutputDocumentAllocation({
      document: {
        externalId: 3,
        totalValue: "100.00",
        items: [
          {
            id: ITEM_1,
            externalProductId: 100,
            quantity: "10",
            unitValue: "10.00",
            estimatedTotalValue: "100.00",
          },
        ],
      },
      allocationLines: [
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A1,
          allocatedValueByDocumentPrice: "40.00",
          quantityUsedForOrder: "4",
        },
      ],
    });

    assert.equal(projection.document.coverageStatus, "parcial");
    assert.equal(projection.document.unallocatedBalance, 60);
    assert.equal(projection.document.overAllocation, 0);
    assert.equal(projection.document.coveragePercent, 40);
    assert.equal(projection.items[0]!.linkStatus, "partial");
  });

  it("superalocação: alocado > total do documento", () => {
    const projection = projectOutputDocumentAllocation({
      document: {
        externalId: 4,
        totalValue: "100.00",
        items: [
          {
            id: ITEM_1,
            externalProductId: 100,
            quantity: "10",
            unitValue: "10.00",
            estimatedTotalValue: "100.00",
          },
        ],
      },
      allocationLines: [
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A1,
          allocatedValueByDocumentPrice: "70.00",
          quantityUsedForOrder: "7",
        },
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_B,
          salesOrderItemId: SOI_B1,
          allocatedValueByDocumentPrice: "50.00",
          quantityUsedForOrder: "5",
        },
      ],
    });

    assert.equal(projection.document.allocatedToAllOrders, 120);
    assert.equal(projection.document.coverageStatus, "superalocado");
    assert.equal(projection.document.overAllocation, 20);
    assert.equal(projection.document.unallocatedBalance, 0);
    assert.ok(projection.document.totalValue === 100);
  });

  it("não usa apenas o primeiro vínculo: agrega todos os facts do item", () => {
    const projection = projectOutputDocumentAllocation({
      document: {
        externalId: 5,
        totalValue: "90.00",
        items: [
          {
            id: ITEM_1,
            externalProductId: 100,
            quantity: "9",
            unitValue: "10.00",
            estimatedTotalValue: "90.00",
          },
        ],
      },
      allocationLines: [
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A1,
          allocatedValueByDocumentPrice: "30.00",
          quantityUsedForOrder: "3",
        },
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A2,
          allocatedValueByDocumentPrice: "60.00",
          quantityUsedForOrder: "6",
        },
      ],
      orderItemHints: [
        {
          salesOrderItemId: SOI_A1,
          salesOrderId: ORDER_A,
          externalProductId: 100,
        },
        {
          salesOrderItemId: SOI_A2,
          salesOrderId: ORDER_A,
          externalProductId: 100,
        },
      ],
    });

    assert.equal(projection.items[0]!.links.filter((l) => l.source === "order_to_cash_fact").length, 2);
    assert.equal(projection.items[0]!.allocatedValue, 90);
    assert.equal(projection.items[0]!.quantityUsedForOrder, 9);
    assert.deepEqual(
      projection.linkedOrders[0]!.salesOrderItemIds,
      [SOI_A1, SOI_A2].sort()
    );
  });

  it("tolerância de 1 centavo classifica como arredondamento", () => {
    const projection = projectOutputDocumentAllocation({
      document: {
        externalId: 6,
        totalValue: "100.00",
        items: [
          {
            id: ITEM_1,
            quantity: "1",
            unitValue: "100.00",
            estimatedTotalValue: "100.00",
          },
        ],
      },
      allocationLines: [
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A1,
          allocatedValueByDocumentPrice: "99.99",
          quantityUsedForOrder: "1",
        },
      ],
    });

    assert.equal(projection.document.coverageStatus, "arredondamento");
  });

  it("total vem do stage header — nunca da soma repetida de facts", () => {
    // Simula bug antigo: 3 facts com item total 100 cada (=300 se somasse).
    const projection = projectOutputDocumentAllocation({
      document: {
        externalId: 7,
        totalValue: "100.00",
        items: [
          {
            id: ITEM_1,
            quantity: "10",
            unitValue: "10.00",
            estimatedTotalValue: "100.00",
          },
        ],
      },
      allocationLines: [
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A1,
          allocatedValueByDocumentPrice: "40.00",
          quantityUsedForOrder: "4",
        },
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A2,
          allocatedValueByDocumentPrice: "30.00",
          quantityUsedForOrder: "3",
        },
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_B,
          salesOrderItemId: SOI_B1,
          allocatedValueByDocumentPrice: "30.00",
          quantityUsedForOrder: "3",
        },
      ],
    });

    assert.equal(projection.document.totalValueSource, "stage_header");
    assert.equal(projection.document.totalValue, 100);
    assert.equal(projection.document.allocatedToAllOrders, 100);
    assert.notEqual(projection.document.totalValue, 300);
  });
});
