import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractOfficialItemNfeExternalId,
  mapRelatedNfeOriginToAuditLinkOrigin,
  resolveSalesOrderRelatedNfes,
} from "./salesOrderRelatedNfeResolver.js";

const ORDER_A = "00000000-0000-4000-8000-0000000000a1";
const ORDER_B = "00000000-0000-4000-8000-0000000000b2";

describe("resolveSalesOrderRelatedNfes (TRIB-03)", () => {
  it("resolve vínculo direto SalesOrderNfeLink", () => {
    const result = resolveSalesOrderRelatedNfes({
      salesOrderId: ORDER_A,
      links: [
        {
          nfeExternalId: 9001,
          nfeNumber: "123",
          nfeKey: "KEY9001",
          linkId: "link-1",
        },
      ],
    });

    assert.deepEqual(result.nfeExternalIds, [9001]);
    assert.equal(result.nfes.length, 1);
    assert.deepEqual(result.nfes[0]!.origins, ["SALES_ORDER_NFE_LINK"]);
    assert.equal(result.nfes[0]!.primaryOrigin, "SALES_ORDER_NFE_LINK");
    assert.equal(result.nfes[0]!.includeInTaxTotals, true);
    assert.equal(result.nfes[0]!.hasConflict, false);
  });

  it("resolve vínculo Pedido → Documento de Saída → NF-e", () => {
    const result = resolveSalesOrderRelatedNfes({
      salesOrderId: ORDER_A,
      o2cFacts: [
        {
          stockDocumentExternalId: 8001,
          stockDocumentIdNfe: 9100,
          nfeExternalId: null,
        },
      ],
      stockDocuments: [{ stockDocumentExternalId: 8001, idNfe: 9100 }],
    });

    assert.deepEqual(result.nfeExternalIds, [9100]);
    assert.ok(result.nfes[0]!.origins.includes("STOCK_DOCUMENT"));
    assert.equal(
      result.nfes[0]!.sources.some(
        (s) => s.origin === "STOCK_DOCUMENT" && s.stockDocumentExternalId === 8001
      ),
      true
    );
  });

  it("resolve vínculo materializado pelo Order-to-Cash (nfeExternalId)", () => {
    const result = resolveSalesOrderRelatedNfes({
      salesOrderId: ORDER_A,
      o2cFacts: [
        {
          nfeExternalId: 9200,
          nfeNumber: "456",
          stockDocumentExternalId: 8010,
        },
      ],
    });

    assert.deepEqual(result.nfeExternalIds, [9200]);
    assert.ok(result.nfes[0]!.origins.includes("ORDER_TO_CASH"));
    assert.equal(result.nfes[0]!.nfeNumber, "456");
  });

  it("deduplica a mesma NF encontrada por várias fontes e preserva origens", () => {
    const result = resolveSalesOrderRelatedNfes({
      salesOrderId: ORDER_A,
      links: [{ nfeExternalId: 9300, nfeNumber: "789", linkId: "l1" }],
      o2cFacts: [
        {
          nfeExternalId: 9300,
          nfeNumber: "789",
          stockDocumentExternalId: 8020,
          stockDocumentIdNfe: 9300,
          salesOrderItemId: "item-1",
          nfeItemMatchedOrderItem: true,
        },
      ],
      stockDocuments: [{ stockDocumentExternalId: 8020, idNfe: 9300 }],
      itemRefs: [{ salesOrderItemId: "item-1", nfeExternalId: 9300 }],
    });

    assert.deepEqual(result.nfeExternalIds, [9300]);
    assert.equal(result.nfes.length, 1);
    assert.deepEqual(result.nfes[0]!.origins, [
      "ITEM_REF",
      "SALES_ORDER_NFE_LINK",
      "STOCK_DOCUMENT",
      "ORDER_TO_CASH",
    ]);
    assert.equal(result.nfes[0]!.primaryOrigin, "ITEM_REF");
    assert.ok(result.nfes[0]!.sources.length >= 4);
  });

  it("retorna NF cancelada para auditoria, mas exclui dos totais tributários", () => {
    const result = resolveSalesOrderRelatedNfes({
      salesOrderId: ORDER_A,
      links: [{ nfeExternalId: 9400, nfeStatus: 7, linkId: "l-cancel" }],
      nfeStatusHints: [{ nfeExternalId: 9400, status: 7 }],
    });

    assert.deepEqual(result.nfeExternalIds, [9400]);
    assert.deepEqual(result.nfeExternalIdsForTaxTotals, []);
    assert.equal(result.nfes[0]!.isCanceled, true);
    assert.equal(result.nfes[0]!.includeInTaxTotals, false);
  });

  it("pedido sem NF retorna lista vazia", () => {
    const result = resolveSalesOrderRelatedNfes({
      salesOrderId: ORDER_A,
      links: [],
      o2cFacts: [{ stockDocumentExternalId: null, nfeExternalId: null }],
      stockDocuments: [{ stockDocumentExternalId: 1, idNfe: null }],
      itemRefs: [],
    });

    assert.deepEqual(result.nfeExternalIds, []);
    assert.deepEqual(result.nfes, []);
    assert.deepEqual(result.nfeExternalIdsForTaxTotals, []);
  });

  it("marca vínculo conflitante quando a mesma NF está em outro pedido", () => {
    const result = resolveSalesOrderRelatedNfes({
      salesOrderId: ORDER_A,
      links: [{ nfeExternalId: 9500, nfeNumber: "111", linkId: "l-a" }],
      foreignLinks: [
        {
          salesOrderId: ORDER_B,
          orderCode: "PD 99999",
          nfeExternalId: 9500,
        },
      ],
    });

    assert.equal(result.nfes[0]!.hasConflict, true);
    assert.equal(result.nfes[0]!.conflict?.kind, "FOREIGN_ORDER_LINK");
    assert.deepEqual(result.nfes[0]!.conflict?.conflictingSalesOrderIds, [ORDER_B]);
    assert.deepEqual(result.nfes[0]!.conflict?.conflictingOrderCodes, ["PD 99999"]);
    // Ainda retornada para auditoria; cancelamento é o critério de totais.
    assert.equal(result.nfes[0]!.includeInTaxTotals, true);
  });

  it("marca conflito de identidade quando número/chave divergem entre fontes", () => {
    const result = resolveSalesOrderRelatedNfes({
      salesOrderId: ORDER_A,
      links: [{ nfeExternalId: 9600, nfeNumber: "A1", nfeKey: "K1" }],
      o2cFacts: [{ nfeExternalId: 9600, nfeNumber: "B2", nfeKey: "K2" }],
    });

    assert.equal(result.nfes[0]!.hasConflict, true);
    assert.equal(result.nfes[0]!.conflict?.kind, "IDENTITY_MISMATCH");
    assert.deepEqual(result.nfes[0]!.conflict?.identityValues?.nfeNumbers, ["A1", "B2"]);
  });

  it("ignora ids não positivos e não faz match aproximado", () => {
    const result = resolveSalesOrderRelatedNfes({
      salesOrderId: ORDER_A,
      links: [{ nfeExternalId: 0 }, { nfeExternalId: -3 }],
      o2cFacts: [{ nfeExternalId: null, stockDocumentIdNfe: 0 }],
    });
    assert.deepEqual(result.nfeExternalIds, []);
  });

  it("extractOfficialItemNfeExternalId lê chaves estruturais", () => {
    assert.equal(extractOfficialItemNfeExternalId({ idNfe: 701 }), 701);
    assert.equal(extractOfficialItemNfeExternalId({ nfe: { id: 702 } }), 702);
    assert.equal(extractOfficialItemNfeExternalId({ produto: "X", valor: 10 }), null);
  });

  it("mapRelatedNfeOriginToAuditLinkOrigin cobre origens do resolver", () => {
    assert.equal(
      mapRelatedNfeOriginToAuditLinkOrigin("SALES_ORDER_NFE_LINK"),
      "SALES_ORDER_NFE_LINK"
    );
    assert.equal(mapRelatedNfeOriginToAuditLinkOrigin("ORDER_TO_CASH"), "ITEM_EVIDENCE");
    assert.equal(mapRelatedNfeOriginToAuditLinkOrigin("STOCK_DOCUMENT"), "ITEM_EVIDENCE");
    assert.equal(mapRelatedNfeOriginToAuditLinkOrigin("ITEM_REF"), "ITEM_EVIDENCE");
  });
});
