/**
 * KAN-LINK-06 — Reconciliação Pedido → OP → DS → NF-e.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessOperationalCoverageLevel,
} from "./salesOrderOperationalEvidenceContract.js";
import {
  buildSalesOrderOperationalEvidenceGraph,
  makeOperationalLinkEdge,
} from "./salesOrderOperationalEvidenceGraph.js";
import {
  computeChainCoveredQuantityWithoutDoubleCount,
  normalizeQuantityToOfficialUnit,
  reconcileSalesOrderOperationalEvidence,
} from "./salesOrderOperationalEvidenceReconciler.js";

const ORDER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORDER_2 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ITEM_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const ITEM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";

function obligation(
  salesOrderItemId: string,
  orderedQuantity: number,
  extras?: Partial<{
    activeObligationQuantity: number;
    cutQuantity: number;
    canceledQuantity: number;
    fulfilledQuantity: number | null;
  }>
) {
  return {
    salesOrderItemId,
    orderedQuantity,
    activeObligationQuantity: extras?.activeObligationQuantity ?? orderedQuantity,
    cutQuantity: extras?.cutQuantity ?? 0,
    canceledQuantity: extras?.canceledQuantity ?? 0,
    fulfilledQuantity: extras?.fulfilledQuantity ?? null,
  };
}

function edge(
  partial: Parameters<typeof makeOperationalLinkEdge>[0]
) {
  return makeOperationalLinkEdge(partial);
}

describe("KAN-LINK-06 — fórmulas e unidades", () => {
  it("assessOperationalCoverageLevel cobre NONE/PARTIAL/SUFFICIENT/EXCESS/NOT_REQUIRED", () => {
    assert.equal(
      assessOperationalCoverageLevel({ coveredQuantity: 0, targetQuantity: 10 }),
      "NONE"
    );
    assert.equal(
      assessOperationalCoverageLevel({ coveredQuantity: 4, targetQuantity: 10 }),
      "PARTIAL"
    );
    assert.equal(
      assessOperationalCoverageLevel({ coveredQuantity: 10, targetQuantity: 10 }),
      "SUFFICIENT"
    );
    assert.equal(
      assessOperationalCoverageLevel({ coveredQuantity: 12, targetQuantity: 10 }),
      "EXCESS"
    );
    assert.equal(
      assessOperationalCoverageLevel({
        coveredQuantity: 0,
        targetQuantity: 0,
      }),
      "NOT_REQUIRED"
    );
  });

  it("conversão de unidade: nativa, convertida e inconsistente", () => {
    assert.equal(
      normalizeQuantityToOfficialUnit({
        quantity: 10,
        evidenceUnitCode: "UN",
        officialUnitCode: "UN",
      }).status,
      "NATIVE"
    );
    const conv = normalizeQuantityToOfficialUnit({
      quantity: 2,
      evidenceUnitCode: "CX",
      officialUnitCode: "UN",
      conversionFactorToOfficial: 12,
    });
    assert.equal(conv.status, "CONVERTED");
    assert.equal(conv.quantity, 24);
    const bad = normalizeQuantityToOfficialUnit({
      quantity: 2,
      evidenceUnitCode: "CX",
      officialUnitCode: "UN",
    });
    assert.equal(bad.status, "INCONSISTENT");
    assert.equal(bad.quantity, null);
  });

  it("nenhuma dupla contagem DS+NF pareados", () => {
    const link = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "x",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: "nfe-1",
      reason: "pareado",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 100,
    });
    const chain = computeChainCoveredQuantityWithoutDoubleCount({
      documents: [
        {
          salesOrderItemId: ITEM_A,
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 1,
          nfeExternalId: 900,
          quantity: 100,
          validity: "VALID",
          link,
          advancesKanban: true,
        },
      ],
      nfes: [
        {
          salesOrderItemId: ITEM_A,
          nfeId: "nfe-1",
          nfeExternalId: 900,
          quantity: 100,
          validity: "AUTHORIZED",
          hasDocument: true,
          link,
          advancesKanban: true,
        },
      ],
    });
    assert.equal(chain.chainCoveredQuantity, 100);
    assert.equal(chain.wouldDoubleCountIfSummed, 100);
  });
});

describe("KAN-LINK-06 — matriz de reconciliação", () => {
  it("pedido com OP + DS + NF", () => {
    const opLink = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "op",
      sourceExternalId: 50,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: "op-1",
      outputDocumentId: null,
      nfeId: null,
      reason: "itensPedido",
      sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
      syncedAt: null,
      quantity: 10,
    });
    const dsLink = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "ds",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: "nfe-1",
      reason: "idItemPedido",
      sourceUpdatedAt: "2026-01-02T00:00:00.000Z",
      syncedAt: null,
      quantity: 10,
    });
    const nfeLink = edge({
      sourceType: "SALES_ORDER_NFE_LINK",
      sourceSystem: "INDUSCOST",
      sourceRecordId: "nl",
      sourceExternalId: 900,
      targetRecordId: ORDER,
      targetExternalId: 1001,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: "nfe-1",
      reason: "NfeLink",
      sourceUpdatedAt: "2026-01-03T00:00:00.000Z",
      syncedAt: null,
      quantity: 10,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      orderCode: "PD 06001",
      externalSalesOrderId: 6001,
      obligations: [obligation(ITEM_A, 10)],
      links: [opLink, dsLink, nfeLink],
      productionLinks: [
        {
          salesOrderItemId: ITEM_A,
          productionOrderId: "op-1",
          productionOrderExternalId: 50,
          linkedQuantity: 10,
          link: opLink,
        },
      ],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 1,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          idNfe: 900,
          link: dsLink,
        },
      ],
      nfes: [
        {
          nfeId: "nfe-1",
          nfeExternalId: 900,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          statusNormalized: "AUTHORIZED",
          isValidForBilling: true,
          hasDocument: true,
          link: nfeLink,
        },
      ],
    });
    const r = graph.items[0]!.reconciliation;
    assert.equal(r.productionCoverage, "SUFFICIENT");
    assert.equal(r.documentedCoverage, "SUFFICIENT");
    assert.equal(r.invoicedCoverage, "SUFFICIENT");
    assert.equal(r.shippedCoverage, "SUFFICIENT");
    assert.equal(r.coverageStatus, "SHIPPED");
    assert.equal(r.chainCoveredQuantity, 10);
    assert.equal(r.linkStatus, "RESOLVED");
    assert.ok(r.operationalEvidenceTimeline.length >= 3);
    assert.ok(graph.reconciliation.items.length === 1);
  });

  it("pedido sem OP + DS + NF — evidência posterior prevalece", () => {
    const dsLink = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "ds",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: "nfe-1",
      reason: "idItem",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const nfeLink = edge({
      sourceType: "SALES_ORDER_NFE_LINK",
      sourceSystem: "INDUSCOST",
      sourceRecordId: "nl",
      sourceExternalId: 900,
      targetRecordId: ORDER,
      targetExternalId: 1001,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: null,
      nfeId: "nfe-1",
      reason: "NfeLink",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [dsLink, nfeLink],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 1,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          idNfe: 900,
          link: dsLink,
        },
      ],
      nfes: [
        {
          nfeId: "nfe-1",
          nfeExternalId: 900,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          statusNormalized: "AUTHORIZED",
          isValidForBilling: true,
          hasDocument: true,
          link: nfeLink,
        },
      ],
      reconciliationOptions: {
        requiresProductionByItem: { [ITEM_A]: true },
      },
    });
    const r = graph.items[0]!.reconciliation;
    assert.equal(r.productionCoverage, "NONE");
    assert.equal(r.coverageStatus, "SHIPPED");
    assert.ok(
      r.warnings.some((w) =>
        w.includes("prevalece sobre ausência de OP")
      )
    );
  });

  it("OP sem DS", () => {
    const opLink = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "op",
      sourceExternalId: 50,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: "op-1",
      outputDocumentId: null,
      nfeId: null,
      reason: "op",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [opLink],
      productionLinks: [
        {
          salesOrderItemId: ITEM_A,
          productionOrderId: "op-1",
          productionOrderExternalId: 50,
          linkedQuantity: 10,
          link: opLink,
        },
      ],
    });
    const r = graph.items[0]!.reconciliation;
    assert.equal(r.productionCoverage, "SUFFICIENT");
    assert.equal(r.documentedCoverage, "NONE");
    assert.equal(r.coverageStatus, "IN_PRODUCTION");
  });

  it("DS sem NF", () => {
    const dsLink = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "ds",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: null,
      reason: "ds",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [dsLink],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 1,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          idNfe: null,
          link: dsLink,
        },
      ],
    });
    const r = graph.items[0]!.reconciliation;
    assert.equal(r.documentedCoverage, "SUFFICIENT");
    assert.equal(r.invoicedCoverage, "NONE");
    assert.equal(r.coverageStatus, "DOCUMENTED");
  });

  it("NF sem OP — não regressa para aguardando OP", () => {
    const nfeLink = edge({
      sourceType: "SALES_ORDER_NFE_LINK",
      sourceSystem: "INDUSCOST",
      sourceRecordId: "nl",
      sourceExternalId: 900,
      targetRecordId: ORDER,
      targetExternalId: 1001,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: null,
      nfeId: "nfe-1",
      reason: "nfe",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [nfeLink],
      nfes: [
        {
          nfeId: "nfe-1",
          nfeExternalId: 900,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          statusNormalized: "AUTHORIZED",
          isValidForBilling: true,
          hasDocument: false,
          link: nfeLink,
        },
      ],
    });
    const r = graph.items[0]!.reconciliation;
    assert.equal(r.coverageStatus, "SHIPPED");
    assert.notEqual(r.coverageStatus, "AWAITING_PRODUCTION");
  });

  it("parcial em cada estágio", () => {
    const opLink = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "op",
      sourceExternalId: 50,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: "op-1",
      outputDocumentId: null,
      nfeId: null,
      reason: "op",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 4,
    });
    const dsLink = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "ds",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: null,
      reason: "ds",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 3,
    });
    const nfeLink = edge({
      sourceType: "SALES_ORDER_NFE_LINK",
      sourceSystem: "INDUSCOST",
      sourceRecordId: "nl",
      sourceExternalId: 900,
      targetRecordId: ORDER,
      targetExternalId: 1001,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: null,
      nfeId: "nfe-1",
      reason: "nfe",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 2,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [opLink, dsLink, nfeLink],
      productionLinks: [
        {
          salesOrderItemId: ITEM_A,
          productionOrderId: "op-1",
          productionOrderExternalId: 50,
          linkedQuantity: 4,
          link: opLink,
        },
      ],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 1,
          salesOrderItemId: ITEM_A,
          quantity: 3,
          idNfe: null,
          link: dsLink,
        },
      ],
      nfes: [
        {
          nfeId: "nfe-1",
          nfeExternalId: 900,
          salesOrderItemId: ITEM_A,
          quantity: 2,
          statusNormalized: "AUTHORIZED",
          isValidForBilling: true,
          hasDocument: false,
          link: nfeLink,
        },
      ],
    });
    const r = graph.items[0]!.reconciliation;
    assert.equal(r.productionCoverage, "PARTIAL");
    assert.equal(r.documentedCoverage, "PARTIAL");
    assert.equal(r.invoicedCoverage, "PARTIAL");
    // NF parcial ainda é evidência posterior → INVOICED (não SHIPPED completo)
    assert.equal(r.coverageStatus, "INVOICED");
  });

  it("vários documentos e várias OPs somam por item", () => {
    const op1 = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "op1",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: "op-1",
      outputDocumentId: null,
      nfeId: null,
      reason: "op1",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 6,
    });
    const op2 = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "op2",
      sourceExternalId: 2,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: "op-2",
      outputDocumentId: null,
      nfeId: null,
      reason: "op2",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 4,
    });
    const d1 = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "d1",
      sourceExternalId: 10,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: null,
      reason: "d1",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 7,
    });
    const d2 = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "d2",
      sourceExternalId: 11,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-2",
      nfeId: null,
      reason: "d2",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 3,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [op1, op2, d1, d2],
      productionLinks: [
        {
          salesOrderItemId: ITEM_A,
          productionOrderId: "op-1",
          productionOrderExternalId: 1,
          linkedQuantity: 6,
          link: op1,
        },
        {
          salesOrderItemId: ITEM_A,
          productionOrderId: "op-2",
          productionOrderExternalId: 2,
          linkedQuantity: 4,
          link: op2,
        },
      ],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 10,
          salesOrderItemId: ITEM_A,
          quantity: 7,
          idNfe: null,
          link: d1,
        },
        {
          outputDocumentId: "ds-2",
          outputDocumentExternalId: 11,
          salesOrderItemId: ITEM_A,
          quantity: 3,
          idNfe: null,
          link: d2,
        },
      ],
    });
    const r = graph.items[0]!.reconciliation;
    assert.equal(r.productionOrderQuantity, 10);
    assert.equal(r.documentedQuantity, 10);
    assert.equal(r.productionCoverage, "SUFFICIENT");
    assert.equal(r.documentedCoverage, "SUFFICIENT");
  });

  it("corte cobrindo residual → OP não obrigatória", () => {
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [
        obligation(ITEM_A, 1000, {
          activeObligationQuantity: 400,
          cutQuantity: 600,
          fulfilledQuantity: 400,
        }),
      ],
      links: [],
    });
    const r = graph.items[0]!.reconciliation;
    assert.equal(r.activeObligation, 400);
    assert.equal(r.remainingFulfillment, 0);
    assert.equal(r.productionCoverage, "NOT_REQUIRED");
    assert.equal(r.coverageStatus, "FULFILLED_WITHOUT_PRODUCTION");
    assert.ok(r.operationalEvidenceTimeline.some((e) => e.kind === "CUT"));
  });

  it("documento cancelado permanece histórico e não operacional", () => {
    const link = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "ds",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: null,
      reason: "cancelado",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [link],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 1,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          isCancelled: true,
          link,
        },
      ],
    });
    const r = graph.items[0]!.reconciliation;
    assert.equal(r.documentedQuantity, 0);
    assert.equal(r.documentedCoverage, "NONE");
    const hist = r.operationalEvidenceTimeline.find((e) => e.kind === "CANCEL");
    assert.ok(hist);
    assert.equal(hist!.operational, false);
    assert.ok(
      r.unresolvedEvidence.some((u) => u.code === "NON_OPERATIONAL_DOCUMENT")
    );
  });

  it("devolução classificada como histórico não operacional", () => {
    const link = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "ds",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: null,
      reason: "devolucao",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 5,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [link],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 1,
          salesOrderItemId: ITEM_A,
          quantity: 5,
          tipoDocumentoEstoque: "Devolução de venda",
          link,
        },
      ],
    });
    const r = graph.items[0]!.reconciliation;
    assert.equal(r.documentedQuantity, 0);
    assert.ok(r.operationalEvidenceTimeline.some((e) => e.kind === "RETURN"));
    assert.ok(
      r.operationalEvidenceTimeline.every(
        (e) => e.kind !== "RETURN" || e.operational === false
      )
    );
  });

  it("item ambíguo → linkStatus AMBIGUOUS", () => {
    const ambiguous = edge({
      sourceType: "AMBIGUOUS",
      sourceSystem: "DERIVED",
      sourceRecordId: null,
      sourceExternalId: null,
      targetRecordId: null,
      targetExternalId: null,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-x",
      nfeId: null,
      reason: "DS aponta a dois pedidos",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [ambiguous],
    });
    assert.equal(graph.items[0]!.reconciliation.linkStatus, "AMBIGUOUS");
  });

  it("um DS com dois pedidos — ambiguidade no orderLinks", () => {
    const ambiguous = edge({
      sourceType: "AMBIGUOUS",
      sourceSystem: "DERIVED",
      sourceRecordId: "ds-multi",
      sourceExternalId: 99,
      targetRecordId: null,
      targetExternalId: null,
      salesOrderId: null,
      salesOrderItemId: null,
      productionOrderId: null,
      outputDocumentId: "ds-multi",
      nfeId: null,
      reason: `DS 99 referencia ${ORDER} e ${ORDER_2}`,
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [ambiguous],
    });
    assert.ok(
      graph.reconciliation.warnings.some((w) =>
        w.includes("Vínculo ambíguo no pedido")
      )
    );
    assert.equal(graph.items[0]!.reconciliation.documentedQuantity, 0);
  });

  it("pedido com dois itens em estágios diferentes", () => {
    const dsA = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "a",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-a",
      nfeId: "nfe-a",
      reason: "a",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 5,
    });
    const nfeA = edge({
      sourceType: "SALES_ORDER_NFE_LINK",
      sourceSystem: "INDUSCOST",
      sourceRecordId: "na",
      sourceExternalId: 901,
      targetRecordId: ORDER,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-a",
      nfeId: "nfe-a",
      reason: "na",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 5,
    });
    const opB = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "b",
      sourceExternalId: 2,
      targetRecordId: ITEM_B,
      targetExternalId: 2,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_B,
      productionOrderId: "op-b",
      outputDocumentId: null,
      nfeId: null,
      reason: "b",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 8,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 5), obligation(ITEM_B, 8)],
      links: [dsA, nfeA, opB],
      documents: [
        {
          outputDocumentId: "ds-a",
          outputDocumentExternalId: 1,
          salesOrderItemId: ITEM_A,
          quantity: 5,
          idNfe: 901,
          link: dsA,
        },
      ],
      nfes: [
        {
          nfeId: "nfe-a",
          nfeExternalId: 901,
          salesOrderItemId: ITEM_A,
          quantity: 5,
          statusNormalized: "AUTHORIZED",
          isValidForBilling: true,
          hasDocument: true,
          link: nfeA,
        },
      ],
      productionLinks: [
        {
          salesOrderItemId: ITEM_B,
          productionOrderId: "op-b",
          productionOrderExternalId: 2,
          linkedQuantity: 8,
          link: opB,
        },
      ],
    });
    const a = graph.items.find((i) => i.salesOrderItemId === ITEM_A)!;
    const b = graph.items.find((i) => i.salesOrderItemId === ITEM_B)!;
    assert.equal(a.reconciliation.coverageStatus, "SHIPPED");
    assert.equal(b.reconciliation.coverageStatus, "IN_PRODUCTION");
    assert.equal(a.reconciliation.documentedQuantity, 5);
    assert.equal(b.reconciliation.documentedQuantity, 0);
  });

  it("cobertura de um item não vaza para outro", () => {
    const dsA = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "a",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-a",
      nfeId: null,
      reason: "a",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10), obligation(ITEM_B, 10)],
      links: [dsA],
      documents: [
        {
          outputDocumentId: "ds-a",
          outputDocumentExternalId: 1,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          idNfe: null,
          link: dsA,
        },
      ],
    });
    assert.equal(
      graph.items.find((i) => i.salesOrderItemId === ITEM_A)!.reconciliation
        .documentedQuantity,
      10
    );
    assert.equal(
      graph.items.find((i) => i.salesOrderItemId === ITEM_B)!.reconciliation
        .documentedQuantity,
      0
    );
  });

  it("unidade inconsistente marca INCONSISTENT sem inventar qty", () => {
    const dsLink = edge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "ds",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: null,
      reason: "ds",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 2,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 24)],
      links: [dsLink],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 1,
          salesOrderItemId: ITEM_A,
          quantity: 2,
          idNfe: null,
          link: dsLink,
        },
      ],
      reconciliationOptions: {
        unitHintsByItem: {
          [ITEM_A]: {
            officialUnitCode: "UN",
            evidence: [
              {
                entityType: "DS",
                entityId: "ds-1",
                unitCode: "CX",
                quantity: 2,
              },
            ],
          },
        },
      },
    });
    const r = graph.items[0]!.reconciliation;
    assert.equal(r.unitConversion.status, "INCONSISTENT");
    assert.equal(r.coverageStatus, "INCONSISTENT");
    assert.equal(r.documentedQuantity, 0);
    assert.ok(
      r.unresolvedEvidence.some((u) => u.code === "UNIT_CONVERSION_INCONSISTENT")
    );
    assert.ok(r.operationalEvidenceTimeline.some((e) => e.kind === "OUTPUT_DOCUMENT"));
  });

  it("reconcileSalesOrderOperationalEvidence gera contrato de diagnóstico", () => {
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      orderCode: "PD 06099",
      externalSalesOrderId: 6099,
      obligations: [obligation(ITEM_A, 1)],
      links: [],
    });
    const recon = reconcileSalesOrderOperationalEvidence(graph);
    assert.equal(recon.contractVersion, "sales-order-operational-reconciliation/v1");
    assert.ok(recon.items[0]!.linkStatus);
    assert.ok(recon.items[0]!.coverageStatus);
    assert.ok(Array.isArray(recon.items[0]!.sourceSummary));
    assert.ok(Array.isArray(recon.items[0]!.warnings));
    assert.ok(Array.isArray(recon.items[0]!.unresolvedEvidence));
    assert.ok(Array.isArray(recon.items[0]!.operationalEvidenceTimeline));
  });
});
