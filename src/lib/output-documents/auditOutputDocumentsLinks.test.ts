import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyDocumentNfeLink,
  classifyDocumentSalesOrderLink,
  extractNfeIdsFromRawJsonHypothesis,
  extractOrderRefsFromRawJsonHypothesis,
  isDependentOnO2c,
  isNomusNfeCancelledStatus,
  isResolvedByItem,
  isResolvedByNfeOnly,
  summarizeOrderCardinality,
} from "./auditOutputDocumentsLinks.js";

describe("isNomusNfeCancelledStatus", () => {
  it("reconhece status 7 como cancelado", () => {
    assert.equal(isNomusNfeCancelledStatus(7), true);
    assert.equal(isNomusNfeCancelledStatus(6), false);
    assert.equal(isNomusNfeCancelledStatus(null), false);
  });
});

describe("extract*FromRawJsonHypothesis", () => {
  it("extrai idNfe e pedidos sem afirmar significado definitivo", () => {
    const raw = {
      idNfe: 7208,
      nota: { nfeExternalId: "6937" },
      pedido: "PD02590",
      itens: [{ idPedido: 123 }],
    };
    assert.deepEqual(extractNfeIdsFromRawJsonHypothesis(raw), [6937, 7208]);
    assert.ok(extractOrderRefsFromRawJsonHypothesis(raw).includes("PD02590"));
    assert.ok(extractOrderRefsFromRawJsonHypothesis(raw).includes("123"));
  });
});

describe("classifyDocumentNfeLink", () => {
  it("classifica persistido quando idNfe está no stage", () => {
    const result = classifyDocumentNfeLink({
      documentExternalId: 8451,
      persistedIdNfe: 7208,
      nfeExistsLocally: true,
      nfeStatus: 6,
      rawJsonNfeIds: [7208],
      o2cNfeIds: [7208],
    });
    assert.equal(result.classification, "persistido");
    assert.ok(result.sources.includes("stock_document_idNfe"));
  });

  it("classifica derivado quando só O2C resolve", () => {
    const result = classifyDocumentNfeLink({
      documentExternalId: 1,
      persistedIdNfe: null,
      nfeExistsLocally: false,
      nfeStatus: null,
      rawJsonNfeIds: [],
      o2cNfeIds: [100],
    });
    assert.equal(result.classification, "derivado");
  });

  it("classifica inferido quando só rawJson resolve", () => {
    const result = classifyDocumentNfeLink({
      documentExternalId: 1,
      persistedIdNfe: null,
      nfeExistsLocally: false,
      nfeStatus: null,
      rawJsonNfeIds: [200],
      o2cNfeIds: [],
    });
    assert.equal(result.classification, "inferido");
  });

  it("classifica conflitante quando fontes discordam", () => {
    const result = classifyDocumentNfeLink({
      documentExternalId: 1,
      persistedIdNfe: 7208,
      nfeExistsLocally: true,
      nfeStatus: 6,
      rawJsonNfeIds: [9999],
      o2cNfeIds: [],
    });
    assert.equal(result.classification, "conflitante");
  });

  it("classifica nao_resolvido sem fontes", () => {
    const result = classifyDocumentNfeLink({
      documentExternalId: 1,
      persistedIdNfe: null,
      nfeExistsLocally: false,
      nfeStatus: null,
      rawJsonNfeIds: [],
      o2cNfeIds: [],
    });
    assert.equal(result.classification, "nao_resolvido");
  });
});

describe("classifyDocumentSalesOrderLink", () => {
  it("classifica derivado via SalesOrderNfeLink + idNfe", () => {
    const result = classifyDocumentSalesOrderLink({
      documentExternalId: 8451,
      persistedIdNfe: 7208,
      ordersViaNfeLink: ["PD02590"],
      ordersViaO2c: ["PD02590"],
      ordersViaRawJson: [],
      hasO2cItemResolution: false,
    });
    assert.equal(result.classification, "derivado");
    assert.ok(result.sources.includes("sales_order_nfe_link"));
  });

  it("classifica conflitante quando pedidos divergem entre fontes", () => {
    const result = classifyDocumentSalesOrderLink({
      documentExternalId: 1,
      persistedIdNfe: 1,
      ordersViaNfeLink: ["PD001"],
      ordersViaO2c: ["PD002"],
      ordersViaRawJson: [],
      hasO2cItemResolution: true,
    });
    assert.equal(result.classification, "conflitante");
  });

  it("classifica inferido só por rawJson", () => {
    const result = classifyDocumentSalesOrderLink({
      documentExternalId: 1,
      persistedIdNfe: null,
      ordersViaNfeLink: [],
      ordersViaO2c: [],
      ordersViaRawJson: ["PD999"],
      hasO2cItemResolution: false,
    });
    assert.equal(result.classification, "inferido");
  });

  it("classifica nao_resolvido sem pedidos", () => {
    const result = classifyDocumentSalesOrderLink({
      documentExternalId: 1,
      persistedIdNfe: null,
      ordersViaNfeLink: [],
      ordersViaO2c: [],
      ordersViaRawJson: [],
      hasO2cItemResolution: false,
    });
    assert.equal(result.classification, "nao_resolvido");
  });
});

describe("métricas auxiliares de resolução", () => {
  it("distingue resolução por item, só NF e dependência O2C", () => {
    assert.equal(summarizeOrderCardinality([]), "zero");
    assert.equal(summarizeOrderCardinality(["A"]), "one");
    assert.equal(summarizeOrderCardinality(["A", "B"]), "many");

    assert.equal(
      isResolvedByNfeOnly({
        documentExternalId: 1,
        persistedIdNfe: 1,
        ordersViaNfeLink: ["PD1"],
        ordersViaO2c: [],
        ordersViaRawJson: [],
        hasO2cItemResolution: false,
      }),
      true
    );

    assert.equal(
      isResolvedByItem({
        documentExternalId: 1,
        persistedIdNfe: 1,
        ordersViaNfeLink: [],
        ordersViaO2c: ["PD1"],
        ordersViaRawJson: [],
        hasO2cItemResolution: true,
      }),
      true
    );

    assert.equal(
      isDependentOnO2c({
        documentExternalId: 1,
        persistedIdNfe: null,
        ordersViaNfeLink: [],
        ordersViaO2c: ["PD1"],
        ordersViaRawJson: [],
        hasO2cItemResolution: false,
      }),
      true
    );
  });
});
