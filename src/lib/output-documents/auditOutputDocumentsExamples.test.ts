import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFoundExampleLookup,
  buildNfeExampleFromFixture,
  buildNotFoundExampleLookup,
  buildOutputDocumentExampleFromFixture,
  buildSalesOrderExampleFromFixture,
  extractRelevantRawJsonEntries,
  markStrategy,
  maskNfeChave,
  planDocumentLookupStrategies,
  planNfeLookupStrategies,
  planSalesOrderLookupStrategies,
} from "./auditOutputDocumentsExamples.js";

describe("plan*LookupStrategies", () => {
  it("planeja busca de documento por externalId", () => {
    const strategies = planDocumentLookupStrategies(8451);
    assert.equal(strategies.length, 1);
    assert.equal(strategies[0]?.strategy, "NomusStockDocument.externalId");
    assert.equal(strategies[0]?.key, "8451");
    assert.equal(strategies[0]?.attempted, false);
  });

  it("pedido: orderCode + externalSalesOrderCode; id so se numerico", () => {
    const code = planSalesOrderLookupStrategies("PD02590");
    assert.ok(code.some((s) => s.strategy === "SalesOrder.orderCode"));
    assert.ok(
      code.some((s) => s.strategy === "SalesOrder.externalSalesOrderCode")
    );
    assert.ok(
      !code.some((s) => s.strategy === "SalesOrder.externalSalesOrderId")
    );

    const numeric = planSalesOrderLookupStrategies("2590");
    assert.ok(
      numeric.some((s) => s.strategy === "SalesOrder.externalSalesOrderId")
    );
  });

  it("NF: externalId, numero limitado e SalesOrderNfeLink", () => {
    const strategies = planNfeLookupStrategies(7208);
    assert.deepEqual(
      strategies.map((s) => s.strategy),
      [
        "NomusNfe.externalId",
        "NomusNfe.numero",
        "SalesOrderNfeLink.nfeExternalId",
      ]
    );
    assert.ok(strategies.every((s) => s.bound));
  });
});

describe("found vs not found", () => {
  it("nao encontrado preserva estrategias e found=false", () => {
    let strategies = planDocumentLookupStrategies(999999);
    strategies = markStrategy(
      strategies,
      "NomusStockDocument.externalId",
      false
    );
    const result = buildNotFoundExampleLookup({
      query: { document: 999999 },
      strategies,
    });
    assert.equal(result.found, false);
    assert.equal(result.data, null);
    assert.equal(result.strategies[0]?.attempted, true);
    assert.equal(result.strategies[0]?.matched, false);
    assert.ok(result.notes.some((n) => /não encontrado/i.test(n)));
  });

  it("encontrado monta documento sanitizado a partir de fixture", () => {
    const strategies = markStrategy(
      planDocumentLookupStrategies(8451),
      "NomusStockDocument.externalId",
      true
    );
    const data = buildOutputDocumentExampleFromFixture({
      externalId: 8451,
      idNfe: 7208,
      tipoDocumentoEstoque: "DocumentoSaida",
      items: [
        {
          externalItemId: 1,
          externalProductId: 10,
          quantity: 2,
          unitValue: 50,
          estimatedTotalValue: 100,
        },
      ],
      rawJson: {
        empresa: { cnpj: "12.345.678/0001-90", nome: "ACME" },
        cliente: { cpf: "123.456.789-09" },
        condicaoPagamento: { parcelas: 2 },
        tokenSegredo: "abcdEFGH1234567890XYZW",
      },
      localNfe: { externalId: 7208, status: 6 },
      orders: [
        {
          orderCode: "PD02590",
          salesOrderId: "order-uuid",
          source: "sales_order_nfe_link",
        },
      ],
    });

    const result = buildFoundExampleLookup({
      query: { document: 8451 },
      strategies,
      data,
    });

    assert.equal(result.found, true);
    assert.equal(result.data?.header.externalId, 8451);
    assert.equal(result.data?.values.itemsTotalCents, 10000);
    assert.equal(result.data?.nfe.cancelled, false);
    assert.ok(result.data?.company);
    assert.ok(result.data?.customer);
    assert.ok(result.data?.paymentTerms.rawJsonCandidates.length > 0);
    const joined = JSON.stringify(result.data);
    assert.ok(!joined.includes("12345678000190"));
    assert.ok(!joined.includes("123.456.789-09"));
  });

  it("pedido e NF fixtures found/not-found", () => {
    const orderData = buildSalesOrderExampleFromFixture({
      id: "so-1",
      orderCode: "PD02590",
      externalSalesOrderId: 100,
      status: "SENT_TO_NOMUS",
      paymentTerms: "30/60",
      totalNetValue: 1500.5,
      customer: {
        id: "c1",
        companyName: "Cliente X",
        taxId: "12345678000190",
      },
      items: [
        {
          skuSnapshot: "SKU-1",
          productNameSnapshot: "Produto",
          quantity: 1,
          totalNetValue: 1500.5,
        },
      ],
      nfes: [{ nfeExternalId: 7208, nfeNumber: "7208", nfeStatus: 6 }],
      documents: [
        { externalId: 8451, idNfe: 7208, source: "idNfe+SalesOrderNfeLink" },
      ],
      linkSources: ["sales_order_nfe_link", "stock_document_idNfe"],
    });
    assert.equal(orderData.header.orderCode, "PD02590");
    assert.equal(orderData.customer?.taxIdMasked?.includes("*"), true);
    assert.ok(!JSON.stringify(orderData).includes("12345678000190"));

    const nfeData = buildNfeExampleFromFixture({
      externalId: 7208,
      chave: "35240112345678901234550010000072081234567890",
      numero: "7208",
      status: 6,
      xmlVNF: 100,
      accountsReceivable: [
        {
          externalId: 1,
          amountReceivableCents: 9000,
          amountReceivedCents: 0,
          balanceReceivableCents: 9000,
          dueDate: "2026-08-01T00:00:00.000Z",
          settlementDate: null,
        },
      ],
      documents: [{ externalId: 8451, tipoDocumentoEstoque: "DocumentoSaida" }],
      orders: [{ orderCode: "PD02590", salesOrderId: "so-1" }],
    });
    assert.equal(nfeData.status.cancelled, false);
    assert.ok(nfeData.header.chaveMasked?.includes("…"));
    assert.ok(nfeData.divergences.some((d) => d.status === "divergente"));

    const missing = buildNotFoundExampleLookup({
      query: { nfe: 1 },
      strategies: markStrategy(
        planNfeLookupStrategies(1),
        "NomusNfe.externalId",
        false
      ),
    });
    assert.equal(missing.found, false);
  });
});

describe("extractRelevantRawJsonEntries / maskNfeChave", () => {
  it("extrai so chaves relevantes e mascara", () => {
    const entries = extractRelevantRawJsonEntries({
      irrelevante: "x",
      condicaoPagamento: { valor: "10,00" },
      idNfe: 7208,
    });
    assert.ok(entries.some((e) => /condicaoPagamento|idNfe/i.test(e.key)));
    assert.ok(!entries.some((e) => e.key === "irrelevante"));
  });

  it("mascara chave NF", () => {
    assert.equal(maskNfeChave(null), null);
    assert.match(maskNfeChave("12345678901234567890") ?? "", /…/);
  });
});
