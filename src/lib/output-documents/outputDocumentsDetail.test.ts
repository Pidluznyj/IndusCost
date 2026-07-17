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
    ...partial,
  };
}

function baseResolved(
  partial: Partial<ResolvedOutputDocument["document"]> & {
    items?: ResolvedOutputDocument["items"];
    o2cLines?: ResolvedOutputDocument["o2c"]["allocationLines"];
  } = {}
): ResolvedOutputDocument {
  const { items, o2cLines, ...docPartial } = partial;
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
    nfe: {
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
        chave: null,
        status: 6,
        foundLocally: true,
      },
    },
    orders: {
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
    receivables: {
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
