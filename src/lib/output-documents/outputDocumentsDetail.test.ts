/**
 * DS-04.2 — Testes do detalhe geral + itens (completo, parcial, cancelado, 404).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOutputDocumentDetailPayload,
  parseOutputDocumentDetailIdParam,
  summarizeItemResolution,
  type OutputDocumentDetailSyncMeta,
} from "./outputDocumentsDetail.js";
import type { ResolvedOutputDocument } from "./nomusOutputDocumentResolver.js";
import {
  projectOutputDocumentAllocation,
  type OutputDocumentAllocationProjection,
} from "./outputDocumentAllocationProjection.js";

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_1 = "item-1";
const ITEM_2 = "item-2";
const ORDER_A = "00000000-0000-4000-8000-0000000000a1";
const SOI_A1 = "soi-a1";
const NOW = new Date("2026-07-17T12:00:00.000Z");

const DETAIL_VIEW_PERMS = {
  canViewFinancial: true,
  canViewAudit: true,
} as const;

function syncMeta(
  partial: Partial<OutputDocumentDetailSyncMeta> = {}
): OutputDocumentDetailSyncMeta {
  return {
    syncedAt: new Date("2026-07-10T10:00:00.000Z"),
    firstSeenAt: new Date("2026-07-01T10:00:00.000Z"),
    lastSeenAt: new Date("2026-07-10T10:00:00.000Z"),
    presentInLastPayload: true,
    cancelledAt: null,
    cancellationReason: null,
    payloadHash: "hash-abc",
    ...partial,
  };
}

function baseResolved(
  partial: Partial<ResolvedOutputDocument["document"]> & {
    items?: ResolvedOutputDocument["items"];
    o2cLines?: ResolvedOutputDocument["o2c"]["allocationLines"];
    orders?: ResolvedOutputDocument["orders"];
    nfe?: ResolvedOutputDocument["nfe"];
    receivables?: ResolvedOutputDocument["receivables"];
  } = {}
): ResolvedOutputDocument {
  const { items, o2cLines, orders, nfe, receivables, ...docPartial } = partial;
  return {
    document: {
      id: DOC_ID,
      externalId: 8451,
      idNfe: 7208,
      tipoDocumentoEstoque: "DocumentoSaida",
      dataDocumento: new Date("2026-06-01T00:00:00.000Z"),
      documentNumber: "DS-8451",
      statusRaw: "Aberto",
      isCancelled: false,
      totalValue: "100.00",
      personExternalId: 55,
      personName: "Cliente X",
      companyExternalId: 1,
      companyName: "Koppetel",
      movementDate: new Date("2026-06-02T00:00:00.000Z"),
      paymentTermsRaw: "30 dias",
      ...docPartial,
    },
    items: items ?? [
      {
        id: ITEM_1,
        externalItemId: 10,
        externalProductId: 100,
        quantity: "10",
        unitValue: "10.00",
        estimatedTotalValue: "100.00",
      },
    ],
    listedFromStage: true,
    dependsOnO2cForListing: false,
    nfe: nfe ?? {
      externalId: 7208,
      link: {
        classification: "persistido",
        sources: ["stock_document_idNfe"],
        reasons: [],
      },
      record: {
        externalId: 7208,
        id: "nfe-1",
        numero: "7208",
        chave: "35260612345678901234550010007208123456789012",
        status: 6,
        foundLocally: true,
      },
    },
    orders: orders ?? {
      link: {
        classification: "nao_resolvido",
        sources: [],
        reasons: [],
      },
      orders: [],
    },
    o2c: {
      present: (o2cLines?.length ?? 0) > 0,
      runIds: o2cLines?.length ? ["run-1"] : [],
      allocationLines: o2cLines ?? [],
      usedForAllocationOnly: true,
    },
    receivables: receivables ?? {
      link: {
        classification: "nao_resolvido",
        sources: [],
        reasons: [],
      },
      receivables: [],
    },
  };
}

function projectFromResolved(
  resolved: ResolvedOutputDocument
): OutputDocumentAllocationProjection {
  return projectOutputDocumentAllocation({
    document: {
      id: resolved.document.id,
      externalId: resolved.document.externalId,
      idNfe: resolved.document.idNfe,
      totalValue: resolved.document.totalValue,
      items: resolved.items.map((item) => ({
        id: item.id,
        externalItemId: item.externalItemId,
        externalProductId: item.externalProductId,
        quantity: item.quantity,
        unitValue: item.unitValue,
        estimatedTotalValue: item.estimatedTotalValue,
      })),
    },
    allocationLines: resolved.o2c.allocationLines.map((line) => ({
      stockDocumentItemId: line.stockDocumentItemId,
      salesOrderId: line.salesOrderId,
      salesOrderItemId: line.salesOrderItemId,
      allocatedValueByDocumentPrice: line.allocatedValueByDocumentPrice,
      quantityUsedForOrder: line.quantityUsedForOrder,
    })),
  });
}

describe("parseOutputDocumentDetailIdParam", () => {
  it("aceita UUID e externalId; rejeita inválido", () => {
    assert.deepEqual(parseOutputDocumentDetailIdParam(DOC_ID), {
      kind: "uuid",
      value: DOC_ID,
    });
    assert.deepEqual(parseOutputDocumentDetailIdParam("8451"), {
      kind: "externalId",
      value: 8451,
    });
    assert.equal(parseOutputDocumentDetailIdParam("abc").kind, "invalid");
    assert.equal(parseOutputDocumentDetailIdParam("").kind, "invalid");
  });
});

describe("buildOutputDocumentDetailPayload", () => {
  it("documento completo com item resolvido", () => {
    const resolved = baseResolved({
      o2cLines: [
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A1,
          allocatedValueByDocumentPrice: "100.00",
          quantityUsedForOrder: "10",
          runId: "run-1",
        },
      ],
    });
    const payload = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta(),
      now: NOW,
      permissions: DETAIL_VIEW_PERMS,
    });

    assert.equal(payload.document.externalId, 8451);
    assert.equal(payload.document.totalValue, 100);
    assert.equal(payload.document.company.name, "Koppetel");
    assert.equal(payload.document.customer.name, "Cliente X");
    assert.equal(payload.document.cancellation.isCancelled, false);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0]!.linkStatus, "resolved");
    assert.equal(payload.items[0]!.productLink.hasProductId, true);
    assert.equal(payload.resolution.itemsResolved, 1);
    assert.equal(payload.resolution.listedFromStage, true);
    assert.equal(payload.resolution.dependsOnO2cForListing, false);
    assert.equal(payload.values.totalValue, 100);
    assert.ok(Array.isArray(payload.orders));
    assert.ok(payload.allocations);
    assert.ok(Array.isArray(payload.nfes));
    assert.ok(payload.audit);
    assert.ok(Array.isArray(payload.inconsistencies));
    assert.ok(!JSON.stringify(payload).includes("rawJson"));
  });

  it("documento parcial: item sem vínculo permanece visível", () => {
    const resolved = baseResolved({
      items: [
        {
          id: ITEM_1,
          externalItemId: 10,
          externalProductId: 100,
          quantity: "5",
          unitValue: "10.00",
          estimatedTotalValue: "50.00",
        },
        {
          id: ITEM_2,
          externalItemId: 11,
          externalProductId: 200,
          quantity: "5",
          unitValue: "10.00",
          estimatedTotalValue: "50.00",
        },
      ],
      totalValue: "100.00",
      o2cLines: [
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A1,
          allocatedValueByDocumentPrice: "50.00",
          quantityUsedForOrder: "5",
          runId: "run-1",
        },
      ],
    });
    const payload = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta(),
      now: NOW,
      permissions: DETAIL_VIEW_PERMS,
    });

    assert.equal(payload.items.length, 2);
    assert.equal(payload.items[0]!.linkStatus, "resolved");
    assert.equal(payload.items[1]!.linkStatus, "unresolved");
    assert.equal(payload.resolution.itemsResolved, 1);
    assert.equal(payload.resolution.itemsUnresolved, 1);
    assert.equal(payload.items[1]!.totalValue, 50);
  });

  it("documento cancelado preserva cancelamento", () => {
    const resolved = baseResolved({
      isCancelled: true,
      statusRaw: "Cancelado",
      totalValue: "80.00",
    });
    const payload = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta({
        cancelledAt: new Date("2026-06-15T00:00:00.000Z"),
        cancellationReason: "Cliente desistiu",
      }),
      permissions: DETAIL_VIEW_PERMS,
      now: NOW,
    });

    assert.equal(payload.document.cancellation.isCancelled, true);
    assert.equal(payload.document.cancellation.reason, "Cliente desistiu");
    assert.ok(payload.document.cancellation.cancelledAt);
    assert.equal(payload.document.statusRaw, "Cancelado");
  });

  it("documento sem itens", () => {
    const resolved = baseResolved({
      items: [],
      totalValue: "0.00",
      o2cLines: [],
    });
    const payload = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta(),
      now: NOW,
      permissions: DETAIL_VIEW_PERMS,
    });

    assert.equal(payload.items.length, 0);
    assert.equal(payload.resolution.itemCount, 0);
    assert.equal(payload.values.itemsSum, 0);
  });

  it("itens não resolvidos e vínculo de produto", () => {
    const resolved = baseResolved({
      items: [
        {
          id: ITEM_1,
          externalItemId: null,
          externalProductId: null,
          quantity: "1",
          unitValue: "10.00",
          estimatedTotalValue: "10.00",
        },
      ],
      o2cLines: [],
    });
    const payload = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta(),
      now: NOW,
      permissions: DETAIL_VIEW_PERMS,
    });

    assert.equal(payload.items[0]!.linkStatus, "unresolved");
    assert.equal(payload.items[0]!.productLink.hasProductId, false);
    assert.equal(payload.resolution.itemsUnresolved, 1);
  });
});

describe("summarizeItemResolution", () => {
  it("agrega status de resolução", () => {
    const summary = summarizeItemResolution([
      { linkStatus: "resolved" },
      { linkStatus: "unresolved" },
      { linkStatus: "partial" },
      { linkStatus: "conflict" },
    ]);
    assert.equal(summary.itemCount, 4);
    assert.equal(summary.itemsResolved, 1);
    assert.equal(summary.itemsUnresolved, 1);
    assert.equal(summary.itemsPartial, 1);
    assert.equal(summary.itemsConflict, 1);
  });
});

describe("buildOutputDocumentDetailPayload — relações DS-04.3", () => {
  const ORDER_B = "00000000-0000-4000-8000-0000000000b2";
  const SOI_B1 = "soi-b1";

  it("múltiplos pedidos com alocação, vendedor e cobertura", () => {
    const resolved = baseResolved({
      o2cLines: [
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_A,
          salesOrderItemId: SOI_A1,
          allocatedValueByDocumentPrice: "60.00",
          quantityUsedForOrder: "6",
          runId: "run-1",
        },
        {
          stockDocumentItemId: ITEM_1,
          salesOrderId: ORDER_B,
          salesOrderItemId: SOI_B1,
          allocatedValueByDocumentPrice: "40.00",
          quantityUsedForOrder: "4",
          runId: "run-1",
        },
      ],
      orders: {
        link: {
          classification: "derivado",
          sources: ["sales_order_nfe_link", "order_to_cash_fact"],
          reasons: [],
        },
        orders: [
          {
            salesOrderId: ORDER_A,
            orderCode: "PD-A",
            status: "SENT_TO_NOMUS",
            linkIds: ["l1"],
            sources: ["sales_order_nfe_link", "order_to_cash_fact"],
            items: [],
          },
          {
            salesOrderId: ORDER_B,
            orderCode: "PD-B",
            status: "SENT_TO_NOMUS",
            linkIds: ["l2"],
            sources: ["order_to_cash_fact"],
            items: [],
          },
        ],
      },
    });

    const payload = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta(),
      orderEnrichments: [
        {
          salesOrderId: ORDER_A,
          orderCode: "PD-A",
          issueDate: new Date("2026-05-01T00:00:00.000Z"),
          status: "SENT_TO_NOMUS",
          externalSellerId: 464,
          nomusSellerName: "GISLENE LIMA",
          responsible: null,
          totalNetValue: "500.00",
        },
        {
          salesOrderId: ORDER_B,
          orderCode: "PD-B",
          issueDate: new Date("2026-05-02T00:00:00.000Z"),
          status: "SENT_TO_NOMUS",
          externalSellerId: 100,
          nomusSellerName: "VENDEDOR B",
          responsible: null,
          totalNetValue: "300.00",
        },
      ],
      permissions: DETAIL_VIEW_PERMS,
      now: NOW,
    });

    assert.equal(payload.orders.length, 2);
    assert.equal(payload.orders[0]!.orderCode, "PD-A");
    assert.equal(payload.orders[0]!.officialSeller.name, "GISLENE LIMA");
    assert.equal(payload.orders[0]!.allocatedValue, 60);
    assert.equal(payload.orders[0]!.coveragePercent, 60);
    assert.equal(payload.orders[1]!.allocatedValue, 40);
    assert.equal(payload.allocations.allocatedToOrders, 100);
    assert.equal(payload.allocations.orderShares.length, 2);
  });

  it("múltiplas NF-es com chave mascarada e cancelamento", () => {
    const resolved = baseResolved({
      nfe: {
        externalId: 7208,
        link: {
          classification: "conflitante",
          sources: ["stock_document_idNfe", "order_to_cash_fact"],
          reasons: ["Conflito idNfe: stage=7208, o2c=[9999]"],
        },
        record: {
          externalId: 7208,
          id: "nfe-1",
          numero: "7208",
          chave: "35260612345678901234550010007208123456789012",
          status: 6,
          foundLocally: true,
        },
      },
    });

    const payload = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta(),
      nfeEnrichments: [
        {
          externalId: 7208,
          id: "nfe-1",
          numero: "7208",
          serie: "1",
          status: 6,
          chave: "35260612345678901234550010007208123456789012",
          xmlDhEmi: new Date("2026-06-01T12:00:00.000Z"),
          dataProcessamento: new Date("2026-06-01T13:00:00.000Z"),
          valorLiquido: "100.00",
          xmlVNF: "100.00",
          foundLocally: true,
          sources: ["stock_document_idNfe"],
          isPrimary: true,
        },
        {
          externalId: 9999,
          id: "nfe-2",
          numero: "9999",
          serie: "1",
          status: 7,
          chave: "35260699999999999999950010009999123456789012",
          xmlDhEmi: new Date("2026-06-03T12:00:00.000Z"),
          dataProcessamento: null,
          valorLiquido: "50.00",
          xmlVNF: "50.00",
          foundLocally: true,
          sources: ["order_to_cash_fact"],
          isPrimary: false,
        },
      ],
      permissions: DETAIL_VIEW_PERMS,
      now: NOW,
    });

    assert.equal(payload.nfes.length, 2);
    assert.equal(payload.nfes[0]!.isPrimary, true);
    assert.ok(payload.nfes[0]!.chaveMasked?.includes("…"));
    assert.ok(!payload.nfes[0]!.chaveMasked?.includes("1234567890123455"));
    assert.equal(payload.nfes[1]!.isCancelled, true);
    assert.ok(
      payload.inconsistencies.some((i) => i.code === "NFE_LINK_CONFLICT")
    );
    assert.ok(payload.inconsistencies.some((i) => i.code === "NFE_CANCELLED"));
    assert.ok(payload.inconsistencies.some((i) => i.code === "MULTIPLE_NFES"));
  });

  it("financeiro com CR e títulos", () => {
    const resolved = baseResolved({});
    const payload = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta(),
      financial: {
        stockDocumentExternalId: 8451,
        status: "cr_em_aberto",
        statusReasons: ["Títulos CR em aberto sem recebimento."],
        financialOrigin: "REAL_RECEIVABLE",
        financialOriginReasons: ["CR oficial."],
        nfeExternalId: 7208,
        nfeCancelled: false,
        documentCancelled: false,
        receivableTotalCents: 10000,
        receivableTotal: 100,
        openCents: 10000,
        open: 100,
        receivedCents: 0,
        received: 0,
        nextDueDate: "2026-08-01T00:00:00.000Z",
        titles: [
          {
            receivableExternalId: 1,
            sourceInvoiceId: 7208,
            amountReceivableCents: 10000,
            amountReceivable: 100,
            amountReceivedCents: 0,
            amountReceived: 0,
            balanceReceivableCents: 10000,
            balanceReceivable: 100,
            dueDate: "2026-08-01T00:00:00.000Z",
            settlementDate: null,
            settlement: "aberto",
            dueStatus: "a_vencer",
            alerts: [],
          },
        ],
        installmentCount: 1,
        documentPaymentTermsRaw: "30 dias",
        hasDocumentPaymentTermsEvidence: true,
        orderForecastCents: 0,
        orderForecast: 0,
        dominantCoverageCents: 10000,
        dominantCoverage: 100,
        nfeVsReceivables: "ok",
        alerts: [],
      },
      permissions: DETAIL_VIEW_PERMS,
      now: NOW,
    });

    assert.ok(payload.financial);
    assert.equal(payload.financial!.status, "cr_em_aberto");
    assert.equal(payload.financial!.receivableTotal, 100);
    assert.equal(payload.financial!.open, 100);
    assert.equal(payload.financial!.titles.length, 1);
    assert.equal(payload.financial!.financialOrigin, "REAL_RECEIVABLE");
  });

  it("ausência de relações e auditoria com hash", () => {
    const resolved = baseResolved({
      idNfe: null,
      nfe: {
        externalId: null,
        link: {
          classification: "nao_resolvido",
          sources: [],
          reasons: ["Nenhuma evidência oficial de NF."],
        },
        record: null,
      },
      orders: {
        link: {
          classification: "nao_resolvido",
          sources: [],
          reasons: [],
        },
        orders: [],
      },
      o2cLines: [],
    });

    const payload = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta({ payloadHash: "deadbeef" }),
      permissions: DETAIL_VIEW_PERMS,
      now: NOW,
    });

    assert.equal(payload.orders.length, 0);
    assert.equal(payload.nfes.length, 0);
    assert.equal(payload.financial, null);
    assert.equal(payload.audit!.payloadHash, "deadbeef");
    assert.equal(payload.audit!.nfeLink.classification, "nao_resolvido");
    assert.ok(payload.inconsistencies.some((i) => i.code === "NFE_UNRESOLVED"));
    assert.ok(payload.inconsistencies.some((i) => i.code === "ORDER_UNRESOLVED"));
    assert.ok(!JSON.stringify(payload).includes("rawJson"));
  });

  it("vínculos conflitantes entram em inconsistências e auditoria", () => {
    const resolved = baseResolved({
      orders: {
        link: {
          classification: "conflitante",
          sources: ["sales_order_nfe_link", "order_to_cash_fact"],
          reasons: ["Fontes discordam sobre pedidos"],
        },
        orders: [],
      },
      nfe: {
        externalId: 7208,
        link: {
          classification: "conflitante",
          sources: ["stock_document_idNfe", "order_to_cash_fact"],
          reasons: ["Conflito idNfe"],
        },
        record: {
          externalId: 7208,
          id: "nfe-1",
          numero: "7208",
          chave: null,
          status: 6,
          foundLocally: true,
        },
      },
    });

    const payload = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta(),
      now: NOW,
      permissions: DETAIL_VIEW_PERMS,
    });

    assert.ok(payload.audit!.conflicts.length >= 2);
    assert.ok(
      payload.inconsistencies.some((i) => i.code === "ORDER_LINK_CONFLICT")
    );
    assert.ok(
      payload.inconsistencies.some((i) => i.code === "NFE_LINK_CONFLICT")
    );
  });

  it("cancelamento do documento aparece nas inconsistências", () => {
    const resolved = baseResolved({ isCancelled: true, statusRaw: "Cancelado" });
    const payload = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta({
        cancelledAt: new Date("2026-06-15T00:00:00.000Z"),
        cancellationReason: "Cliente desistiu",
      }),
      permissions: DETAIL_VIEW_PERMS,
      now: NOW,
    });
    assert.equal(payload.document.cancellation.isCancelled, true);
    assert.ok(
      payload.inconsistencies.some((i) => i.code === "DOCUMENT_CANCELLED")
    );
  });
});

describe("buildOutputDocumentDetailPayload — permissões DS-04.4", () => {
  it("sem permissão financeira/auditoria mantém seções nulas", () => {
    const resolved = baseResolved({});
    const payload = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta({ payloadHash: "deadbeef" }),
      financial: {
        stockDocumentExternalId: 8451,
        status: "cr_em_aberto",
        statusReasons: [],
        financialOrigin: "REAL_RECEIVABLE",
        financialOriginReasons: [],
        nfeExternalId: 7208,
        nfeCancelled: false,
        documentCancelled: false,
        receivableTotalCents: 10000,
        receivableTotal: 100,
        openCents: 10000,
        open: 100,
        receivedCents: 0,
        received: 0,
        nextDueDate: null,
        titles: [],
        installmentCount: 0,
        documentPaymentTermsRaw: null,
        hasDocumentPaymentTermsEvidence: false,
        orderForecastCents: 0,
        orderForecast: 0,
        dominantCoverageCents: 0,
        dominantCoverage: 0,
        nfeVsReceivables: "ok",
        alerts: [],
      },
      now: NOW,
      permissions: { canViewFinancial: false, canViewAudit: false },
    });

    assert.equal(payload.financial, null);
    assert.equal(payload.audit, null);
    assert.equal(payload.permissions.canViewFinancial, false);
    assert.equal(payload.permissions.canViewAudit, false);
  });

  it("raw só aparece com canViewRaw e raw fornecido", () => {
    const resolved = baseResolved({});
    const rawPayload = { document: { id: 1 }, items: [{ id: "i1" }] };
    const denied = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta(),
      raw: rawPayload,
      now: NOW,
      permissions: { ...DETAIL_VIEW_PERMS, canViewRaw: false },
    });
    assert.equal(denied.raw, null);

    const allowed = buildOutputDocumentDetailPayload({
      resolved,
      projection: projectFromResolved(resolved),
      sync: syncMeta(),
      raw: rawPayload,
      now: NOW,
      permissions: { ...DETAIL_VIEW_PERMS, canViewRaw: true },
    });
    assert.deepEqual(allowed.raw, rawPayload);
    assert.equal(allowed.permissions.canViewRaw, true);
  });
});
