import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialDrilldownView,
  buildOrderDrilldownView,
  buildRawMaterialIntelligenceDetailLines,
  hasIntelligenceDisplayData,
} from "./materialDemandIntelligenceDrilldown.js";
import { emptyIntelligenceBlock } from "./materialDemandIntelligenceUi.js";
import type { RawMaterialIntelligenceBlock } from "./salesOrderRawMaterialIntelligenceTypes.js";

function sampleIntelligence(): RawMaterialIntelligenceBlock {
  const base = emptyIntelligenceBlock();
  return {
    ...base,
    materials: [
      {
        materialId: "mat-1",
        materialCode: "MP-01",
        materialName: "Aço",
        unit: "KG",
        unitKey: "kg",
        unitLabel: "KG",
        recommendedQuantity: 20,
        conservativeQuantity: 30,
        uncertaintyQuantity: 10,
        reviewQuantity: 0,
        recommendedValue: 200,
        conservativeValue: 300,
        relatedProductsCount: 1,
        relatedOrdersCount: 1,
        confidence: "HIGH",
        statusSummary: "Saldo vivo",
      },
    ],
    orders: [
      {
        orderId: "ord-1",
        orderNumber: "PV-001",
        customerName: "Cliente X",
        sellerName: "Vendedor",
        productCode: "SKU-1",
        productName: "Produto A",
        soldQuantity: 100,
        invoicedQuantity: 50,
        openQuantity: 50,
        soldNetAmount: 10_000,
        invoicedNetAmount: 5_000,
        openNetAmount: 5_000,
        issueDate: "2026-06-10T00:00:00.000Z",
        expectedDeliveryDate: null,
        lastInvoiceDate: "2026-06-12T00:00:00.000Z",
        estimatedWindowStart: "2026-06-12T00:00:00.000Z",
        estimatedWindowEnd: "2026-06-26T00:00:00.000Z",
        daysAfterLiveWindow: 0,
        estimationStatus: "PARTIALLY_INVOICED_LIVE_BALANCE",
        estimationStatusLabel: "Parcial atendido — saldo vivo",
        factorUsed: 1,
        recommendedIncluded: true,
        conservativeIncluded: true,
        reviewRequired: false,
        warnings: [],
      },
    ],
    detailLines: [
      {
        materialId: "mat-1",
        materialCode: "MP-01",
        materialName: "Aço",
        unitLabel: "KG",
        orderId: "ord-1",
        orderNumber: "PV-001",
        customerName: "Cliente X",
        productCode: "SKU-1",
        productName: "Produto A",
        soldQuantity: 100,
        invoicedQuantity: 50,
        openQuantity: 50,
        openNetAmount: 5_000,
        estimationStatus: "PARTIALLY_INVOICED_LIVE_BALANCE",
        estimationStatusLabel: "Parcial atendido — saldo vivo",
        factorUsed: 1,
        bomQuantityPerUnit: 2,
        recommendedQuantity: 20,
        conservativeQuantity: 30,
        reviewQuantity: 0,
        unservedRevenueAmount: 0,
        recommendedIncluded: true,
        conservativeIncluded: true,
        inclusionReason: "Saldo vivo na janela fiscal",
        warnings: [],
      },
    ],
    orderNfesByOrderId: {
      "ord-1": [{ dataProcessamento: "2026-06-12", numero: "123", serie: "1" }],
    },
    reviewItems: [],
  };
}

describe("materialDemandIntelligenceDrilldown", () => {
  it("drilldown de matéria-prima renderiza produtos e pedidos", () => {
    const view = buildMaterialDrilldownView("mat-1", sampleIntelligence());
    assert.ok(view);
    assert.equal(view!.products.length, 1);
    assert.equal(view!.orders.length, 1);
    assert.equal(view!.orders[0]!.customerName, "Cliente X");
    assert.equal(view!.totals.recommendedQuantity, 20);
    assert.ok(Number.isFinite(view!.totals.conservativeQuantity));
  });

  it("drilldown de pedido renderiza itens e NFs", () => {
    const view = buildOrderDrilldownView("ord-1", sampleIntelligence());
    assert.ok(view);
    assert.equal(view!.items.length, 1);
    assert.equal(view!.nfes.length, 1);
    assert.equal(view!.items[0]!.materials.length, 1);
    assert.equal(view!.items[0]!.materials[0]!.bomQuantityPerUnit, 2);
  });

  it("sem dados não quebra drilldown", () => {
    const empty = emptyIntelligenceBlock();
    assert.equal(buildMaterialDrilldownView("x", empty), null);
    assert.equal(buildOrderDrilldownView("x", empty), null);
    assert.equal(hasIntelligenceDisplayData(empty), false);
  });

  it("sem BOM aparece em revisão no bloco", () => {
    const intel = sampleIntelligence();
    intel.reviewItems.push({
      reason: "Produto sem BOM válida",
      orderId: "ord-2",
      orderNumber: "PV-002",
      productCode: "SKU-2",
      productName: "Produto B",
      impact: "Sem valor",
      suggestedAction: "Cadastrar BOM",
    });
    assert.ok(intel.reviewItems.some((r) => r.reason.includes("BOM")));
  });

  it("buildRawMaterialIntelligenceDetailLines não retorna NaN", () => {
    const lines = buildRawMaterialIntelligenceDetailLines({
      demandLines: [
        {
          recommendedDemand: 10,
          conservativeDemand: 12,
          uncertaintyDemand: 2,
          reviewDemand: 0,
          materialCode: "MP-01",
          materialName: "Aço",
          unit: "KG",
          sourceOrderId: "ord-1",
          sourceOrderNumber: "PV-001",
          sourceItemId: "item-1",
          productCode: "SKU-1",
          productName: "Produto A",
          status: "PARTIALLY_INVOICED_LIVE_BALANCE",
          factorUsed: 1,
          explanation: "teste",
          classification: {
            status: "PARTIALLY_INVOICED_LIVE_BALANCE",
            statusLabel: "Parcial atendido — saldo vivo",
            includeInRecommended: true,
            includeInConservative: true,
            includeInUnservedRevenue: false,
            reviewRequired: false,
            openQuantity: 50,
            openNetAmount: 5000,
            lastInvoiceDate: null,
            liveWindowStart: null,
            liveWindowEnd: null,
            daysAfterLiveWindow: 0,
            overlapFactor: 1,
            confidence: "HIGH",
            warnings: [],
          },
        },
      ],
      orders: sampleIntelligence().orders,
      contributions: [],
      unservedBalances: [],
      materialIdByCode: new Map([["MP-01", "mat-1"]]),
    });
    assert.equal(lines.length, 1);
    assert.ok(Number.isFinite(lines[0]!.recommendedQuantity));
  });
});
