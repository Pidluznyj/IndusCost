/**
 * KAN-LINK-02 — Matriz do contrato SalesOrderOperationalEvidenceGraph.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOperationalAuditAlert,
  canOperationalLinkAdvanceKanban,
  classifyNfeValidity,
  classifyOutputDocumentValidity,
  isOperationalLinkStrongerThan,
  pickPreferredOperationalLink,
  SALES_ORDER_OPERATIONAL_LINK_PRECEDENCE_RANK,
} from "./salesOrderOperationalEvidenceContract.js";
import {
  adaptOperationalEvidenceItemToMotorAllocations,
  buildSalesOrderOperationalEvidenceGraph,
  makeOperationalLinkEdge,
} from "./salesOrderOperationalEvidenceGraph.js";

const ORDER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ITEM_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const ITEM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
const ORDER_2 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ITEM_C = "dddddddd-dddd-dddd-dddd-ddddddddddd1";

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

describe("SalesOrderOperationalEvidenceGraph — precedência", () => {
  it("define ranks 1..6 e sem vínculo / ambíguo no fim", () => {
    assert.equal(SALES_ORDER_OPERATIONAL_LINK_PRECEDENCE_RANK.DIRECT_EXTERNAL_ID, 1);
    assert.equal(SALES_ORDER_OPERATIONAL_LINK_PRECEDENCE_RANK.DIRECT_ORDER_REFERENCE, 2);
    assert.equal(SALES_ORDER_OPERATIONAL_LINK_PRECEDENCE_RANK.SALES_ORDER_NFE_LINK, 3);
    assert.equal(SALES_ORDER_OPERATIONAL_LINK_PRECEDENCE_RANK.OUTPUT_DOCUMENT_REFERENCE, 4);
    assert.equal(SALES_ORDER_OPERATIONAL_LINK_PRECEDENCE_RANK.DESCRIPTION_HINT, 6);
    assert.equal(SALES_ORDER_OPERATIONAL_LINK_PRECEDENCE_RANK.UNRESOLVED, 99);
    assert.equal(SALES_ORDER_OPERATIONAL_LINK_PRECEDENCE_RANK.AMBIGUOUS, 99);
  });

  it("vínculo direto prevalece sobre hint", () => {
    const direct = makeOperationalLinkEdge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "soi-1",
      sourceExternalId: 10,
      targetRecordId: "ds-1",
      targetExternalId: 4525,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: null,
      reason: "itemPedido oficial no DS",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const hint = makeOperationalLinkEdge({
      sourceType: "DESCRIPTION_HINT",
      sourceSystem: "DERIVED",
      sourceRecordId: null,
      sourceExternalId: null,
      targetRecordId: "ds-hint",
      targetExternalId: 9999,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-hint",
      nfeId: null,
      reason: "texto menciona PD",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    assert.equal(isOperationalLinkStrongerThan(direct.sourceType, hint.sourceType), true);
    const preferred = pickPreferredOperationalLink([hint, direct]);
    assert.equal(preferred?.sourceType, "DIRECT_ORDER_ITEM_REFERENCE");
  });
});

describe("SalesOrderOperationalEvidenceGraph — matriz de vínculos", () => {
  it("vínculo direto por pedido e item avança documentação", () => {
    const link = makeOperationalLinkEdge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "ds-item-1",
      sourceExternalId: 100,
      targetRecordId: ITEM_A,
      targetExternalId: 701,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: null,
      reason: "idItemPedido no documento",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 5,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      orderCode: "PD-DIRECT",
      externalSalesOrderId: 1001,
      obligations: [obligation(ITEM_A, 10)],
      links: [link],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 4525,
          salesOrderItemId: ITEM_A,
          quantity: 5,
          idNfe: 7394,
          statusRaw: "emitido",
          link,
        },
      ],
    });
    const item = graph.items[0]!;
    assert.equal(item.coverage.documentedQuantity, 5);
    assert.equal(item.documents[0]?.advancesKanban, true);
    assert.equal(item.documents[0]?.validity, "VALID");
  });

  it("vínculo via SalesOrderNfeLink alimenta NF e DS", () => {
    const nfeLink = makeOperationalLinkEdge({
      sourceType: "SALES_ORDER_NFE_LINK",
      sourceSystem: "INDUSCOST",
      sourceRecordId: "nfe-link-1",
      sourceExternalId: 7394,
      targetRecordId: ORDER,
      targetExternalId: 1001,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: null,
      nfeId: "nfe-1",
      reason: "SalesOrderNfeLink persistido",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const dsViaNfe = makeOperationalLinkEdge({
      sourceType: "OUTPUT_DOCUMENT_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "ds-1",
      sourceExternalId: 4525,
      targetRecordId: "nfe-1",
      targetExternalId: 7394,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: "nfe-1",
      reason: "DS.idNfe → NF do NfeLink",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [nfeLink, dsViaNfe],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 4525,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          idNfe: 7394,
          link: dsViaNfe,
        },
      ],
      nfes: [
        {
          nfeId: "nfe-1",
          nfeExternalId: 7394,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          statusNormalized: "AUTHORIZED",
          isValidForBilling: true,
          hasDocument: true,
          link: nfeLink,
        },
      ],
    });
    const item = graph.items[0]!;
    assert.equal(item.coverage.documentedQuantity, 10);
    assert.equal(item.coverage.invoicedQuantity, 10);
    assert.equal(item.nfes[0]?.validity, "AUTHORIZED");
  });

  it("cadeia DS → NF → Pedido cobre item sem inventar fuzzy", () => {
    const chain = makeOperationalLinkEdge({
      sourceType: "NFE_REFERENCE",
      sourceSystem: "DERIVED",
      sourceRecordId: "ds-1",
      sourceExternalId: 4525,
      targetRecordId: ORDER,
      targetExternalId: 1001,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: "nfe-1",
      reason: "DS → idNfe → SalesOrderNfeLink → Pedido",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 8,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [chain],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 4525,
          salesOrderItemId: ITEM_A,
          quantity: 8,
          idNfe: 7394,
          link: chain,
        },
      ],
      nfes: [
        {
          nfeId: "nfe-1",
          nfeExternalId: 7394,
          salesOrderItemId: ITEM_A,
          quantity: 8,
          statusNormalized: "AUTHORIZED",
          hasDocument: true,
          link: chain,
        },
      ],
    });
    assert.equal(graph.items[0]!.coverage.documentedQuantity, 8);
    assert.equal(graph.items[0]!.coverage.invoicedQuantity, 8);
  });

  it("um DS para dois pedidos aloca só nos itens declarados", () => {
    const linkA = makeOperationalLinkEdge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "line-a",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 701,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-shared",
      nfeId: null,
      reason: "linha A do DS compartilhado",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 4,
    });
    const linkC = makeOperationalLinkEdge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "line-c",
      sourceExternalId: 2,
      targetRecordId: ITEM_C,
      targetExternalId: 801,
      salesOrderId: ORDER_2,
      salesOrderItemId: ITEM_C,
      productionOrderId: null,
      outputDocumentId: "ds-shared",
      nfeId: null,
      reason: "linha C do DS compartilhado",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 6,
    });

    const graph1 = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [linkA],
      documents: [
        {
          outputDocumentId: "ds-shared",
          outputDocumentExternalId: 4525,
          salesOrderItemId: ITEM_A,
          quantity: 4,
          idNfe: 1,
          link: linkA,
        },
        {
          // linha de outro pedido — não deve entrar neste grafo por item
          outputDocumentId: "ds-shared",
          outputDocumentExternalId: 4525,
          salesOrderItemId: ITEM_C,
          quantity: 6,
          idNfe: 1,
          link: linkC,
        },
      ],
    });
    assert.equal(graph1.items[0]!.coverage.documentedQuantity, 4);
    assert.equal(graph1.items[0]!.documents.length, 1);

    const graph2 = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER_2,
      obligations: [obligation(ITEM_C, 10)],
      links: [linkC],
      documents: [
        {
          outputDocumentId: "ds-shared",
          outputDocumentExternalId: 4525,
          salesOrderItemId: ITEM_C,
          quantity: 6,
          idNfe: 1,
          link: linkC,
        },
      ],
    });
    assert.equal(graph2.items[0]!.coverage.documentedQuantity, 6);
  });

  it("dois DS para um pedido somam cobertura por item", () => {
    const d1 = makeOperationalLinkEdge({
      sourceType: "OUTPUT_DOCUMENT_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "ds-1",
      sourceExternalId: 4501,
      targetRecordId: ITEM_A,
      targetExternalId: 701,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: "nfe-1",
      reason: "primeiro DS",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 3,
    });
    const d2 = makeOperationalLinkEdge({
      sourceType: "OUTPUT_DOCUMENT_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "ds-2",
      sourceExternalId: 4502,
      targetRecordId: ITEM_A,
      targetExternalId: 701,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-2",
      nfeId: "nfe-2",
      reason: "segundo DS complementar",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 7,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [d1, d2],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 4501,
          salesOrderItemId: ITEM_A,
          quantity: 3,
          idNfe: 1,
          link: d1,
        },
        {
          outputDocumentId: "ds-2",
          outputDocumentExternalId: 4502,
          salesOrderItemId: ITEM_A,
          quantity: 7,
          idNfe: 2,
          link: d2,
        },
      ],
    });
    assert.equal(graph.items[0]!.coverage.documentedQuantity, 10);
    assert.equal(graph.items[0]!.documents.length, 2);
  });

  it("documento parcial cobre só a quantidade informada no item", () => {
    const link = makeOperationalLinkEdge({
      sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
      sourceSystem: "NOMUS",
      sourceRecordId: "partial",
      sourceExternalId: 1,
      targetRecordId: ITEM_A,
      targetExternalId: 701,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-p",
      nfeId: null,
      reason: "parcial",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 4,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10), obligation(ITEM_B, 20)],
      links: [link],
      documents: [
        {
          outputDocumentId: "ds-p",
          outputDocumentExternalId: 1,
          salesOrderItemId: ITEM_A,
          quantity: 4,
          idNfe: 1,
          link,
        },
      ],
    });
    assert.equal(graph.items.find((i) => i.salesOrderItemId === ITEM_A)!.coverage.documentedQuantity, 4);
    assert.equal(graph.items.find((i) => i.salesOrderItemId === ITEM_B)!.coverage.documentedQuantity, 0);
  });

  it("NF cancelada não avança faturamento", () => {
    const link = makeOperationalLinkEdge({
      sourceType: "SALES_ORDER_NFE_LINK",
      sourceSystem: "INDUSCOST",
      sourceRecordId: "nl",
      sourceExternalId: 7394,
      targetRecordId: ORDER,
      targetExternalId: 1001,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: "nfe-x",
      reason: "NF cancelada",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    assert.equal(classifyNfeValidity({ isCanceled: true }), "CANCELLED");
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [link],
      nfes: [
        {
          nfeId: "nfe-x",
          nfeExternalId: 7394,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          isCanceled: true,
          statusNormalized: "CANCELED",
          hasDocument: true,
          link,
        },
      ],
    });
    const item = graph.items[0]!;
    assert.equal(item.coverage.invoicedQuantity, 0);
    assert.equal(item.nfes[0]?.advancesKanban, false);
    assert.ok(item.inconsistencies.some((i) => i.code === "NFE_CANCELLED"));
  });

  it("hint inequívoco registra vínculo LOW mas não avança Kanban", () => {
    const hint = makeOperationalLinkEdge({
      sourceType: "DESCRIPTION_HINT",
      sourceSystem: "DERIVED",
      sourceRecordId: null,
      sourceExternalId: null,
      targetRecordId: "ds-h",
      targetExternalId: 99,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-h",
      nfeId: null,
      reason: "descrição contém código do pedido de forma inequívoca",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    assert.equal(canOperationalLinkAdvanceKanban("DESCRIPTION_HINT"), false);
    assert.equal(hint.confidence, "LOW");
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [hint],
      documents: [
        {
          outputDocumentId: "ds-h",
          outputDocumentExternalId: 99,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          idNfe: 1,
          link: hint,
        },
      ],
    });
    assert.equal(graph.items[0]!.coverage.documentedQuantity, 0);
    assert.equal(graph.items[0]!.documents[0]?.advancesKanban, false);
  });

  it("hint ambíguo fica AMBIGUOUS e não avança", () => {
    const ambiguous = makeOperationalLinkEdge({
      sourceType: "AMBIGUOUS",
      sourceSystem: "DERIVED",
      sourceRecordId: null,
      sourceExternalId: null,
      targetRecordId: null,
      targetExternalId: null,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: null,
      nfeId: null,
      reason: "texto casa com mais de um pedido",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: null,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [ambiguous],
    });
    assert.equal(ambiguous.confidence, "NONE");
    assert.ok(graph.items[0]!.inconsistencies.some((i) => i.code === "AMBIGUOUS_LINK"));
    assert.equal(graph.items[0]!.coverage.documentedQuantity, 0);
  });

  it("mesmo cliente/valor sem vínculo — alerta não prova ligação", () => {
    const alert = buildOperationalAuditAlert(
      "SAME_CUSTOMER",
      "DS e PV compartilham cliente, sem ID oficial"
    );
    const valueAlert = buildOperationalAuditAlert(
      "SAME_VALUE",
      "valores iguais sem referência de pedido"
    );
    assert.equal(alert.provesLink, false);
    assert.equal(valueAlert.provesLink, false);

    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [],
      auditAlerts: [alert, valueAlert],
      // documentos sem salesOrderItemId / sem link forte — não entram
      documents: [
        {
          outputDocumentId: "ds-fuzzy",
          outputDocumentExternalId: 1,
          salesOrderItemId: null,
          quantity: 10,
          idNfe: 1,
          link: makeOperationalLinkEdge({
            sourceType: "UNRESOLVED",
            sourceSystem: "UNKNOWN",
            sourceRecordId: null,
            sourceExternalId: 1,
            targetRecordId: null,
            targetExternalId: null,
            salesOrderId: null,
            salesOrderItemId: null,
            productionOrderId: null,
            outputDocumentId: "ds-fuzzy",
            nfeId: null,
            reason: "mesmo cliente/valor — sem vínculo",
            sourceUpdatedAt: null,
            syncedAt: null,
            quantity: 10,
          }),
        },
      ],
    });
    assert.equal(graph.items[0]!.coverage.documentedQuantity, 0);
    assert.equal(graph.items[0]!.documents.length, 0);
    assert.ok(graph.warnings.some((w) => w.includes("SAME_CUSTOMER")));
    assert.ok(graph.warnings.some((w) => w.includes("provesLink=false")));
  });

  it("ausência de ligação deixa cobertura zerada e UNRESOLVED", () => {
    const unresolved = makeOperationalLinkEdge({
      sourceType: "UNRESOLVED",
      sourceSystem: "UNKNOWN",
      sourceRecordId: null,
      sourceExternalId: null,
      targetRecordId: null,
      targetExternalId: null,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: null,
      nfeId: null,
      reason: "nenhuma evidência oficial",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: null,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [unresolved],
    });
    assert.equal(graph.items[0]!.coverage.documentedQuantity, 0);
    assert.equal(graph.items[0]!.coverage.invoicedQuantity, 0);
    assert.ok(graph.items[0]!.inconsistencies.some((i) => i.code === "UNRESOLVED_LINK"));
  });

  it("precedência: direto vence hint no pickPreferred e na cobertura", () => {
    const direct = makeOperationalLinkEdge({
      sourceType: "DIRECT_EXTERNAL_ID",
      sourceSystem: "NOMUS",
      sourceRecordId: "ds-direct",
      sourceExternalId: 10,
      targetRecordId: ITEM_A,
      targetExternalId: 701,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-direct",
      nfeId: null,
      reason: "external id oficial",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 5,
    });
    const hint = makeOperationalLinkEdge({
      sourceType: "DESCRIPTION_HINT",
      sourceSystem: "DERIVED",
      sourceRecordId: null,
      sourceExternalId: null,
      targetRecordId: ITEM_A,
      targetExternalId: 701,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-hint",
      nfeId: null,
      reason: "hint",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 99,
    });
    assert.equal(pickPreferredOperationalLink([hint, direct])?.sourceType, "DIRECT_EXTERNAL_ID");

    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [hint, direct],
      documents: [
        {
          outputDocumentId: "ds-hint",
          outputDocumentExternalId: 99,
          salesOrderItemId: ITEM_A,
          quantity: 99,
          idNfe: 1,
          link: hint,
        },
        {
          outputDocumentId: "ds-direct",
          outputDocumentExternalId: 10,
          salesOrderItemId: ITEM_A,
          quantity: 5,
          idNfe: 1,
          link: direct,
        },
      ],
    });
    // Hint não avança; só o direto conta.
    assert.equal(graph.items[0]!.coverage.documentedQuantity, 5);
  });
});

describe("SalesOrderOperationalEvidenceGraph — validade e adapter do motor", () => {
  it("classifica cancelado, devolução, transferência, sem NF e processamento", () => {
    assert.equal(classifyOutputDocumentValidity({ isCancelled: true }), "CANCELLED");
    assert.equal(
      classifyOutputDocumentValidity({ tipoDocumentoEstoque: "Devolução" }),
      "RETURN"
    );
    assert.equal(
      classifyOutputDocumentValidity({ tipoDocumentoEstoque: "Transferência" }),
      "TRANSFER"
    );
    assert.equal(classifyOutputDocumentValidity({ idNfe: null }), "WITHOUT_NFE");
    assert.equal(classifyOutputDocumentValidity({ processing: true }), "PROCESSING");
    assert.equal(
      classifyOutputDocumentValidity({ idNfe: 1, statusRaw: "emitido" }),
      "VALID"
    );
  });

  it("adapter só envia alocações que avançam o Kanban", () => {
    const ok = makeOperationalLinkEdge({
      sourceType: "SALES_ORDER_NFE_LINK",
      sourceSystem: "INDUSCOST",
      sourceRecordId: "nl",
      sourceExternalId: 1,
      targetRecordId: ORDER,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: "ds-1",
      nfeId: "nfe-1",
      reason: "ok",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const cancelled = makeOperationalLinkEdge({
      sourceType: "SALES_ORDER_NFE_LINK",
      sourceSystem: "INDUSCOST",
      sourceRecordId: "nl2",
      sourceExternalId: 2,
      targetRecordId: ORDER,
      targetExternalId: 1,
      salesOrderId: ORDER,
      salesOrderItemId: ITEM_A,
      productionOrderId: null,
      outputDocumentId: null,
      nfeId: "nfe-2",
      reason: "cancelada",
      sourceUpdatedAt: null,
      syncedAt: null,
      quantity: 10,
    });
    const graph = buildSalesOrderOperationalEvidenceGraph({
      salesOrderId: ORDER,
      obligations: [obligation(ITEM_A, 10)],
      links: [ok, cancelled],
      documents: [
        {
          outputDocumentId: "ds-1",
          outputDocumentExternalId: 1,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          idNfe: 1,
          link: ok,
        },
      ],
      nfes: [
        {
          nfeId: "nfe-1",
          nfeExternalId: 100,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          statusNormalized: "AUTHORIZED",
          hasDocument: true,
          link: ok,
        },
        {
          nfeId: "nfe-2",
          nfeExternalId: 200,
          salesOrderItemId: ITEM_A,
          quantity: 10,
          isCanceled: true,
          link: cancelled,
        },
      ],
      productionLinks: [
        {
          salesOrderItemId: ITEM_A,
          productionOrderId: "op-1",
          productionOrderExternalId: 55,
          linkedQuantity: 10,
          link: makeOperationalLinkEdge({
            sourceType: "PRODUCTION_ORDER_REFERENCE",
            sourceSystem: "NOMUS",
            sourceRecordId: "opl",
            sourceExternalId: 55,
            targetRecordId: ITEM_A,
            targetExternalId: 701,
            salesOrderId: ORDER,
            salesOrderItemId: ITEM_A,
            productionOrderId: "op-1",
            outputDocumentId: null,
            nfeId: null,
            reason: "OP link",
            sourceUpdatedAt: null,
            syncedAt: null,
            quantity: 10,
          }),
        },
      ],
    });

    const adapted = adaptOperationalEvidenceItemToMotorAllocations(graph, ITEM_A);
    assert.equal(adapted.documentAllocations.length, 1);
    assert.equal(adapted.nfeAllocations.length, 1);
    assert.equal(adapted.nfeAllocations[0]!.nfeExternalId, 100);
    assert.equal(adapted.productionLinks.length, 1);
    assert.equal(adapted.productionLinks[0]!.linkedQuantity, 10);
    assert.equal(adapted.productionLinks[0]!.isCurrent, true);
  });
});
