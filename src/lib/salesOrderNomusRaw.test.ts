import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractNomusRawNfes,
  normalizeNomusSalesOrderItemStatusCode,
  normalizeSalesOrderItemNomusStatus,
  NOMUS_SALES_ORDER_ITEM_STATUS_BY_CODE,
  resolveRawItemMatchType,
} from "./salesOrderNomusRaw.js";

describe("salesOrderNomusRaw", () => {
  it("mapeia código 6 para cancelled", () => {
    assert.equal(NOMUS_SALES_ORDER_ITEM_STATUS_BY_CODE[6], "cancelled");
    assert.equal(normalizeNomusSalesOrderItemStatusCode(6), "cancelled");
    assert.equal(normalizeSalesOrderItemNomusStatus(6), "cancelled");
  });

  it("código desconhecido retorna unknown", () => {
    assert.equal(normalizeNomusSalesOrderItemStatusCode(99), null);
    assert.equal(normalizeSalesOrderItemNomusStatus(99), "unknown");
  });

  it("extractNomusRawNfes inclui chave de acesso e raw", () => {
    const nfes = extractNomusRawNfes({
      nfes: [
        {
          numero: "100",
          serie: "1",
          chaveAcesso: "35260123456789012345678901234567890123456789",
          dataProcessamento: "10/06/2026",
          valor: 500,
        },
      ],
    });
    assert.equal(nfes[0].numero, "100");
    assert.equal(nfes[0].accessKey?.length, 44);
    assert.ok(nfes[0].raw);
  });

  it("resolveRawItemMatchType por external id", () => {
    const rawItems = [
      {
        item: 10,
        idProduto: 42,
        codigoProduto: "SKU-1",
        status: "Liberado",
        quantidade: 1,
        quantidadeAtendida: null,
        quantidadeFaturada: null,
        quantidadeCancelada: null,
        quantidadeDevolvida: null,
        quantidadeEnviada: null,
        quantidadeEntregue: null,
        dataEntrega: null,
        raw: { idProduto: 42 },
      },
    ];
    assert.equal(
      resolveRawItemMatchType(rawItems, { externalProductId: 42 }),
      "external_id"
    );
    assert.equal(
      resolveRawItemMatchType(rawItems, { skuSnapshot: "SKU-1" }),
      "sku"
    );
  });
});
