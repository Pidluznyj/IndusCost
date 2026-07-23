/**
 * KAN-LINK-08 — Diagnóstico operacional pronto para o Kanban (sem recálculo no FE).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assembleSalesOrderFlowEvidenceBatch } from "./salesOrderFlowEvidence.js";
import { SALES_ORDER_FLOW_COMPUTATION_VERSION } from "./salesOrderFlowFingerprint.js";
import {
  buildSalesOrderFlowOperationalDiagnosticsFromPack,
  collectOperationalDiagnosticBadges,
  SALES_ORDER_FLOW_DIAGNOSTIC_BADGE_LABELS,
} from "./salesOrderFlowOperationalDiagnostics.js";
import { getSalesOrderOperationalEvidenceGraphFromPack } from "./salesOrderOperationalEvidenceFromPack.js";

const ORDER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01";
const ITEM_10 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10";
const ITEM_20 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb20";
const EXT_ORDER = 2757;
const EXT_ITEM_10 = 9010;
const EXT_ITEM_20 = 9020;
const EXT_PROD_10 = 5010;
const EXT_PROD_20 = 5020;

function diagnosticPack(options?: {
  withNfe?: boolean;
  partialDs?: boolean;
  ambiguous?: boolean;
  withOp?: boolean;
}) {
  const withNfe = options?.withNfe !== false;
  const partialDs = options?.partialDs === true;
  const ambiguous = options?.ambiguous === true;
  const withOp = options?.withOp === true;

  return assembleSalesOrderFlowEvidenceBatch({
    orders: [
      {
        id: ORDER,
        orderCode: "PD 02757",
        status: "SENT_TO_NOMUS",
        customerId: "c1",
        externalSalesOrderId: EXT_ORDER,
        expectedDeliveryDate: null,
        totalNetValue: 12650.4,
        items: [
          {
            id: ITEM_10,
            salesOrderId: ORDER,
            productId: "p10",
            externalProductId: EXT_PROD_10,
            nomusItemExternalId: EXT_ITEM_10,
            nomusItemSequence: "00010",
            skuSnapshot: "A",
            productNameSnapshot: "Item 10",
            quantity: 114,
            nomusQuantityFulfilled: 0,
            nomusItemStatusRaw: "1",
            nomusItemStatusNormalized: "RELEASED",
          },
          {
            id: ITEM_20,
            salesOrderId: ORDER,
            productId: "p20",
            externalProductId: EXT_PROD_20,
            nomusItemExternalId: EXT_ITEM_20,
            nomusItemSequence: "00020",
            skuSnapshot: "B",
            productNameSnapshot: "Item 20",
            quantity: 360,
            nomusQuantityFulfilled: 0,
            nomusItemStatusRaw: "1",
            nomusItemStatusNormalized: "RELEASED",
          },
        ],
      },
    ],
    products: [
      {
        id: "p10",
        type: "PRODUCT",
        costingMode: "BOM_ONLY",
        hasProductRouting: false,
        hasProductBom: true,
      },
      {
        id: "p20",
        type: "PRODUCT",
        costingMode: "BOM_ONLY",
        hasProductRouting: false,
        hasProductBom: true,
      },
    ],
    nfeLinks: withNfe
      ? [
          {
            id: "nl1",
            salesOrderId: ORDER,
            nfeExternalId: 9001,
            nfeNumber: "7394",
            nfeStatus: 100,
          },
        ]
      : [],
    nomusNfes: withNfe
      ? [
          {
            id: "nfe1",
            externalId: 9001,
            numero: "7394",
            serie: "2",
            status: 4,
          },
        ]
      : [],
    stockDocuments: [
      {
        id: "ds-4525",
        externalId: 4525,
        idNfe: withNfe ? 9001 : null,
        statusRaw: "emitido",
        isCancelled: false,
        externalSalesOrderId: EXT_ORDER,
        orderCodeNormalized: "PD02757",
        totalValue: 12650.4,
      },
    ],
    stockDocumentItems: [
      {
        id: "dsi-10",
        stockDocumentId: "ds-4525",
        externalProductId: EXT_PROD_10,
        quantity: 114,
        externalSalesOrderId: EXT_ORDER,
        externalSalesOrderItemId: EXT_ITEM_10,
        salesOrderItemSequence: "00010",
        orderCodeNormalized: "PD02757",
      },
      {
        id: "dsi-20",
        stockDocumentId: "ds-4525",
        // Produto inexistente no pedido + sem id de item → cobertura AMBIGUOUS.
        externalProductId: ambiguous ? 999999 : EXT_PROD_20,
        quantity: partialDs ? 100 : 360,
        externalSalesOrderId: EXT_ORDER,
        externalSalesOrderItemId: ambiguous ? null : EXT_ITEM_20,
        salesOrderItemSequence: ambiguous ? null : "00020",
        orderCodeNormalized: "PD02757",
      },
    ],
    productionOrders: withOp
      ? [
          {
            id: "op-1",
            externalId: 8801,
            status: "ABERTA",
            quantity: 114,
            productCode: "A",
          },
        ]
      : [],
    productionLinks: withOp
      ? [
          {
            id: "opl-1",
            productionOrderId: "op-1",
            productionOrderExternalId: 8801,
            salesOrderId: ORDER,
            salesOrderItemId: ITEM_10,
            externalSalesOrderId: EXT_ORDER,
            externalSalesOrderItemId: EXT_ITEM_10,
            linkedQuantity: 114,
            isCurrent: true,
          },
        ]
      : [],
  }).get(ORDER)!;
}

describe("KAN-LINK-08 — salesOrderFlowOperationalDiagnostics", () => {
  it("DS reconhecido + NF autorizada com origem e cobertura por item", () => {
    const pack = diagnosticPack({ withNfe: true });
    const diag = buildSalesOrderFlowOperationalDiagnosticsFromPack({
      pack,
      stageLabel: "Aguardando envio",
      stageReason: "Documentado e faturado; falta envio.",
      bottleneckSalesOrderItemId: ITEM_10,
      bottleneckReason: "Item aguardando envio",
      nextAction: "Registrar envio",
      responsibleArea: "Expedição",
      computedAt: "2026-07-22T12:00:00.000Z",
      computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
    });

    assert.equal(diag.title, "Por que está nesta coluna?");
    assert.equal(diag.pendingObligation, true);
    assert.ok(
      diag.evidencesFound.some((e) =>
        e.label.includes("Documento de Saída reconhecido: 4525")
      )
    );
    assert.ok(
      diag.evidencesFound.some((e) => e.label.includes("7394/2 — autorizada"))
    );
    assert.ok(
      diag.evidencesFound.some(
        (e) =>
          e.sourceLabel ===
          "Referência oficial do Pedido de Venda no item do documento"
      )
    );
    assert.ok(
      diag.evidencesFound.some(
        (e) =>
          e.label === "Cobertura documental por item" &&
          e.detail?.includes("Item 00010 — 114") &&
          e.detail?.includes("Item 00020 — 360")
      )
    );
    assert.equal(diag.outputDocumentLabels.includes("4525"), true);
    assert.equal(diag.nfeLabels.some((l) => l.includes("7394")), true);
    assert.equal(diag.totals.documentedQuantity, 474);
    assert.equal(diag.totals.invoicedQuantity, 474);
    assert.equal(diag.badges.includes("DS_LINKED"), true);
    assert.equal(diag.badges.includes("NFE_AUTHORIZED"), true);
    assert.equal(diag.snapshotDivergent, false);
    assert.equal(diag.computationVersion, SALES_ORDER_FLOW_COMPUTATION_VERSION);
  });

  it("DS parcial gera badge e cobertura parcial", () => {
    const pack = diagnosticPack({ withNfe: false, partialDs: true });
    const diag = buildSalesOrderFlowOperationalDiagnosticsFromPack({
      pack,
      stageLabel: null,
      stageReason: null,
      bottleneckSalesOrderItemId: null,
      bottleneckReason: null,
      nextAction: null,
      responsibleArea: null,
      computedAt: null,
      computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
    });
    assert.equal(diag.badges.includes("DS_PARTIAL"), true);
    assert.equal(diag.badges.includes("PARTIAL_COVERAGE"), true);
    assert.ok(diag.totals.documentedQuantity < 474);
  });

  it("linha documental ambígua não inventa OP e marca snapshot divergente", () => {
    const pack = diagnosticPack({
      withNfe: false,
      ambiguous: true,
      withOp: false,
    });
    const graph = getSalesOrderOperationalEvidenceGraphFromPack(pack);
    const diag = buildSalesOrderFlowOperationalDiagnosticsFromPack({
      pack,
      stageLabel: "Em produção",
      stageReason: "Há residual",
      bottleneckSalesOrderItemId: ITEM_20,
      bottleneckReason: "Item sem vínculo claro",
      nextAction: "Resolver vínculo",
      responsibleArea: "PCP",
      computedAt: "2026-07-22T12:00:00.000Z",
      computationVersion: "sales-order-flow/v1",
    });

    assert.equal(diag.productionOrderLabels.length, 0);
    assert.equal(diag.totals.linkedProductionOrderCount, 0);
    assert.equal(diag.snapshotDivergent, true);
    assert.equal(diag.badges.includes("SNAPSHOT_DIVERGENT"), true);
    // Linha com produto fora do pedido não deve avançar cobertura no item 00020.
    const item20 = diag.items.find((i) => i.sequence === "00020");
    assert.ok(item20);
    assert.equal(item20!.documentedCoverage === "NONE" || item20!.documentedQuantity < 360, true);
    assert.ok(graph.items.length >= 1);
  });

  it("OP vinculada aparece nas evidências; warnings não expõem UUID cru", () => {
    const pack = diagnosticPack({ withNfe: true, withOp: true });
    const diag = buildSalesOrderFlowOperationalDiagnosticsFromPack({
      pack,
      stageLabel: "Em produção",
      stageReason: null,
      bottleneckSalesOrderItemId: ITEM_10,
      bottleneckReason: null,
      nextAction: null,
      responsibleArea: null,
      computedAt: null,
      computationVersion: SALES_ORDER_FLOW_COMPUTATION_VERSION,
    });
    assert.equal(diag.badges.includes("OP_LINKED"), true);
    assert.ok(diag.productionOrderLabels.includes("8801"));
    assert.ok(
      diag.evidencesFound.some((e) => e.label.includes("Ordem de Produção 8801"))
    );
    for (const warning of diag.warnings) {
      assert.doesNotMatch(warning, /bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb10/);
      assert.doesNotMatch(warning, /\[item:[0-9a-f-]{36}\]/i);
    }
    assert.ok(
      diag.evidencesFound.every(
        (e) => !/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb/.test(e.label)
      )
    );
  });

  it("labels de badge cobrem o contrato KAN-LINK-08", () => {
    for (const key of [
      "OP_LINKED",
      "OP_PARTIAL",
      "STOCK_FULFILLED",
      "DS_LINKED",
      "DS_PARTIAL",
      "NFE_AUTHORIZED",
      "NFE_CANCELLED",
      "SHIPMENT_COMPLETE",
      "AMBIGUOUS_LINK",
      "ITEM_UNRESOLVED",
      "EXCESS_COVERAGE",
    ] as const) {
      assert.ok(SALES_ORDER_FLOW_DIAGNOSTIC_BADGE_LABELS[key]);
    }
  });
});
