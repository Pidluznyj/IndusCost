import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  moneyEquals,
  planNomusPurchaseOrderFinancialRematerialize,
} from "./nomusPurchaseOrderFinancialRematerialize.js";

const LIVE_RAW = {
  codigoPedido: "PC00612",
  dataEmissao: "02/09/2026",
  id: 613,
  idPessoaFornecedor: 215,
  itensPedidoCompra: [
    {
      idProduto: 1292,
      item: "000010",
      percentualDesconto: "0",
      quantidade: "50",
      status: 2,
      valorDesconto: "0",
      valorUnitario: "62,77",
    },
  ],
  parcelas: [{ valorParcela: "1.136,68" }],
  valorTotalFrete: "0",
  valorTotalOutrasDespesasAcessorias: "0",
  valorTotalSeguro: "0",
};

describe("rematerialize financials from rawPayload", () => {
  it("trata null armazenado e valor mapeado como diferentes", () => {
    assert.equal(moneyEquals(null, 3138.5), false);
    assert.equal(moneyEquals(3138.5, 3138.5), true);
    assert.equal(moneyEquals({ toString: () => "3138.50" }, 3138.5), true);
    assert.equal(moneyEquals(0, 0), true);
    assert.equal(moneyEquals(null, null), true);
  });

  it("atualiza pedido live sem valorTotal persistido", () => {
    const plan = planNomusPurchaseOrderFinancialRematerialize({
      id: "po-1",
      externalId: 613,
      totalAmount: null,
      rawPayload: LIVE_RAW,
      items: [{ id: "i1", lineIndex: 0, totalAmount: null }],
    });
    assert.equal(plan.action, "update");
    assert.equal(plan.mapped?.totalAmount, 3138.5);
    assert.equal(plan.mapped?.items[0]?.totalAmount, 3138.5);
  });

  it("é idempotente quando o valor já está materializado", () => {
    const plan = planNomusPurchaseOrderFinancialRematerialize({
      id: "po-1",
      externalId: 613,
      totalAmount: 3138.5,
      rawPayload: LIVE_RAW,
      items: [{ id: "i1", lineIndex: 0, totalAmount: 3138.5 }],
    });
    assert.equal(plan.action, "unchanged");
  });

  it("não inventa valor quando não há total nem quantidade/preço", () => {
    const plan = planNomusPurchaseOrderFinancialRematerialize({
      id: "po-2",
      externalId: 1,
      totalAmount: null,
      rawPayload: { id: 1, codigoPedido: "X" },
      items: [],
    });
    assert.equal(plan.action, "unchanged");
    assert.equal(plan.mapped?.totalAmount, null);
  });
});
