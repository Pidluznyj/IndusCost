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
  dedupeSalesOrderFlowDetailEventsByKey,
  filterSalesOrderFlowDetailInconsistencyRows,
  filterSalesOrderFlowManagementAreaOptions,
  formatSalesOrderFlowFulfillmentClassification,
  buildSalesOrderFlowManagementPatchBody,
  classifySalesOrderFlowManagementError,
  resolveSalesOrderFlowDetailAvailableTabs,
  resolveSalesOrderFlowDetailEventView,
  resolveSalesOrderFlowDetailInconsistencyRows,
  resolveSalesOrderFlowDetailItems,
  resolveSalesOrderFlowDetailShipmentViews,
  resolveSalesOrderFlowManagementUiCapabilities,
  salesOrderFlowInconsistencySeverityClassName,
  salesOrderFlowManagementToFormState,
} from "@/src/lib/salesOrderFlowDetailUi.js";
import { SalesOrderFlowDetailContent } from "@/src/components/commercial/SalesOrderFlowDetailDrawer.js";
import {
  getSalesOrderFlowDetailApiPath,
  getSalesOrderFlowEventsApiPath,
  getSalesOrderFlowManagementApiPath,
} from "@/src/lib/salesOrderFlowClient.js";
import type { SalesOrderFlowDetailTab } from "@/src/lib/salesOrderFlowDetailUi.js";

function renderDetailTab(
  payload: SalesOrderFlowDetailPayload,
  activeTab: SalesOrderFlowDetailTab,
  managementCapabilities?: {
    canUpdateManually: boolean;
    canChangePriority: boolean;
    canAssignResponsible: boolean;
    canManageBlocking: boolean;
  }
) {
  return renderToStaticMarkup(
    React.createElement(SalesOrderFlowDetailContent, {
      detail: payload,
      items: resolveSalesOrderFlowDetailItems(payload),
      shipment: resolveSalesOrderFlowDetailShipmentViews(payload),
      activeTab,
      salesOrderId: payload.salesOrderId,
      managementCapabilities: managementCapabilities ?? {
        canUpdateManually: false,
        canChangePriority: false,
        canAssignResponsible: false,
        canManageBlocking: false,
      },
    })
  );
}

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
    timelineVisible: true,
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
    const html = renderDetailTab(detailFixture(), "resumo");
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
    const html = renderDetailTab(detailFixture(), "itens");
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
    const html = renderDetailTab(payload, "resumo");
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

function shipmentDetailFixture(
  overrides: Partial<SalesOrderFlowDetailPayload> = {}
): SalesOrderFlowDetailPayload {
  return detailFixture({
    productionOrders: [
      {
        id: "op-1",
        externalId: 5800,
        status: "ABERTA",
        productCode: "SKU-1",
        linkedQuantity: 10,
        plannedQuantity: 12,
        producedQuantity: 4,
        openedAt: "2026-07-02T10:00:00.000Z",
        closedAt: null,
        linkCount: 1,
        isCurrentLink: true,
        inconsistencies: [
          {
            code: "PRODUCTION_LINK_ITEM_MISMATCH",
            detail: "Item 2 sem vínculo",
          },
        ],
        href: "/production-orders?search=5800",
      },
    ],
    stockDocuments: [
      {
        id: "doc-1",
        externalId: 101,
        documentNumber: "DS-101",
        statusRaw: "EMITIDO",
        dataDocumento: "2026-07-10T12:00:00.000Z",
        itemCount: 2,
        itemQuantity: 8,
        allocatedQuantity: 8,
        allocationCount: 2,
        totalValue: 900,
        isCancelled: false,
        cancellationReason: null,
        href: "/output-documents?search=DS-101",
      },
      {
        id: "doc-2",
        externalId: 102,
        documentNumber: "DS-102",
        statusRaw: "CANCELADO",
        dataDocumento: "2026-07-11T12:00:00.000Z",
        itemCount: 1,
        itemQuantity: 3,
        allocatedQuantity: 0,
        allocationCount: 0,
        totalValue: 300,
        isCancelled: true,
        cancellationReason: "Erro de emissão",
        href: "/output-documents?search=DS-102",
      },
    ],
    nfes: [
      {
        externalId: 201,
        numero: "12345",
        serie: "1",
        issuedAt: "2026-07-12T15:00:00.000Z",
        statusNormalized: { label: "Autorizada" },
        linkedQuantity: 8,
        linkedValue: 900,
        isCanceled: false,
        href: "/output-documents?search=12345",
      },
      {
        externalId: 202,
        numero: "12346",
        serie: "1",
        issuedAt: "2026-07-13T15:00:00.000Z",
        statusNormalized: { label: "Cancelada" },
        linkedQuantity: 3,
        linkedValue: 300,
        isCanceled: true,
        href: "/output-documents?search=12346",
      },
    ],
    shipmentDates: {
      firstShippedAt: "2026-07-12T15:00:00.000Z",
      lastShippedAt: "2026-07-14T15:00:00.000Z",
      completedAt: null,
      promisedDeliveryAt: "2026-07-20T12:00:00.000Z",
      isOverdue: false,
    },
    progress: {
      productionOrder: 80,
      produced: 40,
      documented: 60,
      invoiced: 50,
      shipped: 45,
    },
    ...overrides,
  });
}

describe("sales order flow detail drawer tabs (OP-70)", () => {
  it("resolve views completas e exclui cancelados dos contadores", () => {
    const views = resolveSalesOrderFlowDetailShipmentViews(
      shipmentDetailFixture()
    );
    assert.equal(views.production.length, 1);
    assert.equal(views.documentsActive.length, 1);
    assert.equal(views.documentsCanceled.length, 1);
    assert.equal(views.nfesActive.length, 1);
    assert.equal(views.nfesCanceled.length, 1);
    assert.equal(views.activeDocumentCount, 1);
    assert.equal(views.activeNfeCount, 1);
    assert.equal(views.production[0]?.label, "OP 5800");
    assert.equal(views.documentsActive[0]?.label, "DS DS-101");
    assert.equal(views.nfesActive[0]?.serie, "1");
    assert.equal(views.firstShippedAt, "2026-07-12T15:00:00.000Z");
  });

  it("resolve dados parciais sem inventar vínculos", () => {
    const views = resolveSalesOrderFlowDetailShipmentViews(
      shipmentDetailFixture({
        productionOrders: [
          {
            id: "op-partial",
            externalId: 99,
            status: null,
            productCode: null,
            linkedQuantity: null,
            plannedQuantity: null,
            producedQuantity: null,
            openedAt: null,
            closedAt: null,
            linkCount: 0,
            isCurrentLink: false,
            inconsistencies: [],
            href: "/production-orders?search=99",
          },
        ],
        stockDocuments: [
          {
            id: "doc-partial",
            externalId: 55,
            documentNumber: null,
            statusRaw: null,
            dataDocumento: null,
            itemCount: 0,
            itemQuantity: null,
            allocatedQuantity: null,
            allocationCount: 0,
            totalValue: null,
            isCancelled: false,
            cancellationReason: null,
            href: "/output-documents?search=55",
          },
        ],
        nfes: [
          {
            externalId: 77,
            numero: null,
            serie: null,
            issuedAt: null,
            statusNormalized: null,
            linkedQuantity: null,
            linkedValue: null,
            isCanceled: false,
            href: "/output-documents",
          },
        ],
        shipmentDates: {
          firstShippedAt: null,
          lastShippedAt: null,
          completedAt: null,
          promisedDeliveryAt: null,
          isOverdue: null,
        },
      })
    );
    assert.equal(views.production[0]?.linkedQuantity, null);
    assert.equal(views.production[0]?.producedQuantity, null);
    assert.equal(views.documentsActive[0]?.label, "DS #55");
    assert.equal(views.nfesActive[0]?.label, "NF-e #77");
    assert.equal(views.firstShippedAt, null);
  });

  it("respeita permissões nas abas disponíveis", () => {
    const all = resolveSalesOrderFlowDetailAvailableTabs(
      shipmentDetailFixture()
    );
    assert.deepEqual(
      all.map((tab) => tab.id),
      [
        "resumo",
        "itens",
        "producao",
        "documentos",
        "nfe_envio",
        "timeline",
        "inconsistencias",
      ]
    );
    assert.equal(all.find((tab) => tab.id === "documentos")?.count, 1);
    assert.equal(all.find((tab) => tab.id === "nfe_envio")?.count, 1);

    const noProduction = resolveSalesOrderFlowDetailAvailableTabs(
      shipmentDetailFixture({ productionVisible: false, productionOrders: [] })
    );
    assert.equal(
      noProduction.some((tab) => tab.id === "producao"),
      false
    );

    const noFiscal = resolveSalesOrderFlowDetailAvailableTabs(
      shipmentDetailFixture({
        fiscalVisible: false,
        stockDocuments: [],
        nfes: [],
      })
    );
    assert.equal(
      noFiscal.some((tab) => tab.id === "documentos" || tab.id === "nfe_envio"),
      false
    );

    const hiddenViews = resolveSalesOrderFlowDetailShipmentViews(
      shipmentDetailFixture({
        productionVisible: false,
        fiscalVisible: false,
      })
    );
    assert.deepEqual(hiddenViews.production, []);
    assert.deepEqual(hiddenViews.documentsActive, []);
    assert.deepEqual(hiddenViews.nfesActive, []);
  });

  it("renderiza Produção com vínculo, inconsistências e link oficial", () => {
    const html = renderDetailTab(shipmentDetailFixture(), "producao");
    assert.match(html, /sales-order-flow-detail-production/);
    assert.match(html, /OP 5800/);
    assert.match(html, /ABERTA/);
    assert.match(html, /SKU-1/);
    assert.match(html, /Item 2 sem vínculo/);
    assert.match(html, /production-orders\?search=5800/);
    assert.match(html, /Abrir OP/);
  });

  it("renderiza Documentos ativos e cancelados sem contar cancelados", () => {
    const html = renderDetailTab(shipmentDetailFixture(), "documentos");
    assert.match(html, /sales-order-flow-detail-documents/);
    assert.match(html, /1 documento\(s\) contados/);
    assert.match(html, /DS DS-101/);
    assert.match(html, /Documentos cancelados/);
    assert.match(html, /Erro de emissão/);
    assert.match(html, /output-documents\?search=DS-101/);
  });

  it("renderiza NF-e e Envio com progresso e exclui canceladas do total", () => {
    const html = renderDetailTab(shipmentDetailFixture(), "nfe_envio");
    assert.match(html, /sales-order-flow-detail-nfe-shipment/);
    assert.match(html, /1 NF-e contadas/);
    assert.match(html, /NF-e 12345/);
    assert.match(html, /NF-e canceladas/);
    assert.match(html, /Primeira data de envio/);
    assert.match(html, /Última data de envio/);
    assert.match(html, /45%/);
    assert.match(html, /output-documents\?search=12345/);
  });

  it("oculta valores fiscais sem permissão de valores", () => {
    const html = renderDetailTab(
      shipmentDetailFixture({ valuesVisible: false }),
      "documentos"
    );
    assert.match(html, /Oculto/);
    assert.doesNotMatch(html, /900/);
  });

  it("drawer declara as três abas de evidência e não chama Nomus", () => {
    const drawer = read(
      "src/components/commercial/SalesOrderFlowDetailDrawer.tsx"
    );
    const ui = read("src/lib/salesOrderFlowDetailUi.ts");
    assert.match(ui, /label: "Produção"/);
    assert.match(ui, /label: "Documentos de Saída"/);
    assert.match(ui, /label: "NF-e e Envio"/);
    assert.match(drawer, /sales-order-flow-detail-production/);
    assert.match(drawer, /sales-order-flow-detail-documents/);
    assert.match(drawer, /sales-order-flow-detail-nfe-shipment/);
    assert.doesNotMatch(drawer, /fetchNomus|NomusClient|nomusRest/i);
    assert.doesNotMatch(ui, /fetchNomus|NomusClient|nomusRest/i);
  });
});

describe("sales order flow timeline and inconsistencies (OP-71)", () => {
  it("expõe path tipado de eventos", () => {
    assert.equal(
      getSalesOrderFlowEventsApiPath("abc"),
      "/api/commercial/sales-order-flow/abc/events"
    );
  });

  it("mapeia retorno de etapa, corte e cancelamento sem rawJson", () => {
    const returned = resolveSalesOrderFlowDetailEventView({
      id: "e1",
      eventType: "STAGE_RETURNED",
      fromStage: "WAITING_NFE",
      toStage: "WAITING_OUTPUT_DOCUMENT",
      salesOrderItemId: "item-1",
      dedupeKey: "item|item-1|STAGE_RETURNED|WAITING_NFE|WAITING_OUTPUT_DOCUMENT|fp",
      details: {
        scope: "ITEM",
        direction: "RETURN",
        fingerprint: "fp",
      },
      actorId: null,
      occurredAt: "2026-07-10T12:00:00.000Z",
      observedAt: "2026-07-10T12:05:00.000Z",
      createdAt: "2026-07-10T12:05:00.000Z",
    }, new Map([["item-1", "SKU-1 · Peça A"]]));

    assert.equal(returned.isStageReturn, true);
    assert.equal(returned.isCut, false);
    assert.equal(returned.isCancellation, false);
    assert.match(returned.fromStageLabel, /documento|NF|saída|aguardando/i);
    assert.equal(returned.originLabel.includes("Item"), true);
    assert.equal(returned.relatedDocument, null);
    assert.doesNotMatch(JSON.stringify(returned), /rawJson|fingerprint/);

    const cut = resolveSalesOrderFlowDetailEventView({
      id: "e2",
      eventType: "CUT_DETECTED",
      fromStage: "IN_PRODUCTION",
      toStage: "IN_PRODUCTION",
      salesOrderItemId: null,
      dedupeKey: "order|x|CUT_DETECTED|||fp2",
      details: {
        scope: "ORDER",
        fulfillmentClassification: "FULFILLED_WITH_CUT",
      },
      actorId: null,
      occurredAt: "2026-07-11T12:00:00.000Z",
      observedAt: null,
      createdAt: "2026-07-11T12:00:00.000Z",
    });
    assert.equal(cut.isCut, true);
    assert.match(cut.reason ?? "", /corte|Atendido/i);

    const canceled = resolveSalesOrderFlowDetailEventView({
      id: "e3",
      eventType: "CANCELED",
      fromStage: "IN_PRODUCTION",
      toStage: "CANCELED",
      salesOrderItemId: null,
      dedupeKey: "order|x|CANCELED|IN_PRODUCTION|CANCELED|fp3",
      details: { scope: "ORDER" },
      actorId: null,
      occurredAt: "2026-07-12T12:00:00.000Z",
      observedAt: "2026-07-12T12:00:00.000Z",
      createdAt: "2026-07-12T12:00:00.000Z",
    });
    assert.equal(canceled.isCancellation, true);
  });

  it("deduplica eventos pela dedupeKey ao paginar", () => {
    const deduped = dedupeSalesOrderFlowDetailEventsByKey([
      { id: "a", dedupeKey: "k1" },
      { id: "b", dedupeKey: "k1" },
      { id: "c", dedupeKey: "k2" },
      { id: "d", dedupeKey: null },
      { id: "d", dedupeKey: null },
    ]);
    assert.deepEqual(
      deduped.map((row) => row.id),
      ["a", "c", "d"]
    );
  });

  it("resolve severidades e não marca resolução sem evidência", () => {
    const payload = detailFixture({
      inconsistencies: [
        {
          code: "DUPLICATE_TRUTH_RISK",
          severity: "CRITICAL",
          detail: "Duas fontes conflitantes",
        },
        {
          code: "DOCUMENT_WITHOUT_NFE",
          severity: "INFO",
          detail: "DS sem NF",
        },
      ],
      orderSnapshot: {
        daysInStage: 4,
        currentStage: "IN_PRODUCTION",
        computedAt: "2026-07-15T10:00:00.000Z",
      },
    });
    const items = resolveSalesOrderFlowDetailItems(payload);
    const rows = resolveSalesOrderFlowDetailInconsistencyRows(payload, items);
    const critical = rows.find((row) => row.code === "DUPLICATE_TRUTH_RISK");
    const info = rows.find((row) => row.code === "DOCUMENT_WITHOUT_NFE");
    assert.ok(critical);
    assert.ok(info);
    assert.equal(critical?.severity, "CRITICAL");
    assert.equal(info?.severity, "INFO");
    assert.match(critical?.conclusionEffect ?? "", /evidência/i);
    assert.doesNotMatch(critical?.conclusionEffect ?? "", /resolvid/i);
    assert.match(
      salesOrderFlowInconsistencySeverityClassName("CRITICAL"),
      /rose-50/
    );
    assert.match(
      salesOrderFlowInconsistencySeverityClassName("WARNING"),
      /amber-50/
    );
    assert.match(
      salesOrderFlowInconsistencySeverityClassName("INFO"),
      /muted/
    );

    const filtered = filterSalesOrderFlowDetailInconsistencyRows(rows, {
      severity: "CRITICAL",
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.code, "DUPLICATE_TRUTH_RISK");

    const byItem = filterSalesOrderFlowDetailInconsistencyRows(rows, {
      salesOrderItemId: "item-1",
    });
    assert.ok(byItem.every((row) => row.salesOrderItemId === "item-1"));
  });

  it("respeita permissões de Timeline e Inconsistências nas abas", () => {
    const all = resolveSalesOrderFlowDetailAvailableTabs(detailFixture());
    assert.ok(all.some((tab) => tab.id === "timeline"));
    assert.ok(all.some((tab) => tab.id === "inconsistencias"));

    const hidden = resolveSalesOrderFlowDetailAvailableTabs(
      detailFixture({
        timelineVisible: false,
        inconsistenciesVisible: false,
        inconsistencies: [],
      })
    );
    assert.equal(
      hidden.some(
        (tab) => tab.id === "timeline" || tab.id === "inconsistencias"
      ),
      false
    );
  });

  it("renderiza Inconsistências com severidade e filtros", () => {
    const html = renderDetailTab(detailFixture(), "inconsistencias");
    assert.match(html, /sales-order-flow-detail-inconsistencies/);
    assert.match(html, /MISSING_PRODUCTION_ORDER|Inconsistente|Produção/i);
    assert.match(html, /sales-order-flow-inconsistency-item-filter/);
    assert.match(html, /sales-order-flow-inconsistency-severity-filter/);
    assert.doesNotMatch(html, /rawJson/);
  });

  it("renderiza Timeline (estado vazio inicial sem fetch no SSR)", () => {
    const html = renderDetailTab(detailFixture(), "timeline");
    assert.match(html, /sales-order-flow-detail-timeline/);
    assert.match(html, /Timeline do ciclo de vida/);
    assert.match(html, /sales-order-flow-timeline-item-filter/);
    assert.doesNotMatch(html, /rawJson/);
  });
});

describe("sales order flow management actions (OP-72)", () => {
  it("expõe path tipado de management e monta patch com expectedUpdatedAt", () => {
    assert.equal(
      getSalesOrderFlowManagementApiPath("abc"),
      "/api/commercial/sales-order-flow/abc/management"
    );
    const caps = resolveSalesOrderFlowManagementUiCapabilities(() => true);
    assert.equal(caps.canUpdateManually, true);
    assert.equal(caps.canChangePriority, true);
    const baseline = salesOrderFlowManagementToFormState({
      priority: "NORMAL",
      responsibleUserId: null,
      responsibleName: null,
      responsibleArea: null,
      isBlocked: false,
      blockReason: null,
      reason: null,
      expectedResolutionAt: null,
      internalNote: null,
      updatedAt: "2026-07-17T12:00:00.000Z",
    });
    const draft = {
      ...baseline,
      priority: "HIGH",
      isBlocked: true,
      blockReason: "Falta material",
      expectedResolutionAt: "2026-07-20",
      internalNote: "aguardar PCP",
    };
    const built = buildSalesOrderFlowManagementPatchBody({
      expectedUpdatedAt: "2026-07-17T12:00:00.000Z",
      baseline,
      draft,
      capabilities: caps,
    });
    assert.equal(built.validationError, null);
    assert.equal(built.body.expectedUpdatedAt, "2026-07-17T12:00:00.000Z");
    assert.equal(built.body.priority, "HIGH");
    assert.equal(built.body.isBlocked, true);
    assert.equal(built.body.blockReason, "Falta material");
    assert.match(built.body.expectedResolutionAt ?? "", /2026-07-20/);
    assert.equal(built.body.internalNote, "aguardar PCP");
  });

  it("valida bloqueio sem motivo e respeita autorização granular", () => {
    const caps = resolveSalesOrderFlowManagementUiCapabilities((resource) =>
      resource === "commercial.sales_orders.flow_management"
        ? true
        : resource.includes("priority")
    );
    assert.equal(caps.canChangePriority, true);
    assert.equal(caps.canManageBlocking, false);
    assert.equal(caps.canAssignResponsible, false);

    const baseline = salesOrderFlowManagementToFormState(null);
    const built = buildSalesOrderFlowManagementPatchBody({
      expectedUpdatedAt: null,
      baseline,
      draft: {
        ...baseline,
        isBlocked: true,
        blockReason: "",
        priority: "URGENT",
      },
      capabilities: {
        canUpdateManually: true,
        canChangePriority: true,
        canAssignResponsible: true,
        canManageBlocking: true,
      },
    });
    assert.match(built.validationError ?? "", /motivo/i);

    const conflict = classifySalesOrderFlowManagementError(
      new HttpError(409, "conflito", "MANAGEMENT_UPDATE_CONFLICT")
    );
    assert.equal(conflict.kind, "conflict");
  });

  it("filtra áreas e preserva auditoria textual sem raw", () => {
    assert.ok(
      filterSalesOrderFlowManagementAreaOptions("pcp").some(
        (row) => row.value === "PCP_PRODUCAO"
      )
    );
    const html = renderDetailTab(detailFixture(), "resumo", {
      canUpdateManually: true,
      canChangePriority: true,
      canAssignResponsible: true,
      canManageBlocking: true,
    });
    assert.match(html, /sales-order-flow-management-panel/);
    assert.match(html, /não alteram a coluna automática/i);
    assert.match(html, /sales-order-flow-management-priority/);
    assert.match(html, /sales-order-flow-management-save/);
    assert.doesNotMatch(html, /rawJson/);

    const readOnly = renderDetailTab(detailFixture(), "resumo", {
      canUpdateManually: false,
      canChangePriority: false,
      canAssignResponsible: false,
      canManageBlocking: false,
    });
    assert.match(readOnly, /sales-order-flow-management-panel/);
    assert.doesNotMatch(readOnly, /sales-order-flow-management-save/);
  });

  it("módulo atualiza card após gestão e rota de lookup existe", () => {
    const mod = read("src/components/commercial/SalesOrderFlowModule.tsx");
    const routes = read("src/lib/salesOrderFlowRoutes.ts");
    const client = read("src/lib/salesOrderFlowClient.ts");
    assert.match(mod, /onManagementUpdated/);
    assert.match(mod, /patchSalesOrderFlowKanbanCard/);
    assert.match(
      routes,
      /\/api\/commercial\/sales-order-flow\/lookup\/responsible-users/
    );
    assert.match(client, /patchSalesOrderFlowManagement/);
    assert.match(client, /fetchSalesOrderFlowResponsibleUsers/);
  });
});
