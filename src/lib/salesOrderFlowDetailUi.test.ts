import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HttpError } from "@/src/lib/http.js";
import type { SalesOrderFlowDetailPayload } from "@/src/lib/sales/salesOrderFlowDetail.js";
import {
  classifySalesOrderFlowDetailError,
  formatSalesOrderFlowFulfillmentClassification,
  resolveSalesOrderFlowDetailItems,
} from "@/src/lib/salesOrderFlowDetailUi.js";
import { SalesOrderFlowDetailContent } from "@/src/components/commercial/SalesOrderFlowDetailDrawer.js";
import { getSalesOrderFlowDetailApiPath } from "@/src/lib/salesOrderFlowClient.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function detailFixture(
  overrides: Partial<SalesOrderFlowDetailPayload> = {}
): SalesOrderFlowDetailPayload {
  return {
    salesOrderId: "11111111-1111-4111-8111-111111111111",
    recomputable: false,
    snapshotStatus: "READY",
    message: null,
    order: {
      orderCode: "PV-0069",
      customerId: "cust",
      customerName: "Cliente Drawer",
      sellerName: "Ana",
      companyIssuer: "Koppetel",
      issueDate: "2026-07-01T12:00:00.000Z",
      expectedDeliveryDate: "2026-07-20T12:00:00.000Z",
      status: "OPEN",
      manualMetadata: {
        notes: null,
        internalNotes: null,
        responsible: null,
        paymentTerms: null,
        paymentMethod: null,
        freightCondition: null,
        deliveryLocation: null,
      },
    },
    orderSnapshot: {
      daysInStage: 4,
      currentStage: "IN_PRODUCTION",
    },
    itemSnapshots: [
      {
        salesOrderItemId: "item-1",
        productCode: "SKU-1",
        productName: "Peça A",
        orderedQuantity: 10,
        progressProductionOrder: 100,
        progressProduced: 40,
        progressDocumented: 20,
        progressInvoiced: 10,
        progressShipped: 5,
        activeRemainingQuantity: 8,
        cutQuantity: 1,
        currentStage: "IN_PRODUCTION",
        nextAction: "Produzir",
        fulfillmentClassification: "PARTIAL",
        inconsistencies: [
          {
            code: "MISSING_PRODUCTION_ORDER",
            severity: "WARNING",
            detail: null,
          },
        ],
      },
      {
        salesOrderItemId: "item-2",
        productCode: "SKU-2",
        productName: "Peça B",
        orderedQuantity: 2,
        progressProductionOrder: 0,
        progressProduced: null,
        progressDocumented: 0,
        progressInvoiced: 0,
        progressShipped: 0,
        activeRemainingQuantity: 2,
        cutQuantity: 0,
        currentStage: "WAITING_PRODUCTION_ORDER",
        nextAction: "Abrir OP",
        fulfillmentClassification: "OPEN",
        inconsistencies: [],
      },
    ],
    columnExplanation: {
      stage: "IN_PRODUCTION",
      label: "Em produção",
      reason: "Há itens ativos aguardando produção.",
      responsibleArea: "Produção",
      nextAction: "Finalizar produção",
    },
    bottleneck: {
      stage: "IN_PRODUCTION",
      salesOrderItemId: "item-1",
      reason: "Item gargalo em produção",
    },
    nextAction: "Finalizar produção",
    responsibleArea: "Produção",
    progress: {
      productionOrder: 80,
      produced: 40,
      documented: 20,
      invoiced: 10,
      shipped: 5,
    },
    shipmentDates: {
      firstShippedAt: null,
      lastShippedAt: null,
      completedAt: null,
      promisedDeliveryAt: "2026-07-20T12:00:00.000Z",
      isOverdue: true,
    },
    productionOrders: [],
    stockDocuments: [],
    nfes: [],
    financialSituation: {
      orderValue: 1500,
      fulfilledValue: 200,
      activeResidualValue: 1200,
      cutValue: 100,
      canceledValue: 0,
      documentCount: 1,
      validNfeCount: 0,
      canceledNfeCount: 0,
    },
    inconsistencies: [
      {
        code: "MISSING_PRODUCTION_ORDER",
        severity: "WARNING",
        detail: "Item sem OP",
      },
    ],
    badges: ["OVERDUE"],
    management: {
      priority: "HIGH",
      responsibleUserId: null,
      responsibleName: null,
      responsibleArea: "Produção",
      isBlocked: true,
      blockReason: "Material faltante",
      reason: null,
      expectedResolutionAt: null,
      internalNote: null,
      updatedAt: null,
    },
    officialLinks: {
      salesOrder: "/sales-orders/x",
      salesOrderPrint: "/print",
      salesOrderDetailApi: "/api",
      salesOrderIntelligenceApi: "/api",
      outputDocuments: "/output",
      productionOrders: "/ops",
    },
    valuesVisible: true,
    productionVisible: true,
    fiscalVisible: true,
    financialVisible: true,
    inconsistenciesVisible: true,
    generatedAt: "2026-07-17T12:00:00.000Z",
    ...overrides,
  };
}

describe("sales order flow detail drawer (OP-69)", () => {
  it("expõe path tipado do detalhe", () => {
    assert.equal(
      getSalesOrderFlowDetailApiPath("abc"),
      "/api/commercial/sales-order-flow/abc"
    );
  });

  it("classifica 404, 403 e indisponibilidade", () => {
    assert.equal(
      classifySalesOrderFlowDetailError(new HttpError(404, "x")).kind,
      "not_found"
    );
    assert.equal(
      classifySalesOrderFlowDetailError(new HttpError(403, "x")).kind,
      "access_denied"
    );
    assert.equal(
      classifySalesOrderFlowDetailError(new HttpError(503, "x")).kind,
      "api_unavailable"
    );
  });

  it("mantém itens inconsistentes na resolução da aba Itens", () => {
    const items = resolveSalesOrderFlowDetailItems(detailFixture());
    assert.equal(items.length, 2);
    assert.equal(items[0]?.isInconsistent, true);
    assert.equal(items[0]?.productLabel, "SKU-1 · Peça A");
    assert.equal(
      items[0]?.fulfillmentClassificationLabel,
      formatSalesOrderFlowFulfillmentClassification("PARTIAL")
    );
    assert.equal(items[1]?.isInconsistent, false);
  });

  it("renderiza Resumo com etapa, gargalo, valores e bloqueio", () => {
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderFlowDetailContent, {
        detail: detailFixture(),
        items: resolveSalesOrderFlowDetailItems(detailFixture()),
        activeTab: "resumo",
      })
    );
    for (const expected of [
      "Em produção",
      "Há itens ativos aguardando produção.",
      "Item gargalo em produção",
      "Cliente Drawer",
      "Ana",
      "Koppetel",
      "4 dias",
      "R$ 1.500,00",
      "Material faltante",
      "Finalizar produção",
    ]) {
      assert.ok(html.includes(expected), `deveria renderizar ${expected}`);
    }
    assert.match(html, /sales-order-flow-detail-summary/);
  });

  it("renderiza Itens com progresso e evidência, sem ocultar inconsistente", () => {
    const payload = detailFixture();
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderFlowDetailContent, {
        detail: payload,
        items: resolveSalesOrderFlowDetailItems(payload),
        activeTab: "itens",
      })
    );
    assert.match(html, /sales-order-flow-detail-items/);
    assert.match(html, /SKU-1 · Peça A/);
    assert.match(html, /Inconsistente/);
    assert.match(html, /Parcial/);
    assert.match(html, /Produzir/);
    assert.match(html, /sales-order-flow-detail-item-item-1/);
  });

  it("oculta valores no resumo sem permissão", () => {
    const payload = detailFixture({
      valuesVisible: false,
      financialSituation: {
        orderValue: null,
        fulfilledValue: null,
        activeResidualValue: null,
        cutValue: null,
        canceledValue: null,
        documentCount: 0,
        validNfeCount: 0,
        canceledNfeCount: 0,
      },
    });
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderFlowDetailContent, {
        detail: payload,
        items: resolveSalesOrderFlowDetailItems(payload),
        activeTab: "resumo",
      })
    );
    assert.match(html, /Oculto/);
    assert.doesNotMatch(html, /1\.500,00/);
  });

  it("módulo abre o drawer do fluxo e cobre loading/erro/negado/inexistente", () => {
    const mod = read("src/components/commercial/SalesOrderFlowModule.tsx");
    const drawer = read(
      "src/components/commercial/SalesOrderFlowDetailDrawer.tsx"
    );
    assert.match(mod, /SalesOrderFlowDetailDrawer/);
    assert.doesNotMatch(mod, /SalesOrderDetailDialog/);
    assert.match(drawer, /sales-order-flow-detail-drawer/);
    assert.match(drawer, /sales-order-flow-detail-tabs/);
    assert.match(drawer, /sales-order-flow-detail-loading/);
    assert.match(drawer, /sales-order-flow-detail-not-found/);
    assert.match(drawer, /sales-order-flow-detail-denied/);
    assert.match(drawer, /sales-order-flow-detail-error/);
    assert.match(drawer, /fetchSalesOrderFlowDetail/);
    assert.match(drawer, /Resumo/);
    assert.match(drawer, /Itens/);
  });
});
