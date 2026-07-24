import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PD_02457_FISCAL, PD_02457_NFE_XML } from "./nfeFiscalFixtures.js";
import {
  extractDreNfeItemsFromRawPayload,
  extractDreNfeItemsFromSources,
  extractDreNfeItemsFromXml,
} from "./financeDreNfeItemExtract.js";

describe("financeDreNfeItemExtract", () => {
  it("extrai itens do payload Nomus", () => {
    const extracted = extractDreNfeItemsFromRawPayload({
      itens: [
        { idProduto: 99, codigoProduto: "SKU-1", quantidade: 2, valorUnitario: 10 },
        { idProduto: 100, quantidade: 0 },
      ],
    });
    assert.equal(extracted.length, 1);
    assert.equal(extracted[0]?.externalProductId, 99);
    assert.equal(extracted[0]?.sku, "SKU-1");
    assert.equal(extracted[0]?.quantity, 2);
    assert.equal(extracted[0]?.lineRevenue, 20);
  });

  it("extrai linhas comerciais do XML (det/prod)", () => {
    const extracted = extractDreNfeItemsFromXml(PD_02457_NFE_XML);
    assert.equal(extracted.length, 1);
    assert.equal(extracted[0]?.sku, "SKU-PD02457");
    assert.equal(extracted[0]?.quantity, 1);
    assert.equal(extracted[0]?.lineRevenue, PD_02457_FISCAL.productsNet);
    assert.equal(extracted[0]?.externalProductId, null);
  });

  it("prefiro payload; se vazio, usa XML", () => {
    const fromXmlOnly = extractDreNfeItemsFromSources({
      rawPayload: { status: 100, numero: 7311 },
      xmlRaw: PD_02457_NFE_XML,
    });
    assert.equal(fromXmlOnly.length, 1);
    assert.equal(fromXmlOnly[0]?.sku, "SKU-PD02457");

    const fromPayload = extractDreNfeItemsFromSources({
      rawPayload: {
        itens: [{ idProduto: 7, codigoProduto: "A", quantidade: 3, valorTotal: 30 }],
      },
      xmlRaw: PD_02457_NFE_XML,
    });
    assert.equal(fromPayload.length, 1);
    assert.equal(fromPayload[0]?.externalProductId, 7);
    assert.equal(fromPayload[0]?.sku, "A");
  });

  it("retorna vazio sem payload de itens e sem XML útil", () => {
    assert.deepEqual(extractDreNfeItemsFromSources({ rawPayload: {}, xmlRaw: "" }), []);
    assert.deepEqual(extractDreNfeItemsFromXml(null), []);
  });
});
